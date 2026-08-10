#!/usr/bin/env node
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

if (!existsSync(new URL("../apps/api/dist/services/aiProvider.js", import.meta.url))) {
  throw new Error("apps/api/dist is missing. Run npm run build before npm run smoke:agent.");
}

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const model = arg("--model", "gemini-3.5-flash");
const { answerProjectQuestion, generateSafeChangeSet } = await import("../apps/api/dist/services/aiProvider.js");

const project = {
  id: "agent_smoke_project",
  organizationId: "agent_smoke_org",
  name: "Agent Runtime Smoke",
  template: "simulator",
  description: "A live provider smoke fixture with existing client and server systems.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const snapshot = {
  id: "agent_smoke_snapshot",
  projectId: project.id,
  createdAt: new Date().toISOString(),
  nodes: [
    { path: "ReplicatedStorage/Remotes/SprintUpdate", className: "RemoteEvent" },
    { path: "StarterPlayer/StarterPlayerScripts/SprintClient", className: "LocalScript", source: "local remote = game.ReplicatedStorage.Remotes.SprintUpdate\nremote:FireServer(true)" },
    { path: "ServerScriptService/SprintServer", className: "Script", source: "local remote = game.ReplicatedStorage.Remotes.SprintUpdate\nremote.OnServerEvent:Connect(function(player, active) player.Character.Humanoid.WalkSpeed = active and 24 or 16 end)" }
  ]
};
const toolNames = [];
const studioTools = {
  enabled: true,
  maxIterations: 8,
  onToolCall: (names) => toolNames.push(...names.split(",").map((name) => name.trim()).filter(Boolean)),
  execute: async (calls) => calls.map((call) => {
    if (["insert_asset", "start_play", "stop_play", "set_breakpoint", "clear_breakpoints"].includes(call.name)) {
      throw new Error(`Unsafe answer-mode tool exposed: ${call.name}`);
    }
    const node = snapshot.nodes.find((candidate) => candidate.path === call.input.path);
    return { id: call.id, name: call.name, result: node ? { node } : { nodes: snapshot.nodes } };
  })
};

const startedAt = performance.now();
const answer = await answerProjectQuestion({
  project,
  snapshot,
  model,
  prompt: "Inspect the sprint client and server. Explain the security weakness and the smallest correct fix.",
  thinkingLevel: "medium",
  studioTools
});
if (!answer.text || /<VECTIS_TOOL|finalize_changeset/i.test(answer.text)) throw new Error("Answer leaked internal tool protocol.");

const patch = await generateSafeChangeSet({
  project,
  snapshot,
  model,
  prompt: "Fix the existing sprint system so the server validates state and movement instead of trusting the client. Update only the relevant scripts and reuse SprintUpdate.",
  thinkingLevel: "medium",
  maxRepairAttempts: 1,
  luauGuard: true,
  studioTools
});
if (!patch.safety?.ok || patch.files.length === 0) throw new Error(`Agent patch failed: ${patch.safety?.blockedPatterns?.join(", ") || "no files"}`);

console.log(JSON.stringify({
  ok: true,
  model,
  latencyMs: Math.round(performance.now() - startedAt),
  toolCalls: toolNames,
  answerSample: answer.text.slice(0, 160),
  patchFiles: patch.files.map((file) => file.instancePath)
}, null, 2));
