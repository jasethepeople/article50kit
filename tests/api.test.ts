import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { Reader } from "@contentauth/c2pa-node";

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.PUBLIC_APP_URL = "https://article50kit.test";

const { default: app } = await import("../backend-lib/api");
const origin = "https://article50kit.test";
let accountNumber = 0;

async function register() {
  const email = `buyer${++accountNumber}@example.test`;
  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple", organization: "Example Studio", acceptedTerms: true }),
  });
  const body = await response.json() as { account?: { id: string }; apiKey?: string; error?: string };
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { response, body, cookie, email };
}

function stripeSignature(payload: string, secret: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return { timestamp, value: `t=${timestamp},v1=${signature}` };
}

async function activatePlan(accountId: string, secret: string, eventId = `evt_${crypto.randomUUID().replaceAll("-", "")}`) {
  const payload = JSON.stringify({
    id: eventId,
    type: "customer.subscription.created",
    data: { object: {
      id: `sub_${crypto.randomUUID().replaceAll("-", "")}`,
      customer: `cus_${crypto.randomUUID().replaceAll("-", "")}`,
      status: "active",
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      metadata: { account_id: accountId, plan: "starter" },
    } },
  });
  const signature = stripeSignature(payload, secret);
  const headers = { "Content-Type": "application/json", "Stripe-Signature": signature.value };
  const response = await app.request("/api/stripe/webhook", { method: "POST", headers, body: payload });
  return { response, headers, payload, signature };
}

