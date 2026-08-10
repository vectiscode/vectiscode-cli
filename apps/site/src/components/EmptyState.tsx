import React from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state-container ${compact ? "compact" : ""}`}>
      {Icon && (
        <div className="empty-state-icon-wrapper">
          <Icon className="empty-state-icon" size={compact ? 16 : 24} />
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action && (
        <button className="login-btn primary small empty-state-action-btn" onClick={action.onClick} type="button">
          {action.label}
        </button>
      )}
    </div>
  );
}
