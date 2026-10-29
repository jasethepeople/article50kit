import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DisclosureNotice } from "../packages/react/src/DisclosureNotice";

describe("React disclosure component", () => {
  test("renders accessible, localized disclosure copy", () => {
    const html = renderToStaticMarkup(<DisclosureNotice locale="fr-FR" label="AI notice" message="This assistant uses AI." />);
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="AI notice"');
    expect(html).toContain('lang="fr-FR"');
    expect(html).toContain("This assistant uses AI.");
    expect(html).toContain('data-article50kit="ai-disclosure"');
  });
});
