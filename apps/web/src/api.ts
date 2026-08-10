import type { AdminPaymentOverview, AdminProductInsights, AdminUser, AiMessage, Attachment, AuthConfig, BillingCycle, BillingStatus, BootstrapData, ChangeSet, CustomerEvidenceExport, Diagnostics, PlanName, TopUpPack, UserPreferences, ModelEvaluationRun, ModelEvaluationLeaderboardEntry, TaskPlan, PatchComment } from "./types";
import { reportClientError } from "./clientDiagnostics";

const base = import.meta.env.VITE_API_URL || "/api";
const CHAT_CLIENT_TIMEOUT_MS = 660_000;

const withdrawalConsent = {
  immediateAccessRequested: true,
  withdrawalAcknowledged: true
} as const;

export class ApiError extends Error {
  status: number;
  issues?: unknown;
  code?: string;
  payload?: Record<string, unknown>;

  constructor(message: string, status: number, issues?: unknown, payload?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
    this.payload = payload;
    this.code = typeof payload?.code === "string" ? payload.code : undefined;
  }
}

function apiErrorMessage(error: any, status: number) {
  if (error?.code === "usage_limit_reached") {
    return String(error.message || error.error || "Usage limit reached");
  }
  return error?.error
    ? `${error.error} (${status})`
    : `Request failed (${status})`;
}

function isChatMutationPath(path: string) {
  return /\/projects\/[^/]+\/chat$/.test(path) || /\/projects\/[^/]+\/messages\/[^/]+$/.test(path);
}

function cookieValue(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

function requestHeaders(init: RequestInit | undefined, defaults: HeadersInit = {}) {
  const headers = new Headers(defaults);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const method = (init?.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = cookieValue("ras_csrf");
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  return headers;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const isChatMutation = isChatMutationPath(path);
  const controller = isChatMutation ? new AbortController() : undefined;
  const timer = controller ? window.setTimeout(() => controller.abort(), CHAT_CLIENT_TIMEOUT_MS) : undefined;
  const hasBody = init?.body !== undefined && init.body !== null;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: requestHeaders(init, hasBody ? { "Content-Type": "application/json" } : {}),
      credentials: "include",
      signal: controller?.signal
    });
  } catch (error) {
    const message = isChatMutation
      ? (error instanceof DOMException && error.name === "AbortError"
          ? "The connection dropped while the model was working. Vectis is checking for the saved response."
          : "The connection dropped while the model was working. Vectis is checking for the saved response.")
      : "Could not reach the Vectis Code API. Please check your connection.";
    reportClientError({
      kind: "api_unreachable",
      message,
      apiPath: path,
      metadata: {
        method: init?.method ?? "GET"
      }
    });
    throw new ApiError(message, 0, undefined, isChatMutation ? { code: "chat_connection_recovering" } : undefined);
  } finally {
    if (timer) window.clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    const message = apiErrorMessage(error, response.status);
    reportClientError({
      kind: "api_error",
      message,
      apiPath: path,
      statusCode: response.status,
      metadata: {
        method: init?.method ?? "GET",
        issues: error.issues
      }
    });
    throw new ApiError(message, response.status, error.issues, error);
  }

  return response.json() as Promise<T>;
}

async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const isChatMutation = isChatMutationPath(path);
  const controller = isChatMutation ? new AbortController() : undefined;
  const timer = controller ? window.setTimeout(() => controller.abort(), CHAT_CLIENT_TIMEOUT_MS) : undefined;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: requestHeaders(init),
      credentials: "include",
      signal: controller?.signal
    });
  } catch (error) {
    const message = isChatMutation
      ? (error instanceof DOMException && error.name === "AbortError"
          ? "The connection dropped while the model was working. Vectis is checking for the saved response."
          : "The connection dropped while the model was working. Vectis is checking for the saved response.")
      : "Could not reach the Vectis Code API. Please check your connection.";
    reportClientError({
      kind: "api_unreachable",
      message,
      apiPath: path,
      metadata: {
        method: init?.method ?? "GET"
      }
    });
    throw new ApiError(message, 0, undefined, isChatMutation ? { code: "chat_connection_recovering" } : undefined);
  } finally {
    if (timer) window.clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    const message = apiErrorMessage(error, response.status);
    reportClientError({
      kind: "api_error",
      message,
      apiPath: path,
      statusCode: response.status,
      metadata: {
        method: init?.method ?? "GET",
        issues: error.issues
      }
    });
    throw new ApiError(message, response.status, error.issues, error);
  }

  return response.json() as Promise<T>;
}

