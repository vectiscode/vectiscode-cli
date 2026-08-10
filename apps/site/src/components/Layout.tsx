import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeft, LogOut, Shield, User } from "lucide-react";
import { Link } from "react-router-dom";

import { useVectis } from "../hooks/useVectis";
import { Modal } from "./Modal";

export function Layout({ children }: { children: ReactNode }) {
  const { data, logout, busy } = useVectis();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const identity = data?.user?.name || data?.user?.email || "Account";
  return (
    <div className="app-container">
      <header className="workspace-header">
        <div className="header-left">
          <Link to="/" className="header-brand-row"><span className="vc-brand-mark" aria-hidden="true">V</span><strong className="header-brand-name">vectiscode</strong></Link>
          <div className="workspace-title-separator" />
          <Link className="workspace-exit-btn" to="/account"><ChevronLeft size={13} /><span>Account</span></Link>
        </div>
        <div className="profile-dropdown-wrapper" ref={menuRef}>
          <button className="profile-avatar-circle-btn" type="button" title="User menu" onClick={() => setMenuOpen((open) => !open)}><User size={17} /></button>
          {menuOpen ? <div className="profile-dropdown-menu">
            <div className="profile-dropdown-user-info"><div className="profile-username">{identity}</div></div>
            <div className="profile-dropdown-divider" />
            <Link to="/account" className="profile-dropdown-item" onClick={() => setMenuOpen(false)}><User size={15} /><span>Account</span></Link>
            {data?.isAdmin ? <Link to="/admin" className="profile-dropdown-item" onClick={() => setMenuOpen(false)}><Shield size={15} /><span>Admin</span></Link> : null}
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item logout-action-btn" type="button" onClick={() => { setMenuOpen(false); setLogoutConfirm(true); }}><LogOut size={15} /><span>Sign out</span></button>
          </div> : null}
        </div>
      </header>
      <main className="app-shell admin-app-shell"><section className="main-workspace">{children}</section></main>
      <Modal
        isOpen={logoutConfirm}
        onClose={() => setLogoutConfirm(false)}
        title="Sign out"
        footer={<><button className="login-btn secondary small" onClick={() => setLogoutConfirm(false)}>Stay signed in</button><button className="login-btn primary small" disabled={busy} onClick={async () => { setLogoutConfirm(false); await logout(); }}>Sign out</button></>}
      ><p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Sign out of this optional VectisCode account?</p></Modal>
    </div>
  );
}
