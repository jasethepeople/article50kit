# @article50kit/react

An accessible React component that renders a visible AI-interaction disclosure notice.

## Package status

This package has not been published to npm. Build it locally with `bun run build`; publishing requires the operator's npm organization/account, a package-licensing decision, and a published API host.

## Example

```tsx
import { Article50KitClient } from "@article50kit/js";
import { DisclosureNotice } from "@article50kit/react";

const client = new Article50KitClient({
  baseUrl: process.env.ARTICLE50KIT_API_URL!,
  apiKey: process.env.NEXT_PUBLIC_ARTICLE50KIT_KEY!,
});

<DisclosureNotice
  locale="en-GB"
  message="You are interacting with an AI assistant."
  onShown={() => {
    void client.recordDisclosure({
      eventType: "ai_interaction_disclosure",
      surface: "support-chat",
      locale: "en-GB",
      notice: "You are interacting with an AI assistant.",
    });
  }}
/>
```

`onShown` runs once when at least half the notice enters the viewport. It is a client-side observation, not proof of comprehension or legal sufficiency. Use a publishable key only with a strict browser-origin allowlist; never put a secret key in browser code.
