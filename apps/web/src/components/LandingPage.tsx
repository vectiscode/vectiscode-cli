import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useVectis } from "../hooks/useVectis";

const GITHUB_URL = "https://github.com/vectiscode/vectiscode-cli";
const DISCORD_URL = "https://discord.gg/f6Ud9JaVBV";
const INSTALL_COMMAND = "npm install -g vectiscode@alpha";

type WaitlistState = "idle" | "submitting" | "success" | "error";

interface BuildMeta {
  sha?: string;
  buildTime?: string;
  channel?: string;
  cliVersion?: string;
}

function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    if (!value || state === "submitting") return;
    setState("submitting");
    setMessage("");
    try {
      const response = await api.subscribe(value);
      setState("success");
      setMessage(response.message || "You are on the alpha list.");
      setEmail("");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not join. Try again.");
    }
  };

  return (
    <form className={`vc-waitlist ${compact ? "is-compact" : ""}`} onSubmit={submit}>
      <label className="vc-sr-only" htmlFor={compact ? "alpha-email-compact" : "alpha-email"}>Email address</label>
      <input
        id={compact ? "alpha-email-compact" : "alpha-email"}
        type="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (state !== "idle") setState("idle");
        }}
        placeholder="you@example.com"
        autoComplete="email"
        required
        disabled={state === "submitting"}
      />
      <button type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Joining..." : "Join the alpha"}</button>
      {message ? <p className={`vc-form-message is-${state}`} role="status">{message}</p> : null}
    </form>
  );
}

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div className="vc-install">
      <code>{INSTALL_COMMAND}</code>
      <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const { data } = useVectis();

  useEffect(() => {
    document.body.classList.add("vc-public-body");
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    return () => document.body.classList.remove("vc-public-body");
  }, []);

  return (
    <div className="vc-public">
      <header className="vc-header">
        <div className="vc-shell vc-nav">
          <Link className="vc-brand" to="/"><span className="vc-brand-mark">V</span><span>vectiscode</span></Link>
          <nav className="vc-nav-links">
            <Link to="/docs">Docs</Link>
            <Link to="/status">Status</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <Link className="vc-account-link" to={data ? "/account" : "/login"}>{data ? "Account" : "Sign in"}</Link>
        </div>
      </header>
      {children}
      <footer className="vc-footer">
        <div className="vc-shell vc-footer-row">
          <div><strong>vectiscode</strong><span>Open source. Local-first coding agent for Roblox.</span></div>
          <nav>
            <Link to="/docs">Docs</Link><Link to="/status">Status</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">Source</a><a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LandingPage() {
  return (
    <PublicShell>
      <main className="vc-home">
        <section className="vc-home-hero vc-shell">
          <div className="vc-home-hero-copy">
            <p className="vc-kicker"><span />Roblox Studio MCP Coding Agent</p>
            <h1>Build in Roblox. Stay in control.</h1>
            <p className="vc-home-lede">
              A local-first terminal coding agent that operates Roblox Studio through Studio's official MCP server. Inspect game trees, review diffs before applying, and test changes live.
            </p>
            <div className="vc-home-actions">
              <Link className="vc-button is-primary" to="/docs">Read documentation</Link>
              <a className="vc-button is-secondary" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub repository</a>
            </div>
          </div>
          <div className="vc-home-install">
            <InstallCommand />
            <p>MIT licensed. Node 20+ and Bun. Windows & macOS.</p>
          </div>
        </section>

        <section className="vc-shell vc-terminal-section">
          <div className="vc-terminal-window">
            <div className="vc-terminal-header">
              <div className="vc-terminal-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <span className="vc-terminal-title">vectiscode ~ game-project (anthropic/claude-3-7-sonnet)</span>
              <span className="vc-terminal-badge">Studio: Connected</span>
            </div>
            <div className="vc-terminal-body">
              <p className="line prompt"><span className="dim">&gt;</span> <span className="cmd">/connect</span></p>
              <p className="line sys"><span className="green">✓</span> Connected to Roblox Studio MCP server (27 tools available)</p>
              <p className="line prompt"><span className="dim">&gt;</span> Add a stamina sprint controller with client HUD and server replication</p>
              <p className="line tool"><span className="cyan">[Tool]</span> inspect_instance {"{"} path: "StarterPlayer.StarterPlayerScripts" {"}"}</p>
              <p className="line tool"><span className="cyan">[Tool]</span> multi_edit {"{"} path: "StarterPlayerScripts/SprintClient.client.luau" {"}"}</p>
              <div className="line diff-box">
                <p className="diff-header">--- StarterPlayerScripts/SprintClient.client.luau</p>
                <p className="diff-header">+++ StarterPlayerScripts/SprintClient.client.luau</p>
                <p className="diff-add">+ local UserInputService = game:GetService("UserInputService")</p>
                <p className="diff-add">+ local SPRINT_SPEED = 24</p>
                <p className="diff-add">+ local function onInputBegan(input, processed)</p>
                <p className="diff-add">+   if not processed and input.KeyCode == Enum.KeyCode.LeftShift then</p>
                <p className="diff-add">+     humanoid.WalkSpeed = SPRINT_SPEED</p>
                <p className="diff-add">+   end</p>
                <p className="diff-add">+ end</p>
              </div>
              <p className="line approval"><span className="yellow">? Permission Required:</span> Apply 2 script mutations to Studio? <span className="dim">[Y]es once / [A]llow / [N]o</span></p>
              <p className="line prompt"><span className="dim">&gt;</span> y</p>
              <p className="line success"><span className="green">✓</span> Applied cleanly to Studio. Checkpoint #04 saved for rollback.</p>
            </div>
          </div>
        </section>

        <section className="vc-home-proof vc-shell">
          <div className="vc-home-proof-heading">
            <p className="vc-kicker">Architecture</p>
            <h2>Built for real Studio workflows.</h2>
          </div>
          <ol className="vc-home-proof-list">
            <li>
              <span>01</span>
              <div>
                <strong>Native Studio connection</strong>
                <p>Talks directly to Roblox Studio over stdio MCP. Reads scripts, game trees, and properties with zero external sync plugins.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Your provider, your key</strong>
                <p>Connect Claude, OpenAI, Google Gemini, Groq, DeepSeek, or local Ollama. Credentials stay encrypted in your OS keychain.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Reviewable changes</strong>
                <p>Review unified diffs before applying. Every turn creates a rollback checkpoint so you can undo changes instantly.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="vc-shell vc-commands-section">
          <div className="vc-section-header">
            <p className="vc-kicker">Interactive TUI</p>
            <h2>Everything at your fingertips.</h2>
            <p>Type <code>/</code> in the terminal to open the interactive command palette with live autocomplete.</p>
          </div>
          <div className="vc-commands-grid">
            <div className="vc-cmd-card">
              <code>/connect</code>
              <p>Connect or inspect active Roblox Studio MCP server.</p>
            </div>
            <div className="vc-cmd-card">
              <code>/models [provider]</code>
              <p>List and switch models across Anthropic, OpenAI, Gemini, and Groq.</p>
            </div>
            <div className="vc-cmd-card">
              <code>/playtest [start|stop]</code>
              <p>Trigger and manage playtesting sessions inside Roblox Studio.</p>
            </div>
            <div className="vc-cmd-card">
              <code>/verify</code>
              <p>Capture Studio viewports and analyze live runtime console logs.</p>
            </div>
            <div className="vc-cmd-card">
              <code>/undo &lt;id&gt;</code>
              <p>Instant file-level rollback to any previous turn checkpoint.</p>
            </div>
            <div className="vc-cmd-card">
              <code>/compact</code>
              <p>Summarize older turns to reclaim context window headroom.</p>
            </div>
          </div>
        </section>

        <section className="vc-home-alpha vc-shell">
          <div>
            <p className="vc-kicker">Updates</p>
            <h2>Release notes only.</h2>
            <p>No spam. Updates on new model integrations, MCP tool capabilities, and CLI releases.</p>
          </div>
          <WaitlistForm />
        </section>
      </main>
    </PublicShell>
  );
}

