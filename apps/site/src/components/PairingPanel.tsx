import React, { useState } from "react";
import { formatPairingCode, isValidPairingCode } from "../utils/pairingCode";

interface PairingPanelProps {
  onClaim: (code: string) => Promise<void> | void;
  busy: boolean;
  buttonText?: string;
  className?: string;
  showCharCount?: boolean;
}

export function PairingPanel({
  onClaim,
  busy,
  buttonText = "Link Project",
  className = "",
  showCharCount = true
}: PairingPanelProps) {
  const [pairingCode, setPairingCode] = useState("");

  const normalizedCode = pairingCode.replace(/[^a-z0-9]/gi, "");
  const canClaim = isValidPairingCode(pairingCode);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canClaim || busy) return;
    try {
      await onClaim(pairingCode);
      setPairingCode("");
    } catch {
      // Errors should be handled by the parent's onClaim
    }
  };

  return (
    <div className={`pairing-panel-wrapper ${className}`}>
      <form onSubmit={handleSubmit} className="pair-form">
        <input
          value={pairingCode}
          onChange={(e) => setPairingCode(formatPairingCode(e.target.value))}
          placeholder="ABCD-1234-WXYZ"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={14}
          aria-label="Studio pairing code"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !canClaim}>
          {busy ? "Linking..." : buttonText}
        </button>
      </form>
      {showCharCount && (
        <small className="pairing-char-count">
          {normalizedCode.length}/12 characters entered
        </small>
      )}
    </div>
  );
}
