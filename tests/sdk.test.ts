import { describe, expect, test } from "bun:test";
import { Article50KitClient } from "../packages/js/src/index";

describe("JavaScript SDK", () => {
  test("sends a disclosure with the bearer key and returns its receipt", async () => {
    let capturedUrl = "";
    let capturedAuthorization = "";
    const client = new Article50KitClient({
      baseUrl: "https://api.example.test/",
      apiKey: "a50_pk_test",
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
        return Response.json({ id: "evt-1", receivedAt: "2026-10-28T12:00:00.000Z", eventHash: "abc", recorded: true, statement: "recorded" });
      },
    });
    const receipt = await client.recordDisclosure({ eventType: "ai_interaction_disclosure", surface: "support-chat", notice: "AI assistant" });
    expect(capturedUrl).toBe("https://api.example.test/v1/events");
    expect(capturedAuthorization).toBe("Bearer a50_pk_test");
    expect(receipt.recorded).toBe(true);
  });

  test("rejects a missing API key and server-side use without a base URL", () => {
    expect(() => new Article50KitClient({ apiKey: "" })).toThrow("apiKey is required");
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", { configurable: true, value: undefined });
    try {
      expect(() => new Article50KitClient({ apiKey: "a50_sk_test" })).toThrow("baseUrl is required outside a browser");
    } finally {
      if (originalLocation === undefined) delete (globalThis as { location?: Location }).location;
      else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    }
  });
});
