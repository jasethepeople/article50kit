import { describe, expect, test } from "bun:test";
import { verifyAuditEvents, type AuditEvent } from "../backend-lib/audit";
import { canonicalJson, eventHash, sha256 } from "../backend-lib/core";

describe("audit-chain primitives", () => {
  test("canonical JSON is independent of object key order", () => {
    expect(canonicalJson({ z: 2, a: { y: 1, b: true } })).toBe(canonicalJson({ a: { b: true, y: 1 }, z: 2 }));
  });

  test("SHA-256 hashes are stable and content-sensitive", () => {
    expect(sha256("article50kit")).toBe(sha256("article50kit"));
    expect(sha256("article50kit")).not.toBe(sha256("Article50Kit"));
  });

  test("validates an ordered hash chain and detects altered content", () => {
    const firstPayload = {
      id: "event-1",
      account_id: "account-1",
      event_type: "ai_interaction_disclosure",
      surface: "support-chat",
      locale: "en-GB",
      notice: "You are interacting with an AI assistant.",
      policy_version: "v1",
      content_sha256: null,
      client_reported_at: null,
      received_at: "2026-10-28T12:00:00.000Z",
      prev_hash: "GENESIS",
    };
    const firstHash = eventHash(firstPayload);
    const secondPayload = { ...firstPayload, id: "event-2", received_at: "2026-10-28T12:01:00.000Z", prev_hash: firstHash };
    const secondHash = eventHash(secondPayload);
    const events = [
      { ...firstPayload, event_hash: firstHash },
      { ...secondPayload, event_hash: secondHash },
    ] as AuditEvent[];
    expect(verifyAuditEvents(events)).toBe(true);
    expect(verifyAuditEvents([{ ...events[0]!, notice: "changed" }, events[1]!])).toBe(false);
    expect(verifyAuditEvents([events[1]!, events[0]!])).toBe(false);
  });
});
