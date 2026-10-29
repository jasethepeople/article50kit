import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { verifyAuditEvents, type AuditEvent } from "./audit";
import { signAiMedia, MAX_SIGNING_BYTES } from "./c2pa";
import { canonicalJson, sha256 } from "./core";
import { createEvidencePdf } from "./evidence";

type PlanId = "free" | "starter" | "growth" | "scale";
type ApiKeyKind = "publishable" | "secret";
type Variables = {
  account: { id: string; email: string; organization: string };
  apiKey: { id: string; account_id: string; kind: ApiKeyKind; origins: string[] };
};
type App = Hono<{ Variables: Variables }>;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

async function readLimitedBody(c: Context, maxBytes: number) {
  const stream = c.req.raw.body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const plans: Record<PlanId, { name: string; monthlyCents: number; events: number; marks: number; label: string }> = {
  free: { name: "Sandbox", monthlyCents: 0, events: 500, marks: 0, label: "500 events / month" },
  starter: { name: "Starter", monthlyCents: 2900, events: 10_000, marks: 2_000, label: "10k events + 2k media marks / month" },
  growth: { name: "Growth", monthlyCents: 7900, events: 100_000, marks: 20_000, label: "100k events + 20k media marks / month" },
  scale: { name: "Scale", monthlyCents: 19_900, events: 1_000_000, marks: 200_000, label: "1m events + 200k media marks / month" },
};
function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && Object.hasOwn(plans, value);
}


const eventSchema = z.object({
  eventType: z.enum(["ai_interaction_disclosure", "synthetic_content_label", "deepfake_label", "human_review"]),
  surface: z.string().trim().max(80).default("unspecified"),
  locale: z.string().trim().max(24).default("en"),
  notice: z.string().trim().max(500).default(""),
  policyVersion: z.string().trim().max(80).default("unspecified"),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  metadata: z.object({
    sdkVersion: z.string().max(40).optional(),
    appVersion: z.string().max(40).optional(),
    integrationId: z.string().max(80).optional(),
  }).optional(),
});

const dbFile = process.env.DATABASE_PATH || "./data/article50kit.sqlite";
if (dbFile !== ":memory:") mkdirSync(dirname(resolve(dbFile)), { recursive: true });
const db = new Database(dbFile);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    organization TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('publishable', 'secret')),
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    origins_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    surface TEXT NOT NULL,
    locale TEXT NOT NULL,
    notice TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    content_sha256 TEXT,
    client_reported_at TEXT,
    received_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_events_account_time ON audit_events(account_id, received_at);
  CREATE TABLE IF NOT EXISTS subscriptions (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL
  );
`);

const app: App = new Hono<{ Variables: Variables }>();
const limits = new Map<string, { start: number; count: number }>();

function utcNow() {
  return new Date().toISOString();
}

function originFor(c: Context) {
  const trusted = process.env.PUBLIC_APP_URL?.trim();
  if (trusted) {
    try { return new URL(trusted).origin; } catch { return ""; }
  }
  const origin = c.req.header("origin");
  if (origin) {
    try { return new URL(origin).origin; } catch { return ""; }
  }
  try { return new URL(c.req.url).origin; } catch { return ""; }
}

function cookieValue(c: Context, name: string) {
  const cookie = c.req.header("cookie") ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function setSessionCookie(c: Context, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  c.header("Set-Cookie", `a50_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function newToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function createSession(c: Context, accountId: string) {
  const token = newToken("");
  const now = utcNow();
  db.query("INSERT INTO sessions(token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    sha256(token), accountId, new Date(Date.now() + 7 * 86400000).toISOString(), now,
  );
  setSessionCookie(c, token);
}

