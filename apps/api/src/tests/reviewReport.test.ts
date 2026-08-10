import { describe, expect, it } from "vitest";
import { generateDeterministicReviewReport } from "../services/reviewReport.js";

describe("generateDeterministicReviewReport", () => {
  it("returns blocked risk when safety report is not ok", () => {
    const report = generateDeterministicReviewReport(
      [],
      { ok: false, blockedPatterns: ["require(12345)"] },
      "add a script",
      100
    );
    expect(report.riskLevel).toBe("blocked");
    expect(report.confidenceScore).toBe(0);
    expect(report.securityFindings).toContain("Safety block: require(12345)");
  });

  it("returns high risk when DataStoreService or HttpService is accessed", () => {
    const files = [
      {
        id: "f1",
        action: "update" as const,
        instancePath: "ServerScriptService/DataSaver",
        className: "Script",
        source: 'local DataStoreService = game:GetService("DataStoreService"); local store = DataStoreService:GetDataStore("Save")',
        reason: "save data"
      }
    ];
    const report = generateDeterministicReviewReport(
      files,
      { ok: true, blockedPatterns: [] },
      "save data to datastore",
      100
    );
    expect(report.riskLevel).toBe("high");
    expect(report.confidenceScore).toBe(80); // 98 - 18
    expect(report.dataStoreFindings).toContain("DataStore access in ServerScriptService/DataSaver");
    expect(report.validationChecklist).toContain("Verify datastore keys are scoped correctly and handle player loading failures gracefully.");
  });

  it("returns medium risk for remote events or server script modifications", () => {
    const files = [
      {
        id: "f1",
        action: "create" as const,
        instancePath: "ReplicatedStorage/Events/StartGame",
        className: "RemoteEvent",
        reason: "add game remote"
      }
    ];
    const report = generateDeterministicReviewReport(
      files,
      { ok: true, blockedPatterns: [] },
      "add remote event",
      100
    );
    expect(report.riskLevel).toBe("medium");
    expect(report.confidenceScore).toBe(90); // 98 - 8
    expect(report.remoteEventFindings).toContain("Network communication event in ReplicatedStorage/Events/StartGame");
    expect(report.validationChecklist).toContain("Confirm client-to-server arguments are fully sanitized and validated on the server.");
  });

  it("returns safe risk for simple UI updates", () => {
    const files = [
      {
        id: "f1",
        action: "update" as const,
        instancePath: "StarterGui/ScreenGui/Frame/TextLabel",
        className: "TextLabel",
        source: "-- UI text change",
        reason: "change label text"
      }
    ];
    const report = generateDeterministicReviewReport(
      files,
      { ok: true, blockedPatterns: [] },
      "update ui label text",
      100
    );
    expect(report.riskLevel).toBe("safe");
    expect(report.confidenceScore).toBe(98);
    expect(report.uiFindings).toContain("UI Component modification at StarterGui/ScreenGui/Frame/TextLabel");
    expect(report.validationChecklist).toContain("Test UI layout on multiple resolutions in the Device Emulator.");
  });
});
