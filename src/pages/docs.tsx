import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Terminal } from "lucide-react";

const apiExample = [
  'const response = await fetch(`${API_BASE}/v1/events`, {',
  '  method: "POST",',
  '  headers: { "Content-Type": "application/json", "X-API-Key": PUBLISHABLE_KEY },',
  '  body: JSON.stringify({',
  '    eventType: "ai_interaction_disclosure",',
  '    surface: "support-chat",',
  '    locale: "en-GB",',
  '    notice: "You are interacting with an AI assistant.",',
  '    policyVersion: "chat-disclosure-v1",',
  '  }),',
  '});',
  'if (!response.ok) throw new Error(await response.text());',
  'const receipt = await response.json();',
].join("\n");

const reactExample = [
  'import { Article50KitClient } from "@article50kit/js";',
  'import { DisclosureNotice } from "@article50kit/react";',
  '',
  'function SupportChat() {',
  '  const client = new Article50KitClient({ baseUrl: API_BASE, apiKey: PUBLISHABLE_KEY });',
  '  return (',
  '    <DisclosureNotice',
  '      locale="en-GB"',
  '      message="You are interacting with an AI assistant."',
  '      onShown={() => {',
  '        void client.recordDisclosure({',
  '          eventType: "ai_interaction_disclosure",',
  '          surface: "support-chat",',
  '          locale: "en-GB",',
  '          notice: "You are interacting with an AI assistant.",',
  '        });',
  '      }}',
  '    />',
  '  );',
  '}',
].join("\n");

const markExample = [
  'const form = new FormData();',
  'form.append("file", generatedPng);',
  '',
  'const signedAsset = await fetch(`${API_BASE}/v1/mark`, {',
  '  method: "POST",',
  '  headers: { Authorization: `Bearer ${SECRET_KEY}` },',
  '  body: form,',
  '});',
  'if (!signedAsset.ok) throw new Error(await signedAsset.text());',
  '// Return the signed bytes to the user; keep SECRET_KEY on your server.',
].join("\n");

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return <div className="a50-code-panel"><div className="a50-code-top"><span><Terminal size={12} className="a50-terminal-glyph" /> {title}</span><button className="a50-copy-button" onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button></div><pre><code>{code}</code></pre></div>;
}

