import { useEffect, useRef, useState, type FC } from "react";
import chalk from "chalk";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import {
  credentialVault,
  loadConfig,
  runAgent,
  sessionStore,
  type AgentEvent,
  type PermissionMode,
  type ToolCall,
  type ToolDefinition
} from "@vectiscode/core";
import { createProviderRegistry, providerCatalog } from "@vectiscode/providers";
import { RobloxToolExecutor, rollbackCheckpoint, studioMcp } from "@vectiscode/roblox";

interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "reasoning";
  content: string;
}

interface ApprovalRequest {
  call: ToolCall;
  definition: ToolDefinition;
  resolve: (value: boolean | "approve-session") => void;
}

export const TerminalApp: FC<{ initialProject?: string }> = ({ initialProject }) => {
  const { exit } = useApp();
  const config = loadConfig(initialProject);
  const [providerId, setProviderId] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [mode, setMode] = useState<PermissionMode>(config.permissionMode);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [receiptCount, setReceiptCount] = useState(0);
  const [providerReady, setProviderReady] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const registry = useRef(createProviderRegistry(credentialVault));
  const executor = useRef(new RobloxToolExecutor(studioMcp));

  useEffect(() => {
    void registry.current.get(providerId).validate().then((outcome) => setProviderReady(outcome.ok)).catch(() => setProviderReady(false));
  }, [providerId]);

  useInput((character, key) => {
    if (approval) {
      const lower = character.toLowerCase();
      if (lower === "y") {
        approval.resolve(true);
        setApproval(null);
        return;
      }
      if (lower === "a") {
        approval.resolve("approve-session");
        setApproval(null);
        return;
      }
      if (lower === "n") {
        approval.resolve(false);
        setApproval(null);
        return;
      }
    }
    if (key.escape || (key.ctrl && character === "c")) {
      if (running) {
        controller.current?.abort("Cancelled by user");
        add("system", "Turn cancelled by user.");
      } else {
        exit();
      }
    }
  });

  const add = (role: TranscriptItem["role"], content: string): void => {
    setItems((current) => [...current, { id: `${Date.now()}-${Math.random()}`, role, content }].slice(-100));
  };

  const handleCommand = async (value: string): Promise<boolean> => {
    const [command, ...argumentsValue] = value.slice(1).split(/\s+/);
    const arg = argumentsValue.join(" ");

    if (command === "help") {
      add("system", [
        "Commands:",
        "  /connect              Connect or check Studio MCP server",
        "  /models [provider]    List available models for provider",
        "  /provider <id>        Switch active provider (e.g. anthropic, openai, google)",
        "  /model <name>         Switch active model (e.g. claude-3-7-sonnet, gpt-4o)",
        "  /agent <plan|build>   Switch mode: plan (read-only) or build (supervised)",
        "  /permissions          View current permission mode and policy",
        "  /sessions [id]        List sessions or switch to session ID",
        "  /new                  Start a new session",
        "  /compact              Compact active session context",
        "  /undo [checkpointId]  Roll back a file mutation checkpoint",
        "  /playtest [start|stop] Control Roblox Studio playtest",
        "  /verify               Run Studio visual QA and diagnostics",
        "  /mcp                  List connected Studio MCP tools",
        "  /clear                Clear transcript screen",
        "  /exit                 Exit VectisCode"
      ].join("\n"));
    } else if (command === "clear") {
      setItems([]);
    } else if (command === "new") {
      setSessionId(undefined);
      add("system", "New session initialized. Next prompt will start a fresh session.");
    } else if (command === "sessions") {
      const all = sessionStore.listSessions();
      if (!arg) {
        if (!all.length) {
          add("system", "No saved sessions found.");
        } else {
          const list = all.slice(0, 10).map((s, i) => `[${i + 1}] ${s.id.slice(0, 8)} | ${s.projectName} | ${s.provider}/${s.model} | ${s.permissionMode} (${new Date(s.updatedAt).toLocaleTimeString()})`).join("\n");
          add("system", `Recent sessions:\n${list}\n\nUse /sessions <id or number> to resume.`);
        }
      } else {
        const target = parseInt(arg, 10);
        const selected = !isNaN(target) && target > 0 && target <= all.length ? all[target - 1] : sessionStore.resolveSession(arg);
        if (selected) {
          setSessionId(selected.id);
          setProviderId(selected.provider);
          setModel(selected.model);
          setMode(selected.permissionMode);
          const events = sessionStore.readEvents(selected.id);
          const reconstructed: TranscriptItem[] = [];
          for (const ev of events) {
            if (ev.type === "turn.started" && typeof ev.payload.prompt === "string") {
              reconstructed.push({ id: `${ev.seq}-u`, role: "user", content: ev.payload.prompt });
            }
            if (ev.type === "turn.completed" && typeof ev.payload.text === "string") {
              reconstructed.push({ id: `${ev.seq}-a`, role: "assistant", content: ev.payload.text });
            }
          }
          setItems(reconstructed.slice(-50));
          add("system", `Switched to session ${selected.id.slice(0, 8)} (${selected.projectName}) with ${events.length} events.`);
        } else {
          add("system", `Could not find session "${arg}".`);
        }
      }
    } else if (command === "connect") {
      add("system", "Connecting to Roblox Studio MCP server...");
      try {
        const status = await studioMcp.connect();
        add("system", status.connected ? `Connected: ${status.detail}` : `Offline: ${status.detail}`);
      } catch (err) {
        add("system", `Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (command === "models") {
      const target = argumentsValue[0] ?? providerId;
      try {
        const list = await registry.current.get(target).listModels();
        add("system", list.slice(0, 15).map((m) => `  ${m.id} (${m.label})`).join("\n") || `No models found for ${target}`);
      } catch (err) {
        const catalogEntry = providerCatalog.find((entry) => entry.id === target);
        if (catalogEntry && catalogEntry.models.length) {
          add("system", `Available models for ${target}:\n` + catalogEntry.models.map((m) => `  ${m.id} (${m.label})`).join("\n"));
        } else {
          add("system", `Could not list models for ${target}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (command === "provider" && argumentsValue[0]) {
      setProviderId(argumentsValue[0]);
      add("system", `Provider set to ${argumentsValue[0]}`);
    } else if (command === "model" && argumentsValue[0]) {
      setModel(argumentsValue[0]);
      add("system", `Model set to ${argumentsValue[0]}`);
    } else if (command === "agent" && argumentsValue[0]) {
      if (argumentsValue[0] === "plan") {
        setMode("plan");
        add("system", "Agent set to plan mode (read-only).");
      } else if (argumentsValue[0] === "build") {
        setMode("supervised");
        add("system", "Agent set to build mode (supervised mutations).");
      } else {
        add("system", "Agent mode must be 'plan' or 'build'.");
      }
    } else if (command === "permissions") {
      add("system", `Active mode: ${mode}. Rules: plan (read-only), supervised (asks before file/studio writes), auto (allows workspace writes). Destructive actions always require approval.`);
    } else if (command === "compact") {
      if (!sessionId) {
        add("system", "No active session to compact.");
      } else {
        const result = sessionStore.compactSession(sessionId);
        add("system", `Compaction complete: retained ${result.kept} events, summarized ${result.summarized} older events.`);
      }
    } else if (command === "undo") {
      if (!arg) {
        add("system", "Usage: /undo <checkpointId>");
      } else {
        try {
          const res = rollbackCheckpoint(arg, initialProject ?? process.cwd());
          add("system", `Rollback successful: restored ${res.restored} to previous checkpoint.`);
        } catch (err) {
          add("system", `Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (command === "playtest") {
      const sub = argumentsValue[0]?.toLowerCase();
      try {
        if (sub === "stop") {
          const res = await studioMcp.stopPlaytest();
          add("system", `Studio playtest stopped (studioId: ${res.studioId ?? "active"}).`);
        } else {
          const res = await studioMcp.startPlaytest();
          add("system", `Studio playtest started at ${res.startedAt} (active: ${res.active}).`);
        }
      } catch (err) {
        add("system", `Playtest error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (command === "verify") {
      add("system", "Running Studio visual QA and diagnostics probe...");
      try {
        const qa = await studioMcp.runVisualQa();
        add("system", `Visual QA: ${qa.summary} (ok: ${qa.ok})`);
      } catch (err) {
        add("system", `Verification probe error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (command === "mcp") {
      const tools = studioMcp.definitions();
      if (!tools.length) {
        add("system", "No Studio MCP tools connected. Run /connect first.");
      } else {
        const list = tools.map((t) => `  ${t.name} [${t.risk}]: ${t.description}`).join("\n");
        add("system", `Studio MCP Tools (${tools.length}):\n${list}`);
      }
    } else if (command === "exit" || command === "quit") {
      exit();
    } else {
      add("system", `Unknown command: /${command}. Type /help for all available commands.`);
    }
    return true;
  };

  const submit = async (value: string): Promise<void> => {
    const prompt = value.trim();
    if (!prompt) return;

    if (running) {
      setQueuedPrompt(prompt);
      add("system", `Queued follow-up: "${prompt}"`);
      setInput("");
      return;
    }

    if (approval) return;
    setInput("");

    if (prompt.startsWith("/")) {
      await handleCommand(prompt);
      return;
    }

    if (!providerReady) {
      add("system", `${providerId} is not configured with an API key. Run 'vectiscode providers login ${providerId}', then restart.`);
      return;
    }

    add("user", prompt);
    setRunning(true);
    setReceiptCount(0);
    controller.current = new AbortController();

    let assistantId: string | null = null;
    const onEvent = (event: AgentEvent): void => {
      if (event.type === "message.delta" && typeof event.payload.delta === "string") {
        const delta = event.payload.delta;
        setItems((current) => {
          if (assistantId) return current.map((item) => item.id === assistantId ? { ...item, content: item.content + delta } : item);
          assistantId = `${Date.now()}-assistant`;
          return [...current, { id: assistantId, role: "assistant", content: delta }];
        });
      }
      if (event.type === "reasoning.delta" && typeof event.payload.delta === "string") {
        const delta = event.payload.delta;
        setItems((current) => {
          const reasoningId = `${assistantId ?? "cur"}-reasoning`;
          const existing = current.find((i) => i.id === reasoningId);
          if (existing) return current.map((item) => item.id === reasoningId ? { ...item, content: item.content + delta } : item);
          return [...current, { id: reasoningId, role: "reasoning", content: delta }];
        });
      }
      if (event.type === "tool.requested") {
        const call = event.payload.call as ToolCall | undefined;
        add("tool", `[Executing] ${call?.name ?? "tool"} with ${JSON.stringify(call?.arguments ?? {})}`);
      }
      if (event.type === "tool.completed") {
        setReceiptCount((count) => count + 1);
        const rec = event.payload.receipt as { toolName?: string; ok?: boolean; summary?: string } | undefined;
        add("tool", `[${rec?.ok ? "Success" : "Failed"}] ${rec?.toolName}: ${rec?.summary}`);
      }
      if (event.type === "usage.recorded") {
        const record = event.payload.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        setUsage((current) => ({ input: current.input + (record?.inputTokens ?? 0), output: current.output + (record?.outputTokens ?? 0) }));
      }
    };

    try {
      const result = await runAgent({
        prompt,
        cwd: initialProject ?? process.cwd(),
        provider: registry.current.get(providerId),
        model,
        tools: executor.current,
        permissionMode: mode,
        sessionId,
        signal: controller.current.signal,
        approve: (call, definition) => new Promise((resolveApproval) => {
          setApproval({ call, definition, resolve: resolveApproval });
        }),
        onEvent
      });
      setSessionId(result.sessionId);
    } catch (error) {
      if (!controller.current?.signal.aborted) {
        add("system", `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setRunning(false);
      setApproval(null);
      if (queuedPrompt) {
        const next = queuedPrompt;
        setQueuedPrompt(null);
        setTimeout(() => void submit(next), 100);
      }
    }
  };

  const statusColor = studioMcp.status().connected ? "green" : "gray";

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">vectiscode</Text>
        <Text>{providerId}/{model} <Text color="yellow">[{mode}]</Text></Text>
        <Text color={statusColor}>Studio: {studioMcp.status().connected ? "Connected" : "Offline"}</Text>
        <Text dimColor>Tokens: {usage.input + usage.output} | Receipts: {receiptCount}</Text>
      </Box>

      <Box flexDirection="column" marginY={1} minHeight={10}>
        {items.map((item) => (
          <Box key={item.id} marginY={0}>
            {item.role === "user" ? (
              <Text bold color="blue">&gt; {item.content}</Text>
            ) : item.role === "assistant" ? (
              <Text color="white">{item.content}</Text>
            ) : item.role === "reasoning" ? (
              <Text dimColor italic>[Thinking: {item.content.slice(0, 120)}...]</Text>
            ) : item.role === "tool" ? (
              <Text color="magenta">{item.content}</Text>
            ) : (
              <Text dimColor>{chalk.gray(item.content)}</Text>
            )}
          </Box>
        ))}
      </Box>

      {approval ? (
        <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text bold color="yellow">Permission Required: {approval.call.name}</Text>
          <Text dimColor>Arguments: {JSON.stringify(approval.call.arguments)}</Text>
          <Text color="yellow">Approve tool call? [Y]es once / [A]llow for session / [N]o deny</Text>
        </Box>
      ) : (
        <Box borderStyle="single" borderColor={running ? "yellow" : "gray"} paddingX={1}>
          <Text bold color="cyan">&gt; </Text>
          <TextInput value={input} onChange={setInput} onSubmit={(v) => void submit(v)} placeholder="Ask a question, request changes, or type /help" />
        </Box>
      )}
    </Box>
  );
};

export function startTui(initialProject?: string): void {
  render(<TerminalApp initialProject={initialProject} />);
}
