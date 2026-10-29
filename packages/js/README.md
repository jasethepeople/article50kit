# @article50kit/js

The Article50Kit JavaScript client. The package source is in `src/` and the build output is generated in `dist/`.

## Package status

This package has not been published to npm. Build it locally with `bun run build`; publishing requires the operator's npm organization/account, a package-licensing decision, and a published API host.

## Example

```ts
import { Article50KitClient } from "@article50kit/js";

const client = new Article50KitClient({
  baseUrl: process.env.ARTICLE50KIT_API_URL!,
  apiKey: process.env.ARTICLE50KIT_SECRET_KEY!,
});

await client.recordDisclosure({
  eventType: "ai_interaction_disclosure",
  surface: "support-chat",
  locale: "en-GB",
  notice: "You are interacting with an AI assistant.",
  policyVersion: "chat-v1",
});
```

`recordDisclosure` is intended for a server-side secret key or for a publishable browser key with explicit allowed origins. Keep secret keys on your server. `listEvents`, `createEvidencePack`, and `signMedia` require a secret key. Media signing currently accepts JPEG and PNG files up to 8 MiB and requires a configured C2PA signing certificate and private key.

A receipt confirms that the service stored the submitted payload; it does not independently prove that an end user saw a notice. C2PA signatures are only as trustworthy as the signing credential and the recipient's verifier.