function sessionAccount(c: Context) {
  const token = cookieValue(c, "a50_session");
  if (!token) return null;
  const row = db.query(`
    SELECT a.id, a.email, a.organization, s.token_hash
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), utcNow()) as (Variables["account"] & { token_hash: string }) | null;
  if (!row) return null;
  c.set("account", { id: row.id, email: row.email, organization: row.organization });
  return row;
}

const requireSession: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  if (!sessionAccount(c)) return c.json({ error: "Sign in to continue", code: "authentication_required" }, 401);
  await next();
};

function keyInput(c: Context) {
  const direct = c.req.header("x-api-key");
  const authorization = c.req.header("authorization");
  if (direct) return direct.trim();
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return "";
}

function apiKeyByValue(value: string, touch = true) {
  if (!/^a50_(?:pk|sk)_[A-Za-z0-9_-]{40,60}$/.test(value)) return null;
  const row = db.query(`
    SELECT id, account_id, kind, origins_json
    FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL
  `).get(sha256(value)) as { id: string; account_id: string; kind: ApiKeyKind; origins_json: string } | null;
  if (!row) return null;
  if (touch) db.query("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(utcNow(), row.id);
  return { id: row.id, account_id: row.account_id, kind: row.kind, origins: JSON.parse(row.origins_json) as string[] };
}

function originAllowed(origin: string, key: Variables["apiKey"]) {
  if (!origin) return true;
  return key.kind === "publishable" && key.origins.includes(origin);
}

function rateLimit(key: string, max: number, periodMs = 60_000) {
  const now = Date.now();
  const current = limits.get(key);
  if (!current || now - current.start > periodMs) {
    limits.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

function clientIp(c: Context) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown";
}

function createKey(accountId: string, name: string, kind: ApiKeyKind, origins: string[]) {
  const prefix = kind === "publishable" ? "a50_pk_" : "a50_sk_";
  const value = newToken(prefix);
  const id = crypto.randomUUID();
  db.query(`
    INSERT INTO api_keys(id, account_id, name, kind, prefix, key_hash, origins_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, accountId, name, kind, value.slice(0, 15), sha256(value), JSON.stringify(origins), utcNow());
  return { id, name, kind, prefix: value.slice(0, 15), key: value, origins, createdAt: utcNow() };
}

function currentSubscription(accountId: string) {
  return db.query("SELECT plan, status, stripe_customer_id, stripe_subscription_id, current_period_end FROM subscriptions WHERE account_id = ?").get(accountId) as { plan: PlanId; status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null } | null;
}

function currentPlan(accountId: string): PlanId {
  const subscription = currentSubscription(accountId);
  if (!subscription || !["active", "trialing"].includes(subscription.status)) return "free";
  return isPlanId(subscription.plan) ? subscription.plan : "free";
}

function usageFor(accountId: string) {
  const plan = currentPlan(accountId);
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const since = start.toISOString();
  const total = db.query("SELECT COUNT(*) AS n FROM audit_events WHERE account_id = ? AND received_at >= ?").get(accountId, since) as { n: number };
  const marks = db.query("SELECT COUNT(*) AS n FROM audit_events WHERE account_id = ? AND event_type = 'c2pa_media_mark' AND received_at >= ?").get(accountId, since) as { n: number };
  return { plan, planName: plans[plan].name, events: total.n, eventLimit: plans[plan].events, marks: marks.n, markLimit: plans[plan].marks };
}

function checkQuota(accountId: string, type: "event" | "mark") {
  const usage = usageFor(accountId);
  const limit = type === "mark" ? usage.markLimit : usage.eventLimit;
  const used = type === "mark" ? usage.marks : usage.events;
  return used < limit ? null : { used, limit, plan: usage.plan };
}

function insertEvent(input: {
  accountId: string;
  keyId: string | null;
  eventType: string;
  surface: string;
  locale: string;
  notice: string;
  policyVersion: string;
  contentSha256?: string | null;
  clientReportedAt?: string | null;
}) {
  const id = crypto.randomUUID();
  const receivedAt = utcNow();
  const write = db.transaction(() => {
    const previous = db.query("SELECT event_hash FROM audit_events WHERE account_id = ? ORDER BY rowid DESC LIMIT 1").get(input.accountId) as { event_hash: string } | null;
    const payload = {
      id,
      account_id: input.accountId,
      event_type: input.eventType,
      surface: input.surface,
      locale: input.locale,
      notice: input.notice,
      policy_version: input.policyVersion,
      content_sha256: input.contentSha256 ?? null,
      client_reported_at: input.clientReportedAt ?? null,
      received_at: receivedAt,
      prev_hash: previous?.event_hash ?? "GENESIS",
    };
    const digest = sha256(canonicalJson(payload));
    db.query(`
      INSERT INTO audit_events(id, account_id, key_id, event_type, surface, locale, notice, policy_version,
        content_sha256, client_reported_at, received_at, prev_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.id, input.accountId, input.keyId, payload.event_type, payload.surface, payload.locale,
      payload.notice, payload.policy_version, payload.content_sha256, payload.client_reported_at,
      payload.received_at, payload.prev_hash, digest,
    );
    return { id, receivedAt, eventHash: digest };
  });
  return write();
}

function getAccountEvents(accountId: string) {
  return db.query(`
    SELECT id, account_id, event_type, surface, locale, notice, policy_version, content_sha256,
      client_reported_at, received_at, prev_hash, event_hash
    FROM audit_events WHERE account_id = ? ORDER BY rowid ASC
  `).all(accountId) as AuditEvent[];
}

function apiKeyFor(c: Context) {
  return apiKeyByValue(keyInput(c));
}

const requireApiKey: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const key = apiKeyFor(c);
  if (!key) return c.json({ error: "A valid API key is required", code: "invalid_api_key" }, 401);
  const origin = c.req.header("origin") ?? "";
  if (!originAllowed(origin, key)) return c.json({ error: "Browser requests require a publishable key restricted to this origin", code: "origin_not_allowed" }, 403);
  c.set("apiKey", key);
  await next();
};

app.get("/api/health", (c) => c.json({ status: "ok", service: "article50kit", version: "1.0.0" }));
app.get("/api/public-config", (c) => c.json({
  billingEnabled: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
  c2paSigningConfigured: Boolean(process.env.C2PA_CERT_PEM && process.env.C2PA_PRIVATE_KEY_PEM),
  plans: Object.entries(plans).filter(([id]) => id !== "free").map(([id, plan]) => ({ id, name: plan.name, priceUsd: plan.monthlyCents / 100, events: plan.events, marks: plan.marks })),
}));

app.post("/api/auth/register", async (c) => {
  if (!rateLimit(`register:${clientIp(c)}`, 8)) return c.json({ error: "Too many attempts. Try again shortly.", code: "rate_limited" }, 429);
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string; organization?: string; acceptedTerms?: boolean } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const organization = body?.organization?.trim().slice(0, 100) ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !organization || body?.acceptedTerms !== true) {
    return c.json({ error: "Enter a valid email, organization, a 12-character password, and accept the terms.", code: "invalid_registration" }, 400);
  }
  const id = crypto.randomUUID();
  const now = utcNow();
  try {
    db.query("INSERT INTO accounts(id, email, password_hash, organization, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, email, await Bun.password.hash(password, { algorithm: "argon2id" }), organization, now);
  } catch {
    return c.json({ error: "An account with that email already exists.", code: "email_in_use" }, 409);
  }
  createSession(c, id);
  const publishableKey = createKey(id, "Website disclosures", "publishable", [originFor(c)].filter(Boolean));
  return c.json({
    account: { id, email, organization },
    apiKey: publishableKey.key,
    apiKeyPrefix: publishableKey.prefix,
    plan: "free",
    note: "Copy this publishable key now. It is shown only once. Email verification is not enabled yet.",
  }, 201);
});

app.post("/api/auth/login", async (c) => {
  if (!rateLimit(`login:${clientIp(c)}`, 12)) return c.json({ error: "Too many attempts. Try again shortly.", code: "rate_limited" }, 429);
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const account = db.query("SELECT id, email, organization, password_hash FROM accounts WHERE email = ?").get(email) as (Variables["account"] & { password_hash: string }) | null;
  if (!account || !(await Bun.password.verify(password, account.password_hash))) {
    return c.json({ error: "Email or password is incorrect.", code: "invalid_credentials" }, 401);
  }
  createSession(c, account.id);
  return c.json({ account: { id: account.id, email: account.email, organization: account.organization } });
});

app.post("/api/auth/logout", (c) => {
  const token = cookieValue(c, "a50_session");
  if (token) db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  c.header("Set-Cookie", "a50_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => {
  const account = sessionAccount(c);
  if (!account) return c.json({ account: null });
  const usage = usageFor(account.id);
  const subscription = currentSubscription(account.id);
  const keys = db.query(`
    SELECT id, name, kind, prefix, origins_json, created_at, last_used_at
    FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC
  `).all(account.id) as Array<{ id: string; name: string; kind: ApiKeyKind; prefix: string; origins_json: string; created_at: string; last_used_at: string | null }>;
  return c.json({
    account: { id: account.id, email: account.email, organization: account.organization },
    usage,
    subscription: { status: subscription?.status ?? "free", currentPeriodEnd: subscription?.current_period_end ?? null, hasBillingCustomer: Boolean(subscription?.stripe_customer_id) },
    keys: keys.map((key) => ({ id: key.id, name: key.name, kind: key.kind, prefix: key.prefix, origins: JSON.parse(key.origins_json), createdAt: key.created_at, lastUsedAt: key.last_used_at })),
  });
});

app.get("/api/events", requireSession, (c) => {
  const account = c.get("account");
  const allEvents = getAccountEvents(account.id);
  return c.json({
    events: allEvents.slice(-100).reverse(),
    usage: usageFor(account.id),
    chainValid: verifyAuditEvents(allEvents),
    note: "These are customer-submitted records; receipt does not independently verify that a notice was shown.",
  });
});

app.post("/api/evidence-pack", requireSession, async (c) => {
  const account = c.get("account");
  const body = await c.req.json().catch(() => ({})) as { from?: string; to?: string };
  const allEvents = getAccountEvents(account.id);
  const from = body.from ? new Date(body.from) : null;
  const to = body.to ? new Date(body.to) : null;
  if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) return c.json({ error: "Date filters must be ISO timestamps", code: "invalid_date" }, 400);
  const events = allEvents.filter((event) => (!from || new Date(event.received_at) >= from) && (!to || new Date(event.received_at) <= to));
  if (events.length > 2_000) return c.json({ error: "An evidence pack is limited to 2,000 events. Narrow the date range.", code: "evidence_limit" }, 413);
  const pdf = await createEvidencePdf({ organization: account.organization, email: account.email, from: body.from, to: body.to, events, chainValid: verifyAuditEvents(allEvents) });
  return new Response(toArrayBuffer(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="article50kit-evidence-${new Date().toISOString().slice(0, 10)}.pdf"`, "Cache-Control": "no-store" } });
});

