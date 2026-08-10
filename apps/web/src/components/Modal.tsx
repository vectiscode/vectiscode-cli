import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  preventBackdropClose?: boolean;
}

export function Modal({ isOpen, onClose, title, children, footer, preventBackdropClose }: ModalProps) {
  const titleId = useId();
  const bodyId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.setTimeout(() => {
      const focusable = contentRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!preventBackdropClose) onClose();
        return;
      }
      if (event.key !== 'Tab' || !contentRef.current) return;
      const focusable = Array.from(contentRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!preventBackdropClose) onClose(); }}>
      <div ref={contentRef} className="modal-content" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" id={bodyId}>
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
