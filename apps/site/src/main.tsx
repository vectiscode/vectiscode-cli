import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installClientDiagnostics } from "./clientDiagnostics";
import { VectisProvider } from "./hooks/useVectis";
import * as Sentry from "@sentry/react";
import "./styles.css";
import "./theme.css";
import "./a11y.css";
import "./marketing.css";

localStorage.setItem("vectis-theme", "dark");
document.documentElement.dataset.theme = "dark";
document.documentElement.style.colorScheme = "dark";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || "development",
    tracesSampleRate: 0.1
  });
}

installClientDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <VectisProvider>
        <App />
      </VectisProvider>
    </BrowserRouter>
  </StrictMode>
);