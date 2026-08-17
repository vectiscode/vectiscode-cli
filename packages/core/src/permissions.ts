import type { PermissionMode, ToolCall, ToolDefinition } from "./types.js";

export type PermissionAction = "allow" | "ask" | "deny";
export type PermissionScope = "tool" | "path" | "argument";

export interface PermissionRule {
  pattern: string;
  action: PermissionAction;
  scope?: PermissionScope;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        regex += ".*";
        index += 1;
        if (pattern[index + 1] === "/") index += 1;
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += ".";
      continue;
    }
    regex += escapeRegex(char);
  }
  return new RegExp(`^${regex}$`);
}

export function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*") && !pattern.includes("?")) return pattern === value;
  return globToRegex(pattern).test(value);
}

function extractPathArgument(call: ToolCall): string | null {
  const candidates = ["path", "file", "filePath", "target", "studio_id"];
  for (const key of candidates) {
    const value = call.arguments[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function extractArgumentStrings(call: ToolCall): string[] {
  const values: string[] = [];
  for (const value of Object.values(call.arguments)) {
    if (typeof value === "string") values.push(value);
    else if (typeof value === "number") values.push(String(value));
  }
  values.push(call.name);
  return values;
}

export function evaluatePermissionRule(rule: PermissionRule, call: ToolCall): boolean {
  const scope = rule.scope;
  if (!scope || scope === "tool") {
    if (wildcardMatch(rule.pattern, call.name)) return true;
  }
  if (!scope || scope === "path") {
    const path = extractPathArgument(call);
    if (path && wildcardMatch(rule.pattern, path)) return true;
  }
  if (!scope || scope === "argument") {
    for (const value of extractArgumentStrings(call)) {
      if (wildcardMatch(rule.pattern, value)) return true;
    }
  }
  return false;
}

export function evaluatePermissions(
  call: ToolCall,
  definition: ToolDefinition,
  rules: PermissionRule[],
  mode: PermissionMode,
  sessionApprovals: Set<string>
): PermissionAction {
  const callKey = `${call.name}:${JSON.stringify(call.arguments)}`;
  if (sessionApprovals.has(callKey)) return "allow";

  for (const rule of rules) {
    if (evaluatePermissionRule(rule, call)) return rule.action;
  }

  if (definition.risk === "unknown" || definition.risk === "destructive" || definition.risk === "external") return "ask";
  if (definition.risk === "read") return "allow";
  if (mode === "plan") return "deny";
  if (mode === "auto") return "allow";
  return "ask";
}

export class SessionPermissionCache {
  private readonly allowed = new Set<string>();
  private readonly denied = new Set<string>();

  approveForSession(call: ToolCall): void {
    this.allowed.add(`${call.name}:${JSON.stringify(call.arguments)}`);
  }

  denyForSession(call: ToolCall): void {
    this.denied.add(`${call.name}:${JSON.stringify(call.arguments)}`);
  }

  hasApproval(call: ToolCall): boolean {
    return this.allowed.has(`${call.name}:${JSON.stringify(call.arguments)}`);
  }

  isDenied(call: ToolCall): boolean {
    return this.denied.has(`${call.name}:${JSON.stringify(call.arguments)}`);
  }

  toSet(): Set<string> {
    return this.allowed;
  }
}
