import type { ChangeFile, SafetyReport, ReviewReport } from "@vectis-code/contracts";

export function generateDeterministicReviewReport(
  files: ChangeFile[],
  safety: SafetyReport,
  prompt: string,
  snapshotNodesCount = 0,
  source: "general" | "console_fix" = "general"
): ReviewReport {
  let riskLevel: "safe" | "medium" | "high" | "blocked" = "safe";
  
  if (!safety.ok) {
    riskLevel = "blocked";
  } else {
    // Scan source files for risky services
    let hasDataStore = false;
    let hasHttpService = false;
    let hasInsertService = false;
    let hasRemoteEvent = false;
    let hasServerScript = false;
    
    for (const file of files) {
      const source = file.source ? file.source.toLowerCase() : "";
      const pathLower = file.instancePath.toLowerCase();
      const className = file.className;
      
      if (source.includes("datastoreservice") || source.includes("getdatastore") || source.includes("setasync") || source.includes("updateasync")) {
        hasDataStore = true;
      }
      if (source.includes("httpservice") || source.includes("getasync") || source.includes("postasync") || source.includes("requestasync")) {
        hasHttpService = true;
      }
      if (source.includes("insertservice") || source.includes("loadasset")) {
        hasInsertService = true;
      }
      if (className === "RemoteEvent" || className === "RemoteFunction" || source.includes("fireserver") || source.includes("fireclient") || source.includes("onserverevent")) {
        hasRemoteEvent = true;
      }
      if (pathLower.startsWith("serverscriptservice") || pathLower.startsWith("serverstorage")) {
        hasServerScript = true;
      }
    }
    
    if (hasDataStore || hasHttpService || hasInsertService) {
      riskLevel = "high";
    } else if (hasRemoteEvent || hasServerScript) {
      riskLevel = "medium";
    }
  }

  // Calculate confidence score
  let confidenceScore = 98;
  if (riskLevel === "high") {
    confidenceScore -= 18;
  } else if (riskLevel === "medium") {
    confidenceScore -= 8;
  } else if (riskLevel === "blocked") {
    confidenceScore = 0;
  }
  
  const promptLower = prompt.toLowerCase();
  if (promptLower.includes("untested") || promptLower.includes("experimental") || promptLower.includes("hacky")) {
    confidenceScore = Math.max(40, confidenceScore - 10);
  }
  
  // Extract affected instances
  const affectedInstances = [...new Set(files.map(f => f.instancePath))];
  
  // Gather findings
  const securityFindings: string[] = [];
  const dataStoreFindings: string[] = [];
  const remoteEventFindings: string[] = [];
  const uiFindings: string[] = [];
  
  if (!safety.ok) {
    securityFindings.push(...safety.blockedPatterns.map(p => `Safety block: ${p}`));
  }
  
  for (const file of files) {
    const source = file.source ?? "";
    const sourceLower = source.toLowerCase();
    
    if (sourceLower.includes("require(") || sourceLower.includes("loadstring(")) {
      securityFindings.push(`Dynamic execution patterns detected in ${file.instancePath}`);
    }
    if (sourceLower.includes("httpservice") || sourceLower.includes("requestasync")) {
      securityFindings.push(`External HTTP communications used in ${file.instancePath}`);
    }
    if (sourceLower.includes("datastoreservice") || sourceLower.includes("getdatastore")) {
      dataStoreFindings.push(`DataStore access in ${file.instancePath}`);
    }
    if (file.className === "RemoteEvent" || file.className === "RemoteFunction" || sourceLower.includes("fireserver") || sourceLower.includes("onserverevent")) {
      remoteEventFindings.push(`Network communication event in ${file.instancePath}`);
    }
    const isUi = file.className.startsWith("UI") || 
                 ["ScreenGui", "Frame", "TextLabel", "TextButton", "ImageLabel", "ImageButton", "ScrollingFrame", "CanvasGroup"].includes(file.className);
    if (isUi) {
      uiFindings.push(`UI Component modification at ${file.instancePath}`);
    }
  }
  
  // Deduplicate findings
  const dedup = (arr: string[]) => [...new Set(arr)].slice(0, 5);
  
  const finalSecurity = dedup(securityFindings);
  const finalDataStore = dedup(dataStoreFindings);
  const finalRemoteEvent = dedup(remoteEventFindings);
  const finalUi = dedup(uiFindings);
  
  // Rollback Notes
  const hasDelete = files.some(f => f.action === "delete");
  const rollbackNotes = hasDelete
    ? "Warning: This patch contains deletions. Rolling back will recreate deleted folders or scripts, but may not restore nested instances if they were not in the base snapshot."
    : "Safe rollback supported. Studio will restore all updated script source code and revert properties to their pre-apply values.";
    
  // Validation Checklist
  const validationChecklist: string[] = [];
  if (finalUi.length > 0) {
    validationChecklist.push("Test UI layout on multiple resolutions in the Device Emulator.");
    validationChecklist.push("Verify that buttons trigger clicks and hover states remain correct.");
  }
  if (finalRemoteEvent.length > 0) {
    validationChecklist.push("Confirm client-to-server arguments are fully sanitized and validated on the server.");
  }
  if (finalDataStore.length > 0) {
    validationChecklist.push("Verify datastore keys are scoped correctly and handle player loading failures gracefully.");
  }
  validationChecklist.push("Perform a local playtest and check the Output console for any runtime warnings or errors.");
  
  // Test Plan
  let testPlan = "Start a local Studio playtest. ";
  if (finalUi.length > 0) {
    testPlan += "Interact with the updated UI elements. ";
  }
  if (finalRemoteEvent.length > 0) {
    testPlan += "Trigger client events and monitor server outputs. ";
  }
  testPlan += "Verify that the Output window shows no new errors or warning logs.";
  
  // Summary for Creator
  const created = files.filter(f => f.action === "create").length;
  const updated = files.filter(f => f.action === "update").length;
  const deleted = files.filter(f => f.action === "delete").length;
  const actions = [];
  if (created > 0) actions.push(`created ${created} element${created === 1 ? "" : "s"}`);
  if (updated > 0) actions.push(`updated ${updated} element${updated === 1 ? "" : "s"}`);
  if (deleted > 0) actions.push(`deleted ${deleted} element${deleted === 1 ? "" : "s"}`);
  
  const summaryForCreator = `This Roblox patch ${actions.join(", ")}. Primary targets include ${files.slice(0, 3).map(f => f.instancePath.split("/").pop()).join(", ")}${files.length > 3 ? " and others" : ""}.`;

  return {
    riskLevel,
    confidenceScore,
    affectedInstances,
    securityFindings: finalSecurity,
    dataStoreFindings: finalDataStore,
    remoteEventFindings: finalRemoteEvent,
    uiFindings: finalUi,
    rollbackNotes,
    validationChecklist,
    testPlan,
    summaryForCreator,
    source
  };
}
