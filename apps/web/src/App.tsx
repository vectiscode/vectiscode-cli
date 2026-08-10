import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { reportClientError } from "./clientDiagnostics";
import { useVectis } from "./hooks/useVectis";
import { useDocumentMeta } from "./routeMeta";
import { AccountPage, DocsPage, DownloadPage, LandingPage, LoginPage, StatusPage } from "./components/LandingPage";
import { Layout } from "./components/Layout";

const LegalView = lazy(() => import("./components/LegalView").then((m) => ({ default: m.LegalView })));
const AdminView = lazy(() => import("./components/AdminView").then((m) => ({ default: m.AdminView })));

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    if (error instanceof Error) {
      reportClientError({ kind: "render_error", name: error.name, message: error.message, stack: error.stack, componentStack: info.componentStack });
    } else {
      reportClientError({ kind: "render_error", message: String(error), componentStack: info.componentStack });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="loading-screen">
          <div style={{ textAlign: "center" }}>
            <strong>Something went wrong.</strong>
            <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>Refresh to load the latest bundle.</p>
            <button className="vc-button is-secondary" onClick={() => window.location.reload()}>Refresh</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function WorkspaceRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <Layout>
      <RouteErrorBoundary key={location.pathname}>
        <Suspense fallback={<main className="loading-screen" />}>{children}</Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}

function SimpleLoading() {
  return (
    <main className="loading-screen" style={{ background: "#08090b", display: "grid", placeItems: "center", minHeight: "100dvh", color: "#999da6", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      Loading VectisCode...
    </main>
  );
}

function NotFoundView({ to }: { to: string }) {
  return (
    <main className="loading-screen" style={{ background: "#08090b", display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <p style={{ color: "#656a73", fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>404</p>
        <h1 style={{ color: "#f2f1ec", fontSize: 24, marginBottom: 12 }}>Page not found</h1>
        <p style={{ color: "#999da6", fontSize: 14, marginBottom: 20 }}>This page moved or never existed.</p>
        <a href={to} style={{ color: "#ff6846", fontSize: 13, fontWeight: 600 }}>Go to {to === "/" ? "home" : "workspace"}</a>
      </div>
    </main>
  );
}

function consumePostLoginIntent() {
  const raw = localStorage.getItem("vectis_post_login_intent");
  localStorage.removeItem("vectis_post_login_intent");
  if (!raw) return "/account";
  try {
    const parsed = JSON.parse(raw) as { path?: string };
    if (parsed.path === "/download" || parsed.path === "/account") return parsed.path;
  } catch {}
  return "/account";
}

export function App() {
  const { data, loading, authConfig, isLoggingOut } = useVectis();
  const navigate = useNavigate();
  const prevDataRef = useRef<unknown>(null);
  const isFirstLoadRef = useRef(true);

  useDocumentMeta();

  useEffect(() => {
    if (loading) return;
    const justLoggedIn = localStorage.getItem("vectis_just_logged_in") === "true";
    const currentPath = window.location.pathname;
    const isWorkspacePath = currentPath.startsWith("/account") || currentPath.startsWith("/admin");
    if (data && justLoggedIn) {
      localStorage.removeItem("vectis_just_logged_in");
      const target = consumePostLoginIntent();
      if (!isWorkspacePath || currentPath === "/") navigate(target);
    } else if (!prevDataRef.current && data) {
      if (!isFirstLoadRef.current && !isWorkspacePath) navigate("/account");
    }
    prevDataRef.current = data;
    isFirstLoadRef.current = false;
  }, [data, loading, navigate]);

  if (isLoggingOut) {
    return (
      <main className="loading-screen" style={{ background: "#08090b", display: "grid", placeItems: "center", minHeight: "100dvh", color: "#999da6" }}>
        Signing out...
      </main>
    );
  }

  const isWorkspacePath = window.location.pathname.startsWith("/account") || window.location.pathname.startsWith("/admin");
  const justLoggedIn = localStorage.getItem("vectis_just_logged_in") === "true";

  if (loading && (justLoggedIn || (isWorkspacePath && document.cookie.includes("ras_csrf=")))) {
    return <SimpleLoading />;
  }

  if (!data || !authConfig) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<LegalView />} />
        <Route path="/terms" element={<LegalView />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/account" element={<Navigate to="/login" replace />} />
        <Route path="/profile" element={<Navigate to="/login" replace />} />
        <Route path="/pricing" element={<Navigate to="/" replace />} />
        <Route path="/plans" element={<Navigate to="/" replace />} />
        <Route path="/new" element={<Navigate to="/docs" replace />} />
        <Route path="/chat/*" element={<Navigate to="/docs" replace />} />
        <Route path="/studio" element={<Navigate to="/docs#studio" replace />} />
        <Route path="/models" element={<Navigate to="/docs" replace />} />
        <Route path="/icons" element={<Navigate to="/docs" replace />} />
        <Route path="/settings" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFoundView to="/" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/login" element={<Navigate to="/account" replace />} />
      <Route path="/privacy" element={<LegalView />} />
      <Route path="/terms" element={<LegalView />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/plans" element={<Navigate to="/" replace />} />
      <Route path="/pricing" element={<Navigate to="/" replace />} />
      <Route path="/models" element={<Navigate to="/docs" replace />} />
      <Route path="/icons" element={<Navigate to="/docs" replace />} />
      <Route path="/new" element={<Navigate to="/docs" replace />} />
      <Route path="/chat/*" element={<Navigate to="/docs" replace />} />
      <Route path="/studio" element={<Navigate to="/docs#studio" replace />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/profile" element={<Navigate to="/account" replace />} />
      <Route path="/settings" element={<Navigate to="/account" replace />} />
      <Route path="/admin" element={<WorkspaceRoute><AdminView /></WorkspaceRoute>} />
      <Route path="*" element={<NotFoundView to="/" />} />
    </Routes>
  );
}