app.delete("/api/account", requireSession, async (c) => {
  const account = c.get("account");
  const body = await c.req.json().catch(() => null) as { password?: string } | null;
  const row = db.query("SELECT password_hash FROM accounts WHERE id = ?").get(account.id) as { password_hash: string } | null;
  if (!row || !(await Bun.password.verify(body?.password ?? "", row.password_hash))) return c.json({ error: "Password confirmation failed", code: "invalid_credentials" }, 401);
  const subscription = currentSubscription(account.id);
  if (subscription?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(subscription.status)) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return c.json({ error: "Cancel the Stripe subscription before deleting this workspace", code: "billing_not_configured" }, 503);
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${stripeKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (!response.ok) return c.json({ error: result.error?.message ?? "Stripe could not cancel the subscription; the workspace was not deleted", code: "subscription_cancel_failed" }, 502);
  }
  db.query("DELETE FROM accounts WHERE id = ?").run(account.id);
  c.header("Set-Cookie", "a50_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return c.json({ ok: true });
});

app.get("/api/keys", requireSession, (c) => {
  const account = c.get("account");
  const keys = db.query("SELECT id, name, kind, prefix, origins_json, created_at, last_used_at FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC").all(account.id) as Array<{ id: string; name: string; kind: ApiKeyKind; prefix: string; origins_json: string; created_at: string; last_used_at: string | null }>;
  return c.json({ keys: keys.map((key) => ({ id: key.id, name: key.name, kind: key.kind, prefix: key.prefix, origins: JSON.parse(key.origins_json), createdAt: key.created_at, lastUsedAt: key.last_used_at })) });
});

app.post("/api/keys", requireSession, async (c) => {
  const account = c.get("account");
  const body = await c.req.json().catch(() => null) as { name?: string; kind?: ApiKeyKind; origins?: string[] } | null;
  const name = body?.name?.trim().slice(0, 80) ?? "";
  const kind = body?.kind;
  let origins: string[] = [];
  if (body?.origins !== undefined) {
    if (!Array.isArray(body.origins) || body.origins.some((origin) => typeof origin !== "string")) return c.json({ error: "Origins must be a list of HTTPS origins", code: "invalid_origins" }, 400);
    const normalized = body.origins.map((value) => {
      try {
        const url = new URL(value);
        const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if ((!localHttp && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.hash) return null;
        return url.origin;
      } catch { return null; }
    });
    if (normalized.some((origin) => origin === null)) return c.json({ error: "Each origin must be an HTTPS origin (localhost HTTP is allowed for development)", code: "invalid_origins" }, 400);
    origins = [...new Set(normalized as string[])].slice(0, 20);
  }
  if (!name || (kind !== "publishable" && kind !== "secret")) return c.json({ error: "A name and key type are required", code: "invalid_key_request" }, 400);
  if (kind === "publishable" && origins.length === 0) return c.json({ error: "Publishable keys require at least one allowed browser origin", code: "origin_required" }, 400);
  const count = db.query("SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL").get(account.id) as { n: number };
  if (count.n >= 20) return c.json({ error: "Maximum of 20 active API keys reached", code: "key_limit" }, 409);
  const key = createKey(account.id, name, kind, origins);
  return c.json({ key: key.key, id: key.id, name: key.name, kind: key.kind, prefix: key.prefix, origins: key.origins }, 201);
});

app.delete("/api/keys/:id", requireSession, (c) => {
  const account = c.get("account");
  const result = db.query("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL").run(utcNow(), c.req.param("id"), account.id);
  if (result.changes === 0) return c.json({ error: "Key not found", code: "not_found" }, 404);
  return c.json({ ok: true });
});



app.post("/api/billing/portal", requireSession, async (c) => {
  const account = c.get("account");
  const subscription = currentSubscription(account.id);
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return c.json({ error: "Billing is not connected yet", code: "billing_not_configured" }, 503);
  if (!subscription?.stripe_customer_id) return c.json({ error: "No Stripe customer is linked to this workspace", code: "billing_customer_missing" }, 404);
  const params = new URLSearchParams({ customer: subscription.stripe_customer_id, return_url: `${originFor(c)}/console` });
  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return c.json({ error: "Stripe could not be reached", code: "billing_unavailable" }, 502);
  }
  const result = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !result.url) return c.json({ error: result.error?.message ?? "Stripe could not open billing management", code: "billing_portal_failed" }, 502);
  return c.json({ url: result.url });
});