export function DocsPage() {
  return (
    <PublicShell><main className="vc-page vc-shell">
      <header className="vc-page-hero"><p className="vc-kicker">Documentation</p><h1>From install to first Studio turn.</h1><p>Minimal setup. Configure your provider, connect Studio, choose permission rules, and start building in your project.</p></header>
      <div className="vc-doc-layout">
        <aside><a href="#install">Install</a><a href="#provider">Provider</a><a href="#studio">Studio MCP</a><a href="#modes">Permissions</a><a href="#commands">Commands</a><a href="#privacy">Privacy</a></aside>
        <article className="vc-doc-content">
          <section id="install"><span>01</span><h2>Install</h2><p>Node 20 or newer (or Bun), then:</p><InstallCommand /><p>Run <code>vectiscode</code> for interactive TUI mode. Run <code>vectiscode doctor</code> to verify your environment.</p></section>
          <section id="provider"><span>02</span><h2>Provider</h2><p>Run <code>vectiscode providers login anthropic</code> (or openai, google, groq, deepseek, openrouter). Keys are securely stored in your operating system keychain. Ollama requires no key.</p></section>
          <section id="studio"><span>03</span><h2>Studio MCP</h2><p>Enable MCP server in Roblox Studio (Assistant Settings &gt; Manage MCP Servers &gt; Enable Studio as MCP server), open your place, then run <code>/connect</code> in the TUI.</p></section>
          <section id="modes"><span>04</span><h2>Permissions</h2><p><code>plan</code> is read-only. <code>supervised</code> asks before writes. <code>auto</code> allows safe workspace writes. Destructive actions always require explicit approval.</p></section>
          <section id="commands"><span>05</span><h2>Commands</h2><p><code>vectiscode run "prompt"</code> executes headlessly. <code>/sessions</code> switches sessions. <code>/undo &lt;checkpoint&gt;</code> restores files. <code>/playtest</code> and <code>/verify</code> test in Studio.</p></section>
          <section id="privacy"><span>06</span><h2>Privacy</h2><p>Keys stay in your OS keychain. Prompts and context are sent directly to your configured provider. No source code or transcripts are routed through VectisCode servers.</p></section>
        </article>
      </div>
    </main></PublicShell>
  );
}