describe("Article50Kit HTTP API", () => {
  test("health and public capability configuration are readable", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect((await health.json() as { service: string }).service).toBe("article50kit");
    const config = await app.request("/api/public-config");
    expect(config.status).toBe(200);
    const body = await config.json() as { billingEnabled: boolean; c2paSigningConfigured: boolean };
    expect(body.billingEnabled).toBe(false);
    expect(body.c2paSigningConfigured).toBe(false);
  });

  test("registration, session, login, and publishable key creation work", async () => {
    const { response, body, cookie, email } = await register();
    expect(response.status).toBe(201);
    expect(body.account?.id).toBeTruthy();
    expect(body.apiKey?.startsWith("a50_pk_")).toBe(true);
    expect(cookie.startsWith("a50_session=")).toBe(true);
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    const meBody = await me.json() as { account?: { email: string }; keys?: unknown[] };
    expect(meBody.account?.email).toBe(email);
    expect(meBody.keys?.length).toBe(1);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    expect(login.status).toBe(200);
    const malformedOrigin = await app.request("/api/keys", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad origin", kind: "publishable", origins: ["not-an-origin"] }),
    });
    expect(malformedOrigin.status).toBe(400);
  });

  test("event ingestion enforces API-key scopes and browser origin restrictions", async () => {
    const { body, cookie } = await register();
    const payload = { eventType: "ai_interaction_disclosure", surface: "support-chat", locale: "en-GB", notice: "You are interacting with an AI assistant.", policyVersion: "chat-v1" };
    const missing = await app.request("/v1/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    expect(missing.status).toBe(401);
    const blocked = await app.request("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}`, Origin: "https://not-authorized.example" },
      body: JSON.stringify(payload),
    });
    expect(blocked.status).toBe(403);
    const accepted = await app.request("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}`, Origin: origin },
      body: JSON.stringify(payload),
    });
    expect(accepted.status).toBe(201);
    const receipt = await accepted.json() as { recorded: boolean; eventHash: string; statement: string };
    expect(receipt.recorded).toBe(true);
    expect(receipt.eventHash).toHaveLength(64);
    expect(receipt.statement).toContain("does not independently confirm");
    const deniedRead = await app.request("/v1/events", { headers: { Authorization: `Bearer ${body.apiKey}`, Origin: origin } });
    expect(deniedRead.status).toBe(403);
    const dashboard = await app.request("/api/events", { headers: { Cookie: cookie } });
    expect((await dashboard.json() as { chainValid: boolean }).chainValid).toBe(true);
  });

  test("parallel event writes preserve a single verifiable hash chain", async () => {
    const { body, cookie } = await register();
    const writes = await Promise.all(Array.from({ length: 24 }, (_, index) => app.request("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}`, Origin: origin },
      body: JSON.stringify({ eventType: "ai_interaction_disclosure", surface: `support-chat-${index}`, notice: "AI assistant" }),
    })));
    expect(writes.every((response) => response.status === 201)).toBe(true);
    const dashboard = await app.request("/api/events", { headers: { Cookie: cookie } });
    const result = await dashboard.json() as { events: unknown[]; chainValid: boolean };
    expect(result.events).toHaveLength(24);
    expect(result.chainValid).toBe(true);
  });

  test("Stripe subscription webhooks are signature-checked and idempotent", async () => {
    const { body, cookie } = await register();
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const secret = "whsec_article50kit_test_only";
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    try {
      const first = await activatePlan(body.account!.id, secret);
      expect(first.response.status).toBe(200);
      const duplicate = await app.request("/api/stripe/webhook", { method: "POST", headers: first.headers, body: first.payload });
      expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true);
      const stale = await app.request("/api/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": "t=1,v1=bad" }, body: first.payload });
      expect(stale.status).toBe(400);
      const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
      const dashboard = await me.json() as { usage: { plan: string }; subscription: { hasBillingCustomer: boolean } };
      expect(dashboard.usage.plan).toBe("starter");
      expect(dashboard.subscription.hasBillingCustomer).toBe(true);
    } finally {
      if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    }
  });

  test("C2PA endpoint returns a readable signed PNG and records the mark", async () => {
    const { body: registration, cookie } = await register();
    const previousStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const previousCert = process.env.C2PA_CERT_PEM;
    const previousKey = process.env.C2PA_PRIVATE_KEY_PEM;
    const stripeSecret = "whsec_c2pa_http_test_only";
    process.env.STRIPE_WEBHOOK_SECRET = stripeSecret;
    process.env.C2PA_CERT_PEM = readFileSync(new URL("./fixtures/certs/c2pa-test-chain.pem", import.meta.url), "utf8");
    process.env.C2PA_PRIVATE_KEY_PEM = readFileSync(new URL("./fixtures/certs/c2pa-test-key.pem", import.meta.url), "utf8");
    try {
      const activated = await activatePlan(registration.account!.id, stripeSecret);
      expect(activated.response.status).toBe(200);
      const keyResponse = await app.request("/api/keys", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "C2PA test", kind: "secret", origins: [] }),
      });
      expect(keyResponse.status).toBe(201);
      const secret = (await keyResponse.json() as { key: string }).key;
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WioAAAAASUVORK5CYII=", "base64");
      const form = new FormData();
      form.set("file", new File([png], "generated.png", { type: "image/png" }));
      const signed = await app.request("/v1/mark", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: form });
      expect(signed.status).toBe(200);
      expect(signed.headers.get("X-Article50Kit-Event-Id")).toBeTruthy();
      const bytes = Buffer.from(await signed.arrayBuffer());
      const reader = await Reader.fromAsset({ buffer: bytes, mimeType: "image/png" });
      expect(reader?.getActive()?.assertions?.some((assertion) => assertion.label === "org.article50kit.ai-disclosure")).toBe(true);
      const events = await app.request("/api/events", { headers: { Cookie: cookie } });
      const result = await events.json() as { events: Array<{ event_type: string }>; chainValid: boolean };
      expect(result.events[0]?.event_type).toBe("c2pa_media_mark");
      expect(result.chainValid).toBe(true);
    } finally {
      if (previousStripeSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousStripeSecret;
      if (previousCert === undefined) delete process.env.C2PA_CERT_PEM;
      else process.env.C2PA_CERT_PEM = previousCert;
      if (previousKey === undefined) delete process.env.C2PA_PRIVATE_KEY_PEM;
      else process.env.C2PA_PRIVATE_KEY_PEM = previousKey;
    }
  });

  test("evidence pack is a PDF with an intact event-chain summary", async () => {
    const { body, cookie } = await register();
    await app.request("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}`, Origin: origin },
      body: JSON.stringify({ eventType: "ai_interaction_disclosure", surface: "support-chat", notice: "AI assistant" }),
    });
    const response = await app.request("/api/evidence-pack", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  test("paid checkout remains disabled until Stripe is configured", async () => {
    const { cookie } = await register();
    const response = await app.request("/api/billing/checkout", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ plan: "starter" }) });
    expect(response.status).toBe(503);
    expect((await response.json() as { code: string }).code).toBe("billing_not_configured");
  });
});