app.post("/api/billing/checkout", requireSession, async (c) => {
  const account = c.get("account");
  const body = await c.req.json().catch(() => null) as { plan?: string } | null;
  const plan = body?.plan;
  if (!isPlanId(plan) || plan === "free") return c.json({ error: "Choose a paid plan", code: "invalid_plan" }, 400);
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !process.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: "Billing is not connected yet", code: "billing_not_configured" }, 503);
  const subscription = currentSubscription(account.id);
  if (subscription?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(subscription.status)) {
    return c.json({ error: "Manage your current subscription in the billing portal", code: "subscription_exists" }, 409);
  }
  const params = new URLSearchParams({
    mode: "subscription",
    success_url: `${originFor(c)}/console?checkout=success`,
    cancel_url: `${originFor(c)}/console?checkout=cancelled`,
    ...(subscription?.stripe_customer_id ? { customer: subscription.stripe_customer_id } : { customer_email: account.email }),
    client_reference_id: account.id,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(plans[plan].monthlyCents),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": `Article50Kit ${plans[plan].name}`,
    "metadata[account_id]": account.id,
    "metadata[plan]": plan,
    "subscription_data[metadata][account_id]": account.id,
    "subscription_data[metadata][plan]": plan,
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({})) as { url?: string; error?: { message?: string } };
  if (!response.ok || !result.url) return c.json({ error: result.error?.message ?? "Stripe could not start checkout", code: "checkout_failed" }, 502);
  return c.json({ url: result.url });
});

