import { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
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
import { createProviderRegistry } from "@vectiscode/providers";
import { RobloxToolExecutor, studioMcp } from "@vectiscode/roblox";

interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

interface ApprovalState {
  call: ToolCall;
  definition: ToolDefinition;
  resolve: (approved: boolean) => void;
}

function TuiApp({ initialSessionId }: { initialSessionId?: string }) {
  const { exit } = useApp();
  const config = loadConfig();
  const registry = useRef(createProviderRegistry(credentialVault));
  const [providerId, setProviderId] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [mode, setMode] = useState<PermissionMode>(config.permissionMode);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [receiptCount, setReceiptCount] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    void registry.current.get(providerId).validate().then((status) => setProviderReady(status.ok)).catch(() => setProviderReady(false));
  }, [providerId]);

  useInput((character, key) => {
    if (approval && (character.toLowerCase() === "y" || character.toLowerCase() === "n")) {
      approval.resolve(character.toLowerCase() === "y");
      setApproval(null);
      return;
    }
    if (key.ctrl && character === "c") {
      if (running) controller.current?.abort("Cancelled by user");
      else exit();
    }
  });

  const add = (role: TranscriptItem["role"], content: string): void => {
    setItems((current) => [...current, { id: `${Date.now()}-${Math.random()}`, role, content }].slice(-80));
  };

  const handleCommand = (value: string): boolean => {
    const [command, ...argumentsValue] = value.slice(1).split(/\s+/);
    if (command === "help") add("system", "/new /sessions /provider <id> /model <id> /mode <plan|supervised|auto> /studio /clear /exit");
    else if (command === "clear") setItems([]);
    else if (command === "new") { setSessionId(undefined); add("system", "A new session will start with the next prompt."); }
    else if (command === "sessions") add("system", sessionStore.listSessions().slice(0, 8).map((session) => `${session.id.slice(0, 8)}  ${session.projectName}  ${session.provider}/${session.model}`).join("\n") || "No sessions yet.");
    else if (command === "provider" && argumentsValue[0]) setProviderId(argumentsValue[0]);
    else if (command === "model" && argumentsValue[0]) setModel(argumentsValue[0]);
    else if (command === "mode" && ["plan", "supervised", "auto"].includes(argumentsValue[0])) setMode(argumentsValue[0] as PermissionMode);
    else if (command === "studio") add("system", `${studioMcp.status().connected ? "Studio connected" : "Studio offline"}: ${studioMcp.status().detail}`);
    else if (command === "exit" || command === "quit") exit();
    else add("system", `Unknown command: /${command}. Use /help.`);
    return true;
  };

  const submit = async (value: string): Promise<void> => {
    const prompt = value.trim();
    if (!prompt || running || approval) return;
    setInput("");
    if (prompt.startsWith("/")) { handleCommand(prompt); return; }
    if (!providerReady) {
      add("system", `${providerId} is not configured. Run vectiscode providers login ${providerId}, then restart.`);
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
      if (event.type === "tool.requested") add("tool", `Requested ${String((event.payload.call as { name?: string } | undefined)?.name ?? "tool")}`);
      if (event.type === "tool.completed") setReceiptCount((count) => count + 1);
      if (event.type === "usage.recorded") {
        const record = event.payload.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        setUsage((current) => ({ input: current.input + (record?.inputTokens ?? 0), output: current.output + (record?.outputTokens ?? 0) }));
      }
    };
    try {
      const result = await runAgent({
        prompt,
        cwd: process.cwd(),
        provider: registry.current.get(providerId),
        model,
        permissionMode: mode,
        sessionId,
        tools: new RobloxToolExecutor(),
        signal: controller.current.signal,
        onEvent,
        approve: (call, definition) => new Promise<boolean>((resolveApproval) => setApproval({ call, definition, resolve: resolveApproval }))
      });
      setSessionId(result.sessionId);
      if (!assistantId && result.text) add("assistant", result.text);
    } catch (error) {
      add("system", error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setRunning(false);
    }
  };

  const studioStatus = studioMcp.status();
  return (
    <Box flexDirection="column" minHeight={20}>
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text bold color="white">vectiscode</Text>
        <Text dimColor>{providerId}/{model}  {mode}  {studioStatus.connected ? "studio connected" : "studio offline"}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {items.length === 0 ? (
          <Box flexDirection="column">
            <Text bold>Roblox work, from the terminal.</Text>
            <Text dimColor>Inspect the project, review mutations, verify in Studio.</Text>
            <Text dimColor>{providerReady === false ? `Configure ${providerId}: vectiscode providers login ${providerId}` : "Type a prompt or /help."}</Text>
          </Box>
        ) : items.map((item) => (
          <Box key={item.id} marginBottom={1} flexDirection="column">
            <Text color={item.role === "user" ? "cyan" : item.role === "system" ? "yellow" : item.role === "tool" ? "magenta" : "white"} bold={item.role === "user"}>
              {item.role === "user" ? "> " : item.role === "tool" ? "tool  " : ""}{item.content}
            </Text>
          </Box>
        ))}
        {running && !approval ? <Text dimColor>Working... Ctrl+C cancels this turn.</Text> : null}
        {approval ? (
          <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
            <Text color="yellow" bold>Approval required</Text>
            <Text>{approval.definition.risk}  {approval.call.name}</Text>
            <Text dimColor>{JSON.stringify(approval.call.arguments).slice(0, 300)}</Text>
            <Text>Press y to approve or n to reject.</Text>
          </Box>
        ) : null}
      </Box>
      <Box borderStyle="single" borderColor={running ? "yellow" : "gray"} paddingX={1}>
        <Text color="cyan">&gt; </Text>
        <TextInput value={input} onChange={setInput} onSubmit={(value) => { void submit(value); }} focus={!approval && !running} placeholder={running ? "Agent is working" : "Ask VectisCode"} />
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>{sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}  receipts {receiptCount}</Text>
        <Text dimColor>tokens {usage.input} in / {usage.output} out</Text>
      </Box>
    </Box>
  );
}

export async function startTui(initialSessionId?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("VectisCode interactive mode requires a TTY. Use vectiscode run \"your prompt\" for headless execution.\n");
    return;
  }
  const app = render(<TuiApp initialSessionId={initialSessionId} />);
  await app.waitUntilExit();
}
