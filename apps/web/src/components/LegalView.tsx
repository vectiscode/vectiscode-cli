import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PublicShell } from "./LandingPage";

export function LegalView() {
  const [legalText, setLegalText] = useState("");
  const location = useLocation();

  useEffect(() => {
    const file = location.pathname === "/terms" ? "/legal/terms-of-service.md" : "/legal/privacy-policy.md";
    
    fetch(file)
      .then(res => res.ok ? res.text() : "")
      .then(setLegalText)
      .catch(() => setLegalText(""));
  }, [location.pathname]);

  return (
    <PublicShell>
      <main className="vc-page vc-shell vc-legal">
          {legalText ? (
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalText}</ReactMarkdown>
            </div>
          ) : (
            <p>Loading legal information...</p>
          )}
      </main>
    </PublicShell>
  );
}