function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((entry) => entry.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expectedBytes.length && timingSafeEqual(given, expectedBytes);
  });
}

app.post("/api/stripe/webhook", async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = c.req.header("stripe-signature") ?? "";
  const body = await c.req.text();
  if (!secret || !verifyStripeSignature(body, signature, secret)) return c.json({ error: "Invalid Stripe signature" }, 400);
  const event = JSON.parse(body) as { id: string; type: string; data: { object: Record<string, any> } };
  try {
    db.query("INSERT INTO stripe_events(event_id, received_at) VALUES (?, ?)").run(event.id, utcNow());
  } catch {
    return c.json({ received: true, duplicate: true });
  }
  const obj = event.data.object;
  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const accountId = obj.metadata?.account_id ?? obj.client_reference_id;
    const plan = obj.metadata?.plan as PlanId;
    if (accountId && db.query("SELECT 1 FROM accounts WHERE id = ?").get(accountId) && isPlanId(plan) && plan !== "free") {
      db.query(`INSERT INTO subscriptions(account_id, plan, status, stripe_customer_id, stripe_subscription_id, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET plan=excluded.plan, status='active', stripe_customer_id=excluded.stripe_customer_id, stripe_subscription_id=excluded.stripe_subscription_id, updated_at=excluded.updated_at`)
        .run(accountId, plan, obj.customer ?? null, obj.subscription ?? null, utcNow());
    }
  }
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const accountId = obj.metadata?.account_id;
    const plan = obj.metadata?.plan as PlanId;
    const accountExists = accountId && db.query("SELECT 1 FROM accounts WHERE id = ?").get(accountId);
    if (accountExists && isPlanId(plan) && plan !== "free") {
      db.query(`INSERT INTO subscriptions(account_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET plan=excluded.plan, status=excluded.status, stripe_customer_id=excluded.stripe_customer_id, stripe_subscription_id=excluded.stripe_subscription_id, current_period_end=excluded.current_period_end, updated_at=excluded.updated_at`)
        .run(accountId, plan, event.type === "customer.subscription.deleted" ? "canceled" : String(obj.status), obj.customer ?? null, obj.id, obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null, utcNow());
    }
  }
  return c.json({ received: true });
});