export const api = {
  diagnostics: () => json<Diagnostics>("/diagnostics"),
  adminUsers: (input: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return json<{ users: AdminUser[]; total: number; nextCursor?: string }>(`/admin/users${query}`);
  },
  adminPayments: () => json<AdminPaymentOverview>("/admin/payments"),
  adminEvidence: (userId: string) => json<CustomerEvidenceExport>(`/admin/users/${encodeURIComponent(userId)}/evidence`),
  adminEvidenceJsonUrl: (userId: string) => `${base}/admin/users/${encodeURIComponent(userId)}/evidence.json`,
  adminEvidenceCsvUrl: (userId: string) => `${base}/admin/users/${encodeURIComponent(userId)}/evidence.csv`,
  adminClientErrors: () => json<{ events: CustomerEvidenceExport["events"] }>("/admin/client-errors"),
  adminInsights: () => json<AdminProductInsights>("/admin/insights"),
  adminEvaluations: () => json<{ runs: ModelEvaluationRun[]; scenarios: any[]; leaderboard: ModelEvaluationLeaderboardEntry[] }>("/admin/evaluations"),
  adminModelHealth: () => json<{ results: Array<{ modelId: string; usedModelId?: string; ok: boolean; latencyMs: number; thinkingLevel: string; thinkingMultiplier: number; text?: string; error?: string }> }>("/admin/model-health"),
  adminProviderHealth: () => json<{
    timestamp: string;
    providers: Array<{
      id: string;
      name: string;
      reachable: boolean;
      latencyMs: number;
      error: string | null;
      credits?: {
        usedUsd?: number;
        limitUsd?: number;
        remainingUsd?: number;
        isUnlimited?: boolean;
        details: string;
      };
      models: Array<{ id: string; name: string; status: string; note: string }>;
    }>;
  }>("/admin/provider-health"),
  adminRunEvaluation: (input: { promptId: "leaderstats" | "sprint" | "shop" | "custom" | "all"; customPromptText?: string; models?: string[]; judgeEnabled?: boolean }) =>
    json<{ run: ModelEvaluationRun; runs: ModelEvaluationRun[]; totalCostCredits: number; estimatedCostCredits: number; estimatedProviderCostUsd: number; creditBalance: number }>("/admin/evaluations/run", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adminDeleteEvaluation: (runId: string) =>
    json<{ ok: boolean; deleted: string }>(`/admin/evaluations/${encodeURIComponent(runId)}`, {
      method: "DELETE"
    }),
  adminClearEvaluations: () =>
    json<{ ok: boolean; deleted: number }>("/admin/evaluations", {
      method: "DELETE"
    }),
  adminSubscribers: () =>
    json<{ subscribers: Array<{ id: string; email: string; subscribedAt: string; ip?: string }> }>("/admin/subscribers"),
  adminDeleteSubscriber: (id: string) =>
    json<{ ok: boolean }>(`/admin/subscribers/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  subscribe: (email: string) =>
    json<{ ok: boolean; message: string }>("/subscribe", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  adminGiveCredits: (userId: string, delta: number, reason: string) =>
    json(`/admin/users/${userId}/credits`, {
      method: "POST",
      body: JSON.stringify({ delta, reason })
    }),
  adminAdjustUsagePercent: (userId: string, deltaPercent: number, reason: string) =>
    json(`/admin/users/${userId}/usage-adjustment`, {
      method: "POST",
      body: JSON.stringify({ deltaPercent, reason })
    }),
  adminResetUsage: (userId: string) =>
    json<{ ok: boolean; resetCredits: number; user: AdminUser }>(`/admin/users/${userId}/usage-reset`, {
      method: "POST"
    }),
  adminUpdatePlan: (userId: string, plan: string) =>
    json(`/admin/users/${userId}/plan`, {
      method: "PATCH",
      body: JSON.stringify({ plan })
    }),
  adminUpdateStatus: (userId: string, status: string) =>
    json(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  authConfig: () => json<AuthConfig>("/auth/config"),
  me: () => json<{ user: BootstrapData["user"] | null }>("/auth/me"),
  privateOwnerLogin: () =>
    json<{ user: BootstrapData["user"] }>("/auth/private-owner", {
      method: "POST",
      body: JSON.stringify({})
    }),
  firebaseLogin: (idToken: string) =>
    json<{ user: BootstrapData["user"] }>("/auth/firebase", {
      method: "POST",
      body: JSON.stringify({ idToken })
    }),
  supabaseLogin: (idToken: string) =>
    json<{ user: BootstrapData["user"] }>("/auth/supabase", {
      method: "POST",
      body: JSON.stringify({ idToken })
    }),
  logout: () =>
    json<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
      keepalive: true
    }),
  updateUserPreferences: (patch: UserPreferences) =>
    json<{ preferences: UserPreferences }>("/user/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteAccount: () =>
    json<{ ok: boolean }>("/user/account", {
      method: "DELETE"
    }),
  disconnectStudio: (sessionId: string) =>
    json(`/studio/sessions/${sessionId}/disconnect`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  clearLocalData: () =>
    json<{ ok: boolean }>("/local-data", {
      method: "DELETE"
    }),
  createCheckoutSession: (plan: Exclude<PlanName, "free"> = "pro", billingCycle: BillingCycle = "annual") =>
    json<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, billingCycle, ...withdrawalConsent })
    }),
  createTopUpSession: (input: TopUpPack["id"] | { usagePercent: number } | { credits: number }) =>
    json<{ url: string }>("/billing/top-up", {
      method: "POST",
      body: JSON.stringify({ ...(typeof input === "string" ? { pack: input } : input), ...withdrawalConsent })
    }),
  createBillingPortalSession: () =>
    json<{ url: string }>("/billing/portal", {
      method: "POST",
      body: JSON.stringify({})
    }),
  billingStatus: () => json<BillingStatus>("/billing/status"),
  searchRobloxMarketplace: (query: string, assetType: "model" | "image" | "mesh" | "audio" | "plugin" | "video" | "font" = "model", limit = 6) =>
    json<{ results: Array<{ id: number; name: string; description?: string; creatorName?: string; assetType?: string }>; note: string }>(
      `/roblox/marketplace/search?query=${encodeURIComponent(query)}&assetType=${encodeURIComponent(assetType)}&limit=${limit}`
    ),
  cancelSubscription: () =>
    json<{ ok: boolean, status: BillingStatus, message?: string }>("/billing/cancel", {
      method: "POST",
      body: JSON.stringify({})
    }),
  bootstrap: (exclude?: string[]) => json<BootstrapData>("/bootstrap" + (exclude && exclude.length > 0 ? `?exclude=${exclude.join(",")}` : "")),
  createProject: (name: string, description: string, template: string) =>
    json<{ project: BootstrapData["projects"][number] }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, description, template })
    }),
  renameProject: (projectId: string, name: string) =>
    json(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),
  deleteProject: (projectId: string) =>
    json(`/projects/${projectId}`, {
      method: "DELETE"
    }),
  claimPairing: (projectId: string, pairingCode: string) =>
    json(`/projects/${projectId}/studio/pair-project`, {
      method: "POST",
      body: JSON.stringify({ pairingCode })
    }),
  createThread: (projectId: string, name?: string) =>
    json<{ thread: BootstrapData["threads"][number] }>(`/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  renameThread: (projectId: string, threadId: string, name: string) =>
    json(`/projects/${projectId}/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),
  deleteThread: (projectId: string, threadId: string) =>
    json(`/projects/${projectId}/threads/${threadId}/delete`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  deleteThreads: (projectId: string, threadIds: string[]) =>
    json<{ ok: boolean; deleted: string[] }>(`/projects/${projectId}/threads/delete`, {
      method: "POST",
      body: JSON.stringify({ threadIds })
    }),
  uploadAttachment: (projectId: string, file: File, threadId?: string) =>
    rawJson<{ attachment: Attachment }>(`/projects/${projectId}/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        ...(threadId ? { "X-Thread-Id": threadId } : {})
      },
      body: file
    }),
  deleteAttachment: (projectId: string, attachmentId: string) =>
    json<{ ok: boolean }>(`/projects/${projectId}/attachments/${attachmentId}`, {
      method: "DELETE"
    }),
  attachmentContentUrl: (projectId: string, attachmentId: string, download = false) =>
    `${base}/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}/content${download ? "?download=1" : ""}`,
  generateIcon: (projectId: string, prompt: string, threadId?: string) =>
    json<{ attachment: Attachment; creditsCharged: number; creditBalance: number }>(`/projects/${projectId}/generated-icons`, {
      method: "POST",
      body: JSON.stringify({ prompt, threadId })
    }),
  generate: (projectId: string, threadId: string, prompt: string, model: string, mode: "explain" | "changeset" = "explain", planMode: boolean = false, usageOptimizer: boolean = false, optimizationMode?: "disabled" | "balanced" | "cost_saver", verificationMode: "off" | "standard" | "deep" = "off", attachmentIds: string[] = [], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify", clientRequestId?: string) =>
    json<{ userMessage: AiMessage; assistantMessage: AiMessage; creditBalance: number; changeSet?: ChangeSet }>(`/projects/${projectId}/chat`, {
      method: "POST",
      body: JSON.stringify({ threadId, clientRequestId, prompt, attachmentIds, mode, model, planMode, usageOptimizer, optimizationMode, verificationMode, intent, modelMode })
    }),
  editMessage: (projectId: string, threadId: string, messageId: string, prompt: string, model: string, mode: "explain" | "changeset" = "explain", planMode: boolean = false, usageOptimizer: boolean = false, optimizationMode?: "disabled" | "balanced" | "cost_saver", verificationMode: "off" | "standard" | "deep" = "off", attachmentIds: string[] = [], intent?: "general" | "console_fix", modelMode?: "fast" | "balanced" | "best" | "deep_verify", clientRequestId?: string) =>
    json<{ userMessage: AiMessage; assistantMessage: AiMessage; creditBalance: number; changeSet?: ChangeSet }>(`/projects/${projectId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ threadId, clientRequestId, prompt, attachmentIds, mode, model, planMode, usageOptimizer, optimizationMode, verificationMode, intent, modelMode })
    }),
  approveChangeSet: (changeSetId: string, ignoreSnapshotConflict = false) =>
    json(`/studio/changes/${changeSetId}/approve`, {
      method: "POST",
      body: JSON.stringify({ ignoreSnapshotConflict })
    }),
  undoChangeSet: (changeSetId: string) =>
    json(`/studio/changes/${changeSetId}/undo`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  dismissChangeSet: (changeSetId: string) =>
    json<{ changeSet?: ChangeSet, refundIssued?: boolean, refundAmount?: number }>(`/studio/changes/${changeSetId}/dismiss`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  rotateConnectorToken: (sessionId: string) =>
    json<{ connectorToken: string; rotatedAt: string }>(`/studio/sessions/${sessionId}/rotate-token`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  editTaskPlan: (projectId: string, planId: string, updates: any) =>
    json<{ taskPlan: TaskPlan }>(`/projects/${projectId}/task-plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(updates)
    }),
  approveTaskPlan: (projectId: string, planId: string, options: any) =>
    json<{ taskPlan: TaskPlan; changeSet: ChangeSet; assistantMessage: any }>(`/projects/${projectId}/task-plans/${planId}/approve`, {
      method: "POST",
      body: JSON.stringify(options)
    }),
  supersedeTaskPlan: (projectId: string, planId: string) =>
    json<{ taskPlan: TaskPlan }>(`/projects/${projectId}/task-plans/${planId}/supersede`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  createComment: (projectId: string, changeSetId: string, commentText: string, filePath?: string) =>
    json<{ comment: PatchComment }>(`/projects/${projectId}/changesets/${changeSetId}/comments`, {
      method: "POST",
      body: JSON.stringify({ commentText, filePath })
    }),
  resolveComment: (projectId: string, commentId: string) =>
    json<{ comment: PatchComment }>(`/projects/${projectId}/comments/${commentId}/resolve`, {
      method: "POST",
      body: JSON.stringify({})
    })
};
