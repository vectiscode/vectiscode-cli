const base = import.meta.env.VITE_API_URL || "/api";

type ClientErrorKind =
  | "runtime_error"
  | "unhandled_rejection"
  | "console_error"
  | "api_error"
  | "api_unreachable"
  | "render_error";

type ClientErrorPayload = {
  kind: ClientErrorKind;
  message: string;
  name?: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  route?: string;
  componentStack?: string;
  apiPath?: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
};

const MAX_REPORTS_PER_PAGE = 30;
let sentReports = 0;
let installed = false;

function cookieValue(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

function serializeError(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (typeof value === "string") {
    return { message: value };
  }

  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

function cleanPayload(input: ClientErrorPayload): ClientErrorPayload {
  return {
    ...input,
    message: input.message.slice(0, 2000),
    name: input.name?.slice(0, 120),
    stack: input.stack?.slice(0, 8000),
    source: input.source?.slice(0, 1000),
    route: input.route ?? `${window.location.pathname}${window.location.search}`,
    componentStack: input.componentStack?.slice(0, 8000),
    apiPath: input.apiPath?.slice(0, 500)
  };
}

export function reportClientError(input: ClientErrorPayload) {
  if (typeof window === "undefined") return;
  if (sentReports >= MAX_REPORTS_PER_PAGE) return;
  sentReports += 1;

  const payload = cleanPayload(input);
  const body = JSON.stringify(payload);
  const url = `${base}/client-errors`;
  const csrf = cookieValue("ras_csrf");

  try {
    if (navigator.sendBeacon && !csrf) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {})
    },
    credentials: "include",
    keepalive: true,
    body
  }).catch(() => {});
}

export function installClientDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const parsed = serializeError(event.error ?? event.message);
    reportClientError({
      kind: "runtime_error",
      name: parsed.name,
      message: parsed.message || "Runtime error",
      stack: parsed.stack,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const parsed = serializeError(event.reason);
    reportClientError({
      kind: "unhandled_rejection",
      name: parsed.name,
      message: parsed.message || "Unhandled promise rejection",
      stack: parsed.stack
    });
  });

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalError(...args);
    const firstError = args.find((arg) => arg instanceof Error);
    const parsed = serializeError(firstError ?? args.map((arg) => serializeError(arg).message).join(" "));
    reportClientError({
      kind: "console_error",
      name: parsed.name,
      message: parsed.message || "Console error",
      stack: parsed.stack,
      metadata: {
        argumentCount: args.length
      }
    });
  };
}
