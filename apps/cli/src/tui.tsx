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

interface SlashCommand {
  name: string;
  args?: string;
  category: "Studio" | "Model" | "Session" | "System";
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/connect", description: "Connect or check Roblox Studio MCP server", category: "Studio" },
  { name: "/studio", args: "<status|select>", description: "Inspect or select active Studio instance", category: "Studio" },
  { name: "/playtest", args: "<start|stop>", description: "Start or stop playtesting in Roblox Studio", category: "Studio" },
  { name: "/verify", description: "Run Studio visual QA, console capture, and diagnostics", category: "Studio" },
  { name: "/mcp", description: "List connected Roblox Studio MCP tools and risk levels", category: "Studio" },
  { name: "/models", args: "[provider]", description: "List available models for provider", category: "Model" },
  { name: "/provider", args: "<id>", description: "Switch active provider (e.g. openai, anthropic, google, groq, ollama)", category: "Model" },
  { name: "/model", args: "<name>", description: "Switch active model (e.g. gpt-4o, claude-3-7-sonnet, gemini-2.5-pro)", category: "Model" },
  { name: "/agent", args: "<plan|build>", description: "Switch mode: plan (read-only) or build (supervised writes)", category: "System" },
  { name: "/permissions", description: "View current permission mode and policy rules", category: "System" },
  { name: "/sessions", args: "[id]", description: "List saved sessions or resume by ID / index", category: "Session" },
  { name: "/new", description: "Start a fresh session", category: "Session" },
  { name: "/compact", description: "Compact session context to free up token budget", category: "Session" },
  { name: "/undo", args: "<checkpointId>", description: "Roll back a file mutation checkpoint", category: "Session" },
  { name: "/clear", description: "Clear transcript screen", category: "System" },
  { name: "/help", description: "Show all available commands and keyboard shortcuts", category: "System" },
  { name: "/exit", description: "Exit VectisCode TUI", category: "System" }
];

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
  const [projectRoot, setProjectRoot] = useState<string>(initialProject ?? process.cwd());
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [receiptCount, setReceiptCount] = useState(0);
  const [providerReady, setProviderReady] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columns, setColumns] = useState(process.stdout.columns || 80);

  const controller = useRef<AbortController | null>(null);
  const registry = useRef(createProviderRegistry(credentialVault));
  const executor = useRef(new RobloxToolExecutor(studioMcp));
  const promptQueue = useRef<string[]>([]);

  useEffect(() => {
    const onResize = () => setColumns(process.stdout.columns || 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => {
    void registry.current.get(providerId).validate().then((outcome) => setProviderReady(outcome.ok)).catch(() => setProviderReady(false));
  }, [providerId]);

  const commandQuery = input.startsWith("/") ? input.slice(1).toLowerCase().split(/\s+/)[0] : null;
  const filteredCommands = commandQuery !== null
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.slice(1).toLowerCase().startsWith(commandQuery))
    : [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [input]);

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

    if (filteredCommands.length > 0 && input.startsWith("/")) {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.tab) {
        const chosen = filteredCommands[selectedIndex];
        if (chosen) {
          setInput(chosen.args ? `${chosen.name} ` : chosen.name);
        }
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
        "VectisCode CLI Commands",
        "",
        "Studio MCP Integration:",
        "  /connect              Connect or verify Roblox Studio MCP server",
        "  /studio <status>      Inspect active Roblox Studio connection",
        "  /playtest <start|stop> Control Studio playtesting session",
        "  /verify               Run Studio visual QA and diagnostics probe",
        "  /mcp                  List connected Studio MCP tools and risk levels",
        "",
        "Provider & Models:",
        "  /models [provider]    List available models for provider",
        "  /provider <id>        Switch active provider (e.g. openai, anthropic, google, groq, ollama)",
        "  /model <name>         Switch active model (e.g. gpt-4o, claude-3-7-sonnet, gemini-2.5-pro)",
        "",
        "Sessions & Files:",
        "  /sessions [id]        List saved sessions or resume by ID / index",
        "  /new                  Start a fresh conversation session",
        "  /compact              Compact active session context",
        "  /undo <checkpointId>  Roll back a file mutation checkpoint",
        "",
        "Agent & System:",
        "  /agent <plan|build>   Switch mode: plan (read-only) or build (supervised writes)",
        "  /permissions          View current permission rules and risk policy",
        "  /clear                Clear transcript messages from the screen",
        "  /help                 Show this help overview",
        "  /exit                 Exit the TUI",
        "",
        "Tip: Type / in the prompt to open the command palette. Use Tab to autocomplete."
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
          if (selected.projectPath) setProjectRoot(selected.projectPath);
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
    } else if (command === "studio") {
      const status = studioMcp.status();
      add("system", `Studio MCP Status:\n  Launcher: ${status.command}\n  Connected: ${status.connected ? "Yes" : "No"}\n  Detail: ${status.detail}`);
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
          const res = rollbackCheckpoint(arg, projectRoot);
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
      promptQueue.current.push(prompt);
      add("system", `Queued follow-up (#${promptQueue.current.length}): "${prompt}"`);
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
        cwd: projectRoot,
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
      if (promptQueue.current.length > 0) {
        const nextPrompt = promptQueue.current.shift()!;
        setTimeout(() => void submit(nextPrompt), 50);
      }
    }
  };

  const statusColor = studioMcp.status().connected ? "green" : "gray";
  const isNarrow = columns < 100;

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">vectiscode</Text>
        <Text>{providerId}/{model} <Text color="yellow">[{mode}]</Text></Text>
        <Text color={statusColor}>Studio: {studioMcp.status().connected ? "Connected" : "Offline"}</Text>
        {!isNarrow && <Text dimColor>Tokens: {usage.input + usage.output} | Receipts: {receiptCount}</Text>}
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

      {filteredCommands.length > 0 && input.startsWith("/") && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Box justifyContent="space-between" marginBottom={0}>
            <Text bold color="cyan">Commands ({filteredCommands.length})</Text>
            {!isNarrow && <Text dimColor>↑/↓ navigate • Tab complete • Enter run</Text>}
          </Box>
          {filteredCommands.slice(0, 7).map((cmd, index) => {
            const isSelected = index === selectedIndex;
            const leftText = `${isSelected ? "▶ " : "  "}${cmd.name} ${cmd.args ? cmd.args : ""}`;
            const maxDesc = Math.max(10, columns - leftText.length - 8);
            const desc = cmd.description.length > maxDesc ? `${cmd.description.slice(0, maxDesc - 1)}…` : cmd.description;
            return (
              <Box key={cmd.name} justifyContent="space-between">
                <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                  {isSelected ? "▶ " : "  "}{cmd.name} {cmd.args ? chalk.dim(cmd.args) : ""}
                </Text>
                {columns >= 70 && (
                  <Text dimColor={!isSelected} color={isSelected ? "yellow" : undefined}>
                    {desc}
                  </Text>
                )}
              </Box>
            );
          })}
          {filteredCommands.length > 7 && (
            <Text dimColor italic>  ...and {filteredCommands.length - 7} more. Keep typing to filter.</Text>
          )}
        </Box>
      )}

      {approval ? (
        <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text bold color="yellow">Permission Required: {approval.call.name}</Text>
          <Text dimColor>Arguments: {JSON.stringify(approval.call.arguments)}</Text>
          <Text color="yellow">Approve tool call? [Y]es once / [A]llow for session / [N]o deny</Text>
        </Box>
      ) : (
        <Box borderStyle="single" borderColor={running ? "yellow" : "gray"} paddingX={1}>
          <Text bold color="cyan">&gt; </Text>
          <TextInput value={input} onChange={setInput} onSubmit={(v) => void submit(v)} placeholder="Ask a question, request changes, or type / for commands" />
        </Box>
      )}
    </Box>
  );
};

export function startTui(initialProject?: string): void {
  render(<TerminalApp initialProject={initialProject} />);
}