const api: App = new Hono<{ Variables: Variables }>();
api.use("/v1/*", async (c, next) => {
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key");
  c.header("Access-Control-Max-Age", "600");
  const origin = c.req.header("origin") ?? "";
  if (c.req.method === "OPTIONS") {
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    return c.body(null, 204);
  }
  if (origin && c.req.path !== "/v1/health") {
    const key = apiKeyByValue(keyInput(c), false);
    if (!key || !originAllowed(origin, key)) return c.json({ error: "Browser requests require a publishable key restricted to this origin", code: "origin_not_allowed" }, 403);
  }
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  await next();
});
api.get("/v1/health", (c) => c.json({ status: "ok", c2paSigningConfigured: Boolean(process.env.C2PA_CERT_PEM && process.env.C2PA_PRIVATE_KEY_PEM) }));

api.post("/v1/events", requireApiKey, async (c) => {
  const key = c.get("apiKey");
  if (!rateLimit(`api:${key.id}`, 120)) return c.json({ error: "Rate limit exceeded", code: "rate_limited" }, 429);
  const quota = checkQuota(key.account_id, "event");
  if (quota) return c.json({ error: "Monthly event limit reached", code: "quota_exceeded", usage: quota }, 402);
  const body = await c.req.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid event payload", code: "invalid_payload", details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) }, 400);
  const value = parsed.data;
  const event = insertEvent({
    accountId: key.account_id,
    keyId: key.id,
    eventType: value.eventType,
    surface: value.surface,
    locale: value.locale,
    notice: value.notice,
    policyVersion: value.policyVersion,
    contentSha256: value.contentSha256?.toLowerCase() ?? null,
    clientReportedAt: value.occurredAt ?? null,
  });
  return c.json({ ...event, recorded: true, statement: "The receipt records data submitted by your integration; it does not independently confirm that a notice was displayed." }, 201);
});

api.get("/v1/events", requireApiKey, (c) => {
  const key = c.get("apiKey");
  if (key.kind !== "secret") return c.json({ error: "A secret API key is required", code: "insufficient_key_scope" }, 403);
  const events = db.query(`SELECT id, event_type, surface, locale, notice, policy_version, content_sha256, client_reported_at, received_at, event_hash
    FROM audit_events WHERE account_id = ? ORDER BY rowid DESC LIMIT 100`).all(key.account_id);
  return c.json({ events, limit: 100, note: "Events are customer-submitted records; receipt does not independently verify user-visible delivery." });
});