export function StatusPage() {
  const [build, setBuild] = useState<BuildMeta | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  useEffect(() => {
    void fetch("/build-meta.json").then((r) => r.ok ? r.json() : null).then((v: BuildMeta | null) => setBuild(v)).catch(() => setBuild(null));
    const apiBase = import.meta.env.VITE_API_URL || "/api";
    void fetch(`${apiBase.replace(/\/$/, "")}/health`).then((r) => setApiHealthy(r.ok)).catch(() => setApiHealthy(false));
  }, []);
  return (
    <PublicShell><main className="vc-page vc-shell">
      <header className="vc-page-hero"><p className="vc-kicker">Status</p><h1>Service & System Status</h1><p>Website, CLI, and Studio MCP report status independently.</p></header>
      <section className="vc-status-list">
        <div><span className="vc-status is-live"><i />Live</span><strong>Website</strong><p>{build?.sha ? `Build ${build.sha.slice(0, 8)} from ${build.channel ?? "main"}` : "Static docs and site active."}</p></div>
        <div><span className={`vc-status ${apiHealthy === false ? "is-queued" : "is-live"}`}><i />{apiHealthy === null ? "Checking" : apiHealthy ? "Healthy" : "Optional"}</span><strong>Account Service</strong><p>Optional label sync. Not in the execution path.</p></div>
        <div><span className="vc-status is-live"><i />Alpha</span><strong>CLI Runtime</strong><p>{build?.cliVersion ? `Version ${build.cliVersion}` : "0.1.0-alpha.1"} on Node 20+ and Bun.</p></div>
        <div><span className="vc-status is-live"><i />Native</span><strong>Roblox Studio MCP</strong><p>Local stdio transport using official Studio launcher.</p></div>
      </section>
      <div className="vc-inline-cta"><div><span>Release notes</span><strong>Join the alpha updates list.</strong></div><WaitlistForm compact /></div>
    </main></PublicShell>
  );
}

