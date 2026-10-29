import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Reader } from "@contentauth/c2pa-node";
import { signAiMedia } from "../backend-lib/c2pa";

const originalCert = process.env.C2PA_CERT_PEM;
const originalKey = process.env.C2PA_PRIVATE_KEY_PEM;
process.env.C2PA_CERT_PEM = readFileSync(new URL("./fixtures/certs/c2pa-test-chain.pem", import.meta.url), "utf8");
process.env.C2PA_PRIVATE_KEY_PEM = readFileSync(new URL("./fixtures/certs/c2pa-test-key.pem", import.meta.url), "utf8");
const sample = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WioAAAAASUVORK5CYII=", "base64");

afterAll(() => {
  if (originalCert === undefined) delete process.env.C2PA_CERT_PEM;
  else process.env.C2PA_CERT_PEM = originalCert;
  if (originalKey === undefined) delete process.env.C2PA_PRIVATE_KEY_PEM;
  else process.env.C2PA_PRIVATE_KEY_PEM = originalKey;
});

describe("C2PA media signing", () => {
  test("embeds a readable C2PA manifest in a PNG", async () => {
    const result = await signAiMedia({ buffer: sample, mimeType: "image/png", filename: "generated.png" });
    expect(result.buffer.length).toBeGreaterThan(sample.length);
    expect(result.manifestId).not.toBe("unknown");
    const reader = await Reader.fromAsset({ buffer: result.buffer, mimeType: "image/png" });
    expect(reader).toBeTruthy();
    const active = reader!.getActive();
    expect(active?.title).toBe("generated.png");
    expect(active?.assertions?.some((assertion) => assertion.label === "org.article50kit.ai-disclosure")).toBe(true);
    expect(result.validationStatus.some((status: { code?: string }) => status.code === "signingCredential.untrusted")).toBe(true);
  });

  test("rejects unsupported file types and oversize assets", async () => {
    await expect(signAiMedia({ buffer: sample, mimeType: "image/gif", filename: "x.gif" })).rejects.toThrow("unsupported_media_type");
    await expect(signAiMedia({ buffer: Buffer.alloc(8 * 1024 * 1024 + 1), mimeType: "image/png", filename: "large.png" })).rejects.toThrow("asset_too_large");
  });
});