api.post("/v1/mark", requireApiKey, async (c) => {
  const key = c.get("apiKey");
  if (key.kind !== "secret") return c.json({ error: "A secret API key is required for asset signing", code: "insufficient_key_scope" }, 403);
  const quota = checkQuota(key.account_id, "mark");
  if (quota) return c.json({ error: "Monthly media-signing limit reached or not included in this plan", code: "quota_exceeded", usage: quota }, 402);
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_SIGNING_BYTES + 65_536) return c.json({ error: "Asset exceeds the 8 MB limit", code: "asset_too_large" }, 413);
  const requestBody = await readLimitedBody(c, MAX_SIGNING_BYTES + 65_536);
  if (!requestBody) return c.json({ error: "Asset exceeds the 8 MB upload limit", code: "asset_too_large" }, 413);
  const form = await new Response(requestBody, { headers: { "Content-Type": c.req.header("content-type") ?? "" } }).formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "Send a multipart field named file", code: "file_required" }, 400);
  if (file.size > MAX_SIGNING_BYTES) return c.json({ error: "Asset exceeds the 8 MB limit", code: "asset_too_large" }, 413);
  try {
    const result = await signAiMedia({ buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, filename: file.name });
    const signedHash = sha256(result.buffer);
    const event = insertEvent({
      accountId: key.account_id,
      keyId: key.id,
      eventType: "c2pa_media_mark",
      surface: "Article50Kit media signing API",
      locale: "und",
      notice: "C2PA manifest asserted AI-generated media; signature trust depends on the signing certificate and recipient verifier.",
      policyVersion: "c2pa-node/0.9.10",
      contentSha256: signedHash,
    });
    const baseName = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 100) || "asset";
    return new Response(toArrayBuffer(result.buffer), {
      headers: {
        "Content-Type": file.type,
        "Content-Disposition": `attachment; filename="article50kit-${baseName}"`,
        "X-Article50Kit-Event-Id": event.id,
        "X-Article50Kit-Event-Hash": event.eventHash,
        "X-Article50Kit-Asset-SHA256": signedHash,
        "X-Article50Kit-C2PA-Manifest": result.manifestId,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "signing_failed";
    if (code === "c2pa_signer_not_configured") return c.json({ error: "C2PA signing is not configured. Add a production C2PA signing credential before issuing signed assets.", code }, 503);
    if (code === "unsupported_media_type") return c.json({ error: "Supported media types: JPEG and PNG", code }, 415);
    if (code === "asset_too_large") return c.json({ error: "Asset exceeds the 8 MB limit", code }, 413);
    console.error("C2PA signing failed", error);
    return c.json({ error: "C2PA signing failed for this asset", code: "signing_failed" }, 422);
  }
});

api.post("/v1/evidence-packs", requireApiKey, async (c) => {
  const key = c.get("apiKey");
  if (key.kind !== "secret") return c.json({ error: "A secret API key is required", code: "insufficient_key_scope" }, 403);
  const account = db.query("SELECT email, organization FROM accounts WHERE id = ?").get(key.account_id) as { email: string; organization: string } | null;
  if (!account) return c.json({ error: "Account not found", code: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({})) as { from?: string; to?: string };
  const allEvents = getAccountEvents(key.account_id);
  const chainValid = verifyAuditEvents(allEvents);
  const from = body.from ? new Date(body.from) : null;
  const to = body.to ? new Date(body.to) : null;
  if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) return c.json({ error: "Date filters must be ISO timestamps", code: "invalid_date" }, 400);
  const events = allEvents.filter((event) => (!from || new Date(event.received_at) >= from) && (!to || new Date(event.received_at) <= to));
  if (events.length > 2_000) return c.json({ error: "A pack is limited to 2,000 events. Narrow the date range.", code: "evidence_limit" }, 413);
  const pdf = await createEvidencePdf({ organization: account.organization, email: account.email, from: body.from, to: body.to, events, chainValid });
  return new Response(toArrayBuffer(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="article50kit-evidence-${new Date().toISOString().slice(0, 10)}.pdf"`, "Cache-Control": "no-store" } });
});

app.route("/", api);

export default app;