export default function DocsPage() {
  return (
    <div className="a50-docs-shell">
      <header className="a50-docs-header"><a className="a50-brand" href="/"><span className="a50-brand-mark">50</span><span>article<span>50</span>kit</span></a><a href="/console" className="a50-docs-console">Open console <ExternalLink size={13} /></a></header>
      <div className="a50-docs-layout">
        <nav className="a50-docs-sidebar"><span className="a50-kicker">DEVELOPER GUIDE</span><a href="#start">Getting started</a><a href="#disclosures">Disclosure notices</a><a href="#events">Event receipts</a><a href="#c2pa">C2PA media signing</a><a href="#evidence">Evidence packs</a><a href="#security">Keys & security</a><a href="#legal-scope">Legal scope</a><a href="/" className="a50-docs-home"><ArrowLeft size={12} /> Back to overview</a></nav>
        <main className="a50-docs-content">
          <span className="a50-kicker">API REFERENCE · BETA</span><h1>Build transparency in.</h1><p className="a50-docs-lead">Add a user-facing AI disclosure, record a minimal receipt, and export a hash-linked report. The service is a technical aid—not a compliance determination.</p>
          <div className="a50-docs-callout"><Check size={15} /><div><strong>Safe key split:</strong> publishable keys can write events from approved browser origins. Secret keys can read events, request evidence packs, and sign media. Keep secret keys on your server.</div></div>
          <section id="start"><h2>Getting started</h2><p>Create a workspace in the console, then create an API key. Set <code>API_BASE</code> to the Article50Kit host and use a publishable key for browser event writes. This beta's SDK and React component source live in <code>packages/js</code> and <code>packages/react</code>; public npm packages have not been published yet.</p><CodeBlock title="Typescript · event receipt" code={apiExample} /></section>
          <section id="disclosures"><h2>Disclosure notices</h2><p>The component renders visible, accessible copy and fires <code>onShown</code> once when the notice enters the viewport. Choose wording and placement for your own product and localize it for your users. Do not rely on a component alone to determine legal sufficiency.</p><CodeBlock title="React · visible notice" code={reactExample} /></section>
          <section id="events"><h2>Event receipts</h2><p><code>POST /v1/events</code> accepts a disclosure event and returns a service receipt. Allowed types are <code>ai_interaction_disclosure</code>, <code>synthetic_content_label</code>, <code>deepfake_label</code>, and <code>human_review</code>. Optional fields: <code>surface</code>, <code>locale</code>, <code>notice</code>, <code>policyVersion</code>, <code>contentSha256</code>, and <code>occurredAt</code>.</p><p>The event payload deliberately has no chat-transcript field. A hash chain can reveal later inconsistencies in the stored record sequence; it cannot prove that your UI rendered the notice or that a person saw it.</p></section>
          <section id="c2pa"><h2>C2PA media signing</h2><p><code>POST /v1/mark</code> accepts a multipart field named <code>file</code> and currently supports JPEG and PNG up to 8 MB. It returns the signed file; an event receipt is added to your account. The server requires a C2PA certificate and private key. A signature's trust status depends on the certificate and on the verifier used by the recipient.</p><p>Article50Kit does not issue certificates or provide a trusted signing identity. Configure a credential from an appropriate issuer, protect its private key, and verify sample outputs with the same trust expectations your buyers use. Do not use a self-signed test credential for customer-facing production assets.</p><CodeBlock title="Server-side · multipart signing" code={markExample} /></section>
          <section id="evidence"><h2>Evidence packs</h2><p><code>POST /v1/evidence-packs</code> uses a secret key and returns a PDF for the account's submitted records. Optional ISO date filters: <code>from</code> and <code>to</code>. A pack is capped at 2,000 events. It includes the record fields, integrity hashes, a chain check, and limitations. It is not an independent attestation, legal opinion, or proof of end-user delivery.</p></section>
          <section id="security"><h2>Keys & security</h2><p>Keys are random, stored as SHA-256 digests, shown only once, and revocable. Restrict publishable-key origins in the console. Browser keys are intentionally visible to users of your application; use them only for event writes. Secret keys are not returned by the API after creation. Rotate them after any suspected exposure.</p><p>Account sessions use HttpOnly, SameSite=Lax cookies. The beta does not yet include email verification, password-reset email, MFA, or independent penetration testing. Do not use it for sensitive personal data or treat it as a finished high-assurance service.</p></section>
          <section id="legal-scope"><h2>Legal scope (not legal advice)</h2><p>Article 50(1) concerns certain AI systems intended to interact directly with natural persons; Article 50(2) concerns marking certain synthetic outputs in a machine-readable, detectable format when technically feasible; and Article 50(4) covers specified deepfake and public-interest text deployments, subject to exceptions. Applicability and duties depend on facts, actor role, and exceptions.</p><p>Regulation (EU) 2026/1744 gives providers of synthetic-content systems placed on the market before 2 August 2026 until 2 December 2026 to take the necessary steps to comply with Article 50(2); it does not defer the other Article 50 duties. The Article 50 obligations are not a universal command to put a visible "AI" label on every SaaS chatbot and embed C2PA in every AI-generated output. Article 99's €35 million / 7% upper tier concerns prohibited AI practices; different tiers apply to other breaches. Check the current consolidated legislation and guidance with counsel.</p><p><a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng" target="_blank" rel="noreferrer">Read Regulation (EU) 2024/1689 <ExternalLink size={12} /></a> · <a href="https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng" target="_blank" rel="noreferrer">Read Regulation (EU) 2026/1744 <ExternalLink size={12} /></a></p></section>
          <p className="a50-docs-end">Article50Kit beta · API version v1 · Availability, signing trust, and compliance outcomes are not guaranteed.</p>
        </main>
      </div>
    </div>
  );
}
