import { Builder, LocalSigner, Reader } from "@contentauth/c2pa-node";

export const MAX_SIGNING_BYTES = 8 * 1024 * 1024;
const algorithm = "es256" as const;
const digitalSourceType = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export async function signAiMedia(input: { buffer: Buffer; mimeType: string; filename: string }) {
  if (input.buffer.length > MAX_SIGNING_BYTES) throw new Error("asset_too_large");
  if (!["image/jpeg", "image/png"].includes(input.mimeType)) throw new Error("unsupported_media_type");

  const certificate = process.env.C2PA_CERT_PEM;
  const privateKey = process.env.C2PA_PRIVATE_KEY_PEM;
  if (!certificate || !privateKey) throw new Error("c2pa_signer_not_configured");

  const manifest = {
    claim_generator_info: [{ name: "Article50Kit", version: "1.0.0" }],
    title: input.filename.replace(/[\r\n"\\/]/g, "_").slice(0, 120),
    assertions: [
      {
        label: "c2pa.actions",
        data: { actions: [{ action: "c2pa.created", digitalSourceType }] },
      },
      {
        label: "org.article50kit.ai-disclosure",
        data: {
          ai_generated: true,
          assertion_source: "customer_request",
          disclosure: "AI-generated content",
          standard: "EU AI Act Article 50 technical support; not a compliance determination",
        },
      },
    ],
  };

  const builder = await Builder.withJsonAsync(manifest as never);
  const signer = LocalSigner.newSigner(Buffer.from(certificate), Buffer.from(privateKey), algorithm);
  const output: { buffer: Buffer | null } = { buffer: null };
  builder.sign(signer, { buffer: input.buffer, mimeType: input.mimeType }, output);
  const signed = output.buffer;
  if (!signed) throw new Error("c2pa_signing_output_missing");
  const reader = await Reader.fromAsset({ buffer: signed, mimeType: input.mimeType });
  if (!reader) throw new Error("c2pa_manifest_missing");
  const manifestStore = reader.json();
  const active = reader.getActive();
  if (!active) throw new Error("c2pa_manifest_missing");
  return {
    buffer: signed,
    manifestId: manifestStore.active_manifest ?? "unknown",
    validationStatus: manifestStore.validation_status ?? [],
  };
}