export function DownloadPage() {
  return (
    <PublicShell><main className="vc-page vc-shell">
      <header className="vc-page-hero"><p className="vc-kicker">Download</p><h1>Local-First CLI</h1><p>Runs directly in your terminal. Connects to your configured model and Roblox Studio.</p></header>
      <InstallCommand />
      <section className="vc-download-note"><span>Requirements</span><p>Node 20+ or Bun, Windows or macOS with Roblox Studio, and an AI provider API key or local Ollama.</p></section>
      <section className="vc-alpha vc-alpha-small"><p className="vc-kicker">Next step</p><h2>Verify before you build.</h2><p>Run <code>vectiscode doctor</code>, configure your provider, open Studio, then run <code>vectiscode</code> in your project directory.</p><Link className="vc-button is-secondary" to="/docs">Setup guide</Link></section>
    </main></PublicShell>
  );
}

export function LoginPage() {
  const { data, authConfig, loginFirebase, loginPrivate, loginSupabase, busy } = useVectis();
  const navigate = useNavigate();
  useEffect(() => { if (data) navigate("/account", { replace: true }); }, [data, navigate]);
  const login = async () => {
    if (authConfig?.privateOwnerLoginEnabled) await loginPrivate();
    else if (authConfig?.firebaseConfigured) await loginFirebase();
    else if (authConfig?.supabaseConfigured) await loginSupabase();
    else throw new Error("Account login is temporarily unavailable");
  };
  return (
    <PublicShell><main className="vc-login vc-shell"><section><p className="vc-kicker">Optional account</p><h1>Keep the CLI independent.</h1><p>Sign in only if you want optional label sync. The CLI runtime is fully local and does not require an account.</p><button className="vc-button is-primary" type="button" disabled={!authConfig || busy} onClick={() => void login()}>{!authConfig ? "Checking..." : busy ? "Opening..." : "Continue to sign in"}</button><Link className="vc-text-link" to="/docs">Use without an account <span>-&gt;</span></Link></section></main></PublicShell>
  );
}

export function AccountPage() {
  const { data, logout, busy } = useVectis();
  const [error, setError] = useState("");
  if (!data) return null;
  const signOut = async () => {
    setError("");
    try { await logout(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); }
  };
  return (
    <PublicShell><main className="vc-account-page vc-shell">
      <header className="vc-page-hero"><p className="vc-kicker">Account</p><h1>Small by design.</h1><p>The account is optional. Your code and prompts stay local or route directly to your provider.</p></header>
      <section className="vc-account-details">
        <div><span>Email</span><strong>{data.user.email}</strong></div>
        <div><span>CLI access</span><strong>Independent of this account</strong></div>
        <div><span>Project data</span><strong>Local only</strong></div>
        <div><span>Provider keys</span><strong>OS keychain only</strong></div>
      </section>
      <section className="vc-account-boundary"><div><p className="vc-kicker">Privacy</p><h2>Your code stays on your machine.</h2></div><p>Prompts, code, paths, diffs, and credentials are not sent to VectisCode hosted servers.</p></section>
      <div className="vc-account-actions"><Link className="vc-button is-primary" to="/docs">Documentation</Link><button className="vc-button is-secondary" type="button" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out..." : "Sign out"}</button></div>
      {error ? <p className="vc-form-message is-error">{error}</p> : null}
    </main></PublicShell>
  );
}