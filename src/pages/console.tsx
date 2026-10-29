import { useEffect, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, Check, CircleHelp, Copy, CreditCard, Download, KeyRound, LogOut, Plus, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";

type KeyRecord = { id: string; name: string; kind: "publishable" | "secret"; prefix: string; origins: string[]; createdAt: string; lastUsedAt: string | null };
type EventRecord = { id: string; event_type: string; surface: string; locale: string; received_at: string; event_hash: string };
type Dashboard = {
  account: { id: string; email: string; organization: string };
  usage: { plan: string; planName: string; events: number; eventLimit: number; marks: number; markLimit: number };
  subscription: { status: string; currentPeriodEnd: string | null; hasBillingCustomer: boolean };
  keys: KeyRecord[];
  events: EventRecord[];
};
type PublicConfig = { billingEnabled: boolean; c2paSigningConfigured: boolean };

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function Logo() {
  return <a className="a50-brand" href="/"><span className="a50-brand-mark">50</span><span>article<span>50</span>kit</span></a>;
}

export default function ConsolePage() {
  const requestedPlan = new URLSearchParams(window.location.search).get("plan") ?? "";
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [config, setConfig] = useState<PublicConfig>({ billingEnabled: false, c2paSigningConfigured: false });
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("Production web app");
  const [keyKind, setKeyKind] = useState<"publishable" | "secret">("publishable");
  const [origins, setOrigins] = useState(typeof window === "undefined" ? "" : window.location.origin);

  const refresh = async () => {
    const data = await apiJson<{ account: Dashboard["account"] | null; usage?: Dashboard["usage"]; subscription?: Dashboard["subscription"]; keys?: KeyRecord[] }>("/api/auth/me");
    if (data.account && data.usage && data.subscription && data.keys) {
      const eventData = await apiJson<{ events: EventRecord[] }>("/api/events");
      setDashboard({ account: data.account, usage: data.usage, subscription: data.subscription, keys: data.keys, events: eventData.events });
      return true;
    }
    setDashboard(null);
    return false;
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      apiJson<PublicConfig>("/api/public-config"),
      apiJson<{ account: Dashboard["account"] | null; usage?: Dashboard["usage"]; subscription?: Dashboard["subscription"]; keys?: KeyRecord[] }>("/api/auth/me"),
    ]).then(async ([publicConfig, data]) => {
      if (!active) return;
      setConfig(publicConfig);
      if (data.account && data.usage && data.subscription && data.keys) {
        const eventData = await apiJson<{ events: EventRecord[] }>("/api/events");
        if (active) setDashboard({ account: data.account, usage: data.usage, subscription: data.subscription, keys: data.keys, events: eventData.events });
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load the console.");
    }).finally(() => { if (active) setBusy(false); });
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") setMessage("Stripe returned successfully. Subscription status will update after the signed webhook is received.");
    if (checkout === "cancelled") setMessage("Checkout was cancelled; your account remains on the Sandbox plan.");
    return () => { active = false; };
  }, []);

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      if (mode === "signup") {
        const data = await apiJson<{ apiKey: string; note: string }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, organization, acceptedTerms }),
        });
        setNewKey(data.apiKey);
        setMessage(data.note);
      } else {
        await apiJson("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      }
      setPassword("");
      await refresh();
      if (requestedPlan && config.billingEnabled) await startCheckout(requestedPlan);
      else if (requestedPlan && !config.billingEnabled) setMessage("Your free workspace is ready. Paid checkout is not connected yet.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setSaving(false);
    }
  };

  const startCheckout = async (plan: string) => {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const result = await apiJson<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start checkout.");
    } finally {
      setSaving(false);
    }
  };

  const manageBilling = async () => {
    setError("");
    setSaving(true);
    try {
      const result = await apiJson<{ url: string }>("/api/billing/portal", { method: "POST", body: "{}" });
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open billing management.");
    } finally {
      setSaving(false);
    }
  };

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const allowedOrigins = keyKind === "publishable" ? origins.split(/[\s,]+/).filter(Boolean) : [];
      const result = await apiJson<{ key: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName, kind: keyKind, origins: allowedOrigins }),
      });
      setNewKey(result.key);
      setMessage("Copy this key now. It will not be shown again.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create API key.");
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async (key: KeyRecord) => {
    if (!window.confirm(`Revoke ${key.name}? Any integration using it will stop working.`)) return;
    try {
      await apiJson(`/api/keys/${key.id}`, { method: "DELETE" });
      setMessage("API key revoked.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke API key.");
    }
  };

  const downloadEvidence = async () => {
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/evidence-pack", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? `Could not create evidence pack (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `article50kit-evidence-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Evidence pack downloaded.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create evidence pack.");
    } finally {
      setSaving(false);
    }
  };

  const copyKey = async () => {
    try { await navigator.clipboard.writeText(newKey); setMessage("Copied to clipboard."); } catch { setMessage("Clipboard access was blocked. Select and copy the key manually."); }
  };

  const deleteAccount = async () => {
    const confirmedPassword = window.prompt("Enter your password to permanently delete this workspace and its records.");
    if (!confirmedPassword) return;
    if (!window.confirm("This permanently deletes your account, API keys, event records, and stored subscription. Any active Stripe subscription will be cancelled immediately; no refund is issued by this action. Continue?")) return;
    try {
      await apiJson("/api/account", { method: "DELETE", body: JSON.stringify({ password: confirmedPassword }) });
      setDashboard(null);
      setNewKey("");
      setMessage("Workspace deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete workspace.");
    }
  };

  const logout = async () => {
    await apiJson("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    setDashboard(null);
    setNewKey("");
    setMode("login");
    setMessage("Signed out.");
  };

  if (busy) return <div className="a50-console-loading"><span className="a50-spinner" /> Loading workspace…</div>;

  return (
    <div className="a50-console-shell">
      <header className="a50-console-header"><Logo /><div><a href="/docs">Developer guide</a><a href="/" className="a50-console-home">Website <ArrowRight size={13} /></a></div></header>
      {!dashboard ? (
        <main className="a50-auth-main">
          <div className="a50-auth-side"><span className="a50-kicker">ARTICLE50KIT · EARLY ACCESS</span><h1>Build a better<br /><em>paper trail.</em></h1><p>Get a workspace, issue scoped API keys, and start recording disclosure events. Use the Sandbox first; connect billing and trusted C2PA signing before taking this into production.</p><div className="a50-auth-points"><span><Check size={13} /> 500 event receipts / month</span><span><Check size={13} /> One publishable key at signup</span><span><Check size={13} /> PDF evidence export</span></div></div>
          <div className="a50-auth-card"><div className="a50-auth-tabs"><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create workspace</button><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button></div>
            {requestedPlan && <div className="a50-plan-note"><ShieldCheck size={15} /><span>Selected plan: <strong>{requestedPlan}</strong>. {config.billingEnabled ? "Sign in or create an account to continue to secure checkout." : "Checkout is not connected yet; you can still create a free workspace."}</span></div>}
            <form onSubmit={submitAuth} className="a50-auth-form">
              {mode === "signup" && <label>Workspace name<input required maxLength={100} autoComplete="organization" value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Acme Support" /></label>}
              <label>Work email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
              <label>Password<input required type="password" minLength={12} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "12 characters minimum" : "Your password"} /></label>
              {mode === "signup" && <label className="a50-terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I accept the <a href="/terms" target="_blank">Beta Terms</a> and acknowledge the <a href="/privacy" target="_blank">Privacy Notice</a>.</span></label>}
              {error && <div className="a50-form-alert a50-alert-error"><TriangleAlert size={14} />{error}</div>}
              {message && <div className="a50-form-alert a50-alert-success"><Check size={14} />{message}</div>}
              <button className="a50-button a50-button-dark a50-auth-submit" disabled={saving}>{saving ? "One moment…" : mode === "signup" ? "Create free workspace" : "Sign in"}<ArrowRight size={14} /></button>
            </form>
            <p className="a50-auth-terms">Passwords are hashed with Argon2id. Early access does not yet include email verification, password reset, MFA, or a production SLA.</p>
          </div>
        </main>
      ) : (
        <main className="a50-dashboard">
          <div className="a50-dashboard-head"><div><span className="a50-kicker">WORKSPACE CONSOLE</span><h1>{dashboard.account.organization}</h1><p>{dashboard.account.email} <span>·</span> {dashboard.usage.planName} plan</p></div><button className="a50-button a50-button-outline a50-logout" onClick={logout}><LogOut size={13} /> Sign out</button></div>
          {message && <div className="a50-form-alert a50-alert-success a50-dashboard-message"><Check size={14} />{message}</div>}
          {error && <div className="a50-form-alert a50-alert-error a50-dashboard-message"><TriangleAlert size={14} />{error}</div>}
          {newKey && <div className="a50-one-time-key"><div><KeyRound size={16} /><div><strong>Copy this API key now</strong><span>Article50Kit never stores the plaintext key. Refreshing will hide it.</span></div></div><code>{newKey}</code><button className="a50-button a50-button-dark a50-button-small" onClick={copyKey}><Copy size={13} /> Copy key</button><button className="a50-key-dismiss" onClick={() => setNewKey("")} aria-label="Dismiss key">×</button></div>}
          <div className="a50-dashboard-grid">
            <section className="a50-dash-card a50-usage-card"><div className="a50-dash-card-head"><div><span className="a50-kicker">THIS MONTH</span><h2>Usage</h2></div><Activity size={17} /></div><div className="a50-usage-stat"><div><span>Disclosure & evidence events</span><strong>{dashboard.usage.events.toLocaleString()} <small>/ {dashboard.usage.eventLimit.toLocaleString()}</small></strong></div><div className="a50-meter"><span style={{ width: `${Math.min(100, dashboard.usage.events / dashboard.usage.eventLimit * 100)}%` }} /></div></div><div className="a50-usage-stat"><div><span>C2PA media marks</span><strong>{dashboard.usage.marks.toLocaleString()} <small>/ {dashboard.usage.markLimit.toLocaleString()}</small></strong></div><div className="a50-meter"><span className="a50-meter-blue" style={{ width: `${dashboard.usage.markLimit ? Math.min(100, dashboard.usage.marks / dashboard.usage.markLimit * 100) : 0}%` }} /></div></div><button className="a50-text-button" onClick={() => void refresh()}><RefreshCw size={12} /> Refresh usage</button></section>
            <section className="a50-dash-card a50-status-card"><div className="a50-dash-card-head"><div><span className="a50-kicker">SERVICE STATUS</span><h2>Production gates</h2></div><CircleHelp size={17} /></div><div className="a50-status-row"><span className={config.billingEnabled ? "a50-status-dot a50-status-green" : "a50-status-dot a50-status-amber"} />{config.billingEnabled ? "Stripe checkout configured" : "Stripe checkout not connected"}</div><div className="a50-status-row"><span className={config.c2paSigningConfigured ? "a50-status-dot a50-status-green" : "a50-status-dot a50-status-amber"} />{config.c2paSigningConfigured ? "C2PA signer credential present" : "C2PA signing credential not set"}</div><p>Even with a credential, verify its trust and all outputs independently. Credentials and checkout are operator-managed.</p></section>
          </div>
          <section className="a50-dash-card a50-keys-section"><div className="a50-dash-card-head"><div><span className="a50-kicker">AUTHENTICATION</span><h2>API keys</h2></div><KeyRound size={17} /></div><div className="a50-key-table">{dashboard.keys.length ? dashboard.keys.map((key) => <div className="a50-key-row" key={key.id}><div className="a50-key-type"><span className={key.kind === "publishable" ? "a50-key-publishable" : "a50-key-secret"}>{key.kind === "publishable" ? "PK" : "SK"}</span><div><strong>{key.name}</strong><span>{key.prefix}••••••••{key.origins.length ? ` · ${key.origins.join(", ")}` : " · any origin (server-side use)"}</span></div></div><button className="a50-icon-button" onClick={() => void revokeKey(key)} title="Revoke key" aria-label={`Revoke ${key.name}`}><Trash2 size={14} /></button></div>) : <p className="a50-muted-empty">No API keys yet. Create one below.</p>}</div>
            <form className="a50-key-form" onSubmit={createKey}><div className="a50-key-form-row"><label>Key name<input required maxLength={80} value={keyName} onChange={(event) => setKeyName(event.target.value)} /></label><label>Key type<select value={keyKind} onChange={(event) => setKeyKind(event.target.value as "publishable" | "secret")}><option value="publishable">Publishable · event writes</option><option value="secret">Secret · server operations</option></select></label></div>{keyKind === "publishable" && <label>Allowed browser origins<input value={origins} onChange={(event) => setOrigins(event.target.value)} placeholder="https://app.example.com" /><small>Comma-separate allowed HTTPS origins. At least one is required for publishable keys.</small></label>}<button className="a50-button a50-button-outline a50-create-key" disabled={saving}><Plus size={14} /> Create API key</button></form>
          </section>
          <section className="a50-dash-card a50-events-section"><div className="a50-dash-card-head"><div><span className="a50-kicker">AUDIT RECORDS</span><h2>Recent events</h2></div><button className="a50-button a50-button-outline a50-export-button" onClick={downloadEvidence} disabled={saving}><Download size={13} /> Export PDF</button></div>{dashboard.events.length ? <div className="a50-event-list">{dashboard.events.map((event) => <div className="a50-event-row" key={event.id}><span className="a50-event-mark"><Check size={12} /></span><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.surface} · {event.locale} · {event.received_at}</span></div><code>{event.event_hash.slice(0, 12)}…</code></div>)}</div> : <div className="a50-empty-state"><div><Activity size={18} /></div><strong>No receipts yet</strong><p>Connect your first integration, send a test disclosure, and the event will appear here.</p><a href="/docs#events">View event API <ArrowRight size={12} /></a></div>}<p className="a50-event-disclaimer">These are customer-submitted records; the log does not independently prove that a notice was displayed.</p></section>
          <section className="a50-dash-card a50-upgrade-section"><div><span className="a50-kicker">PLANS</span><h2>Need more room?</h2><p>Increase event and media-mark limits. Checkout stays off until the operator connects Stripe.</p></div><div className="a50-upgrade-buttons">{dashboard.subscription.hasBillingCustomer && <button className="a50-button a50-button-outline" disabled={saving} onClick={() => void manageBilling()}><CreditCard size={13} /> Manage billing</button>}{[{ id: "starter", label: "Starter · $29" }, { id: "growth", label: "Growth · $79" }, { id: "scale", label: "Scale · $199" }].map((plan) => <button key={plan.id} className="a50-button a50-button-outline" disabled={!config.billingEnabled || saving || dashboard.subscription.hasBillingCustomer} onClick={() => void startCheckout(plan.id)}>{plan.label}<ArrowRight size={12} /></button>)}</div></section>
          <div className="a50-console-bottom"><span>Early-access account controls</span><button className="a50-delete-account" onClick={() => void deleteAccount()}>Delete workspace and all its records</button></div>
        </main>
      )}
      <footer className="a50-console-footer"><span>Article50Kit · Early access · Technical tooling, not legal advice.</span><div><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/docs">Docs</a></div></footer>
    </div>
  );
}
