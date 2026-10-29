import { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Copy, Fingerprint, LockKeyhole, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { DisclosureNotice } from "../../packages/react/src/DisclosureNotice";

const starter = `import { Article50KitClient } from "@article50kit/js";\n\nconst kit = new Article50KitClient({\n  baseUrl: API_BASE,\n  apiKey: PUBLISHABLE_KEY,\n});\n\nawait kit.recordDisclosure({\n  eventType: "ai_interaction_disclosure",\n  surface: "support-chat",\n  locale: "en-GB",\n  notice: "You are interacting with an AI assistant.",\n  policyVersion: "chat-v1",\n});`;

function Brand() {
  return <a href="/" className="a50-brand"><span className="a50-brand-mark">50</span><span>article<span>50</span>kit</span></a>;
}

function Snippet() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(starter);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return <div className="a50-code-panel"><div className="a50-code-top"><span><span className="a50-code-dot" /> Disclosure receipt · JavaScript</span><button className="a50-copy-button" onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button></div><pre><code>{starter}</code></pre></div>;
}

export default function HomePage() {
  return (
    <div className="a50-home">
      <div className="a50-top-note"><span className="a50-live-dot" /> Article 50 rules apply from 2 August 2026; existing-system marking transition ends 2 December <a href="/docs#legal-scope">Scope & exceptions <ArrowUpRight size={12} /></a></div>
      <header className="a50-nav"><Brand /><nav><a href="#platform">Platform</a><a href="/docs">Developers</a><a href="#pricing">Pricing</a></nav><div className="a50-nav-actions"><a className="a50-nav-login" href="/console">Sign in</a><a className="a50-button a50-button-dark a50-button-small" href="/console">Open console <ArrowUpRight size={14} /></a></div></header>

      <main>
        <section className="a50-hero">
          <div className="a50-hero-copy">
            <span className="a50-eyebrow"><span className="a50-eyebrow-mark">✳</span> AI TRANSPARENCY TOOLKIT FOR PRODUCT TEAMS</span>
            <h1>Make AI visible.<br /><em>Keep the evidence.</em></h1>
            <p className="a50-hero-lead">Drop-in disclosure UI, machine-readable provenance for generated media, and a clean evidence trail—without rebuilding your product.</p>
            <div className="a50-hero-actions"><a href="/console" className="a50-button a50-button-dark">Create a free workspace <ArrowRight size={15} /></a><a href="/docs" className="a50-text-link">Read the developer guide <ArrowUpRight size={14} /></a></div>
            <div className="a50-hero-proof"><span><Check size={13} /> Start free · no card</span><span><Check size={13} /> REST API + SDK source</span><span><Check size={13} /> Your records stay yours</span></div>
          </div>
          <div className="a50-hero-visual">
            <div className="a50-visual-caption"><span>01 / IN THE PRODUCT</span><span className="a50-caption-status"><span className="a50-live-dot" /> NOTICE VISIBLE</span></div>
            <div className="a50-chat-card">
              <div className="a50-chat-head"><div className="a50-avatar">M</div><div><strong>Morrow Support</strong><span>Order assistant · online</span></div><span className="a50-chat-more">···</span></div>
              <div className="a50-chat-body"><div className="a50-date-label">TODAY, 10:42 AM</div><div className="a50-message a50-message-user">Can you tell me where my order is?</div><div className="a50-message a50-message-ai">I can help with that. Share your order number and I’ll look it up.</div><DisclosureNotice className="a50-live-disclosure" locale="en" message="You are interacting with an AI system. Its responses may be inaccurate." /><div className="a50-chat-input">Write a message… <span>↗</span></div></div>
              <div className="a50-receipt"><div className="a50-receipt-icon"><Fingerprint size={16} /></div><div><strong>Display receipt ready</strong><span>surface · locale · policy version · SHA-256 chain</span></div><span className="a50-receipt-check"><Check size={13} /></span></div>
            </div>
            <div className="a50-visual-foot"><span>Example UI only</span><span>Never a legal determination</span></div>
          </div>
        </section>

        <section className="a50-trust-strip"><span>BUILT FOR THE TEAMS SHIPPING AI FEATURES</span><div><span><Workflow size={15} /> PRODUCT</span><span><LockKeyhole size={15} /> ENGINEERING</span><span><ShieldCheck size={15} /> TRUST & SAFETY</span><span><Fingerprint size={15} /> LEGAL OPS</span></div></section>

        <section className="a50-section a50-platform" id="platform">
          <div className="a50-section-intro"><span className="a50-kicker">THE TRANSPARENCY LAYER</span><h2>Three small pieces.<br />One auditable flow.</h2><p>Give product teams a simple way to disclose, mark, and document—while keeping the legal decision where it belongs: with your team and counsel.</p></div>
          <div className="a50-feature-grid">
            <article className="a50-feature-card"><div className="a50-feature-icon a50-icon-mint"><Sparkles size={17} /></div><span className="a50-feature-index">01 / DISCLOSE</span><h3>Put the notice where it matters.</h3><p>Accessible React UI with editable, localized copy. Record when the notice enters view; decide placement and wording for your own product.</p><a href="/docs#disclosures">See the component <ArrowUpRight size={13} /></a></article>
            <article className="a50-feature-card"><div className="a50-feature-icon a50-icon-blue"><Fingerprint size={17} /></div><span className="a50-feature-index">02 / MARK</span><h3>Attach C2PA credentials to media.</h3><p>Sign JPEG and PNG assets with a C2PA manifest when you supply an appropriate signing credential. No credential, no misleading “verified” badge.</p><a href="/docs#c2pa">Read signing requirements <ArrowUpRight size={13} /></a></article>
            <article className="a50-feature-card"><div className="a50-feature-icon a50-icon-amber"><ShieldCheck size={17} /></div><span className="a50-feature-index">03 / DOCUMENT</span><h3>Export the records you actually have.</h3><p>Hash-linked event receipts and a readable PDF evidence pack. Each report explains what the log can—and cannot—prove.</p><a href="/docs#evidence">Inspect the report <ArrowUpRight size={13} /></a></article>
          </div>
        </section>

        <section className="a50-integration">
          <div className="a50-integration-copy"><span className="a50-kicker">A FEW LINES, NOT A REWRITE</span><h2>Keep the conversation.<br /><em>Add the receipt.</em></h2><p>Your UI shows the notice. Your backend sends a minimal receipt. Article50Kit stores the record—not the conversation.</p><div className="a50-integration-checks"><span><Check size={13} /> No chat transcript field</span><span><Check size={13} /> Browser keys limited to event writes</span><span><Check size={13} /> Hash chain checked on export</span></div><a href="/docs" className="a50-text-link">Read the API reference <ArrowRight size={14} /></a></div><Snippet />
        </section>

        <section className="a50-pricing a50-section" id="pricing"><div className="a50-pricing-intro"><span className="a50-kicker">STRAIGHTFORWARD MONTHLY PRICING</span><h2>Start small.<br /><em>Scale with usage.</em></h2><p>Free workspace for integration testing. No legal-compliance guarantees hidden in a plan tier.</p></div><div className="a50-pricing-grid">
          <article className="a50-price-card"><span className="a50-plan-name">SANDBOX</span><h3>$0 <small>/ month</small></h3><p>Try the API with real records.</p><ul><li><Check size={13} /> 500 events / month</li><li><Check size={13} /> Disclosure component</li><li><Check size={13} /> Dashboard & PDF export</li><li><Check size={13} /> C2PA signing not included</li></ul><a className="a50-button a50-button-outline" href="/console">Create free workspace <ArrowRight size={14} /></a></article>
          <article className="a50-price-card a50-price-featured"><span className="a50-price-tag">FOR LAUNCHING TEAMS</span><span className="a50-plan-name">STARTER</span><h3>$29 <small>/ month</small></h3><p>For a product adding its first AI workflows.</p><ul><li><Check size={13} /> 10,000 events / month</li><li><Check size={13} /> 2,000 media marks / month</li><li><Check size={13} /> C2PA signing with your credential</li><li><Check size={13} /> Evidence packs & API keys</li></ul><a className="a50-button a50-button-dark" href="/console?plan=starter">Choose Starter <ArrowRight size={14} /></a></article>
          <article className="a50-price-card"><span className="a50-plan-name">GROWTH</span><h3>$79 <small>/ month</small></h3><p>For growing products and more surfaces.</p><ul><li><Check size={13} /> 100,000 events / month</li><li><Check size={13} /> 20,000 media marks / month</li><li><Check size={13} /> 20 active API keys</li><li><Check size={13} /> Evidence packs & API keys</li></ul><a className="a50-button a50-button-outline" href="/console?plan=growth">Choose Growth <ArrowRight size={14} /></a></article>
          <article className="a50-price-card"><span className="a50-plan-name">SCALE</span><h3>$199 <small>/ month</small></h3><p>For high-volume production workloads.</p><ul><li><Check size={13} /> 1,000,000 events / month</li><li><Check size={13} /> 200,000 media marks / month</li><li><Check size={13} /> API access & PDF reports</li><li><Check size={13} /> Bring your own C2PA credential</li></ul><a className="a50-button a50-button-outline" href="/console?plan=scale">Choose Scale <ArrowRight size={14} /></a></article>
        </div><p className="a50-price-note">Paid checkout and production C2PA signing require the operator's Stripe account and a suitable C2PA signing credential. Those are not configured in this beta yet.</p></section>

        <section className="a50-legal-band"><div className="a50-legal-symbol">§</div><div><span className="a50-kicker">USE THE STANDARD. DON'T OVERPROMISE IT.</span><h2>Article 50 is contextual.<br /><em>Your tooling should be too.</em></h2><p>Different duties apply to certain AI providers and deployers, and exceptions matter. The €35M / 7% headline penalty is for prohibited practices—not a blanket Article 50 fine. Article50Kit helps implement and document technical controls; it does not decide if they satisfy your legal duties.</p><a href="/docs#legal-scope">See scope notes and official source <ArrowUpRight size={13} /></a></div><div className="a50-law-stamp"><span>EU AI ACT</span><strong>ART. 50</strong><small>TRANSPARENCY</small></div></section>

        <section className="a50-bottom-cta"><div><span className="a50-kicker">BUILD THE FIRST RECEIPT</span><h2>Start with a disclosure.<br /><em>Get the trail for free.</em></h2></div><a href="/console" className="a50-button a50-button-dark">Create a free workspace <ArrowRight size={15} /></a></section>
      </main>

      <footer className="a50-footer"><div className="a50-footer-top"><Brand /><span>Transparency infrastructure for AI products.</span><div className="a50-footer-links"><a href="/docs">Docs</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/console">Console</a></div></div><div className="a50-footer-bottom"><span>© {new Date().getFullYear()} Article50Kit · Early access</span><span>Technical tooling, not legal advice.</span><a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng" target="_blank" rel="noreferrer">Regulation (EU) 2024/1689 <ArrowUpRight size={11} /></a></div></footer>
      <a className="a50-back-to-top" href="#top" aria-label="Back to top"><ArrowDownRight size={14} /></a>
    </div>
  );
}
