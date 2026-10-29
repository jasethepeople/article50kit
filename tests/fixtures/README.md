# C2PA test credentials

`certs/c2pa-test-key.pem` and `certs/c2pa-test-chain.pem` are the C2PA JavaScript project's published test-only ES256 signing key and certificate chain, copied from `contentauth/c2pa-js` under its license in `certs/CAI-LICENSE.txt`:

- https://github.com/contentauth/c2pa-js/tree/main/packages/c2pa-node/tests/fixtures/certs
- https://github.com/contentauth/c2pa-js/blob/main/LICENSE

They are intentionally public, non-production test credentials. Test outputs are expected to be untrusted by normal C2PA verifiers. Never use this key for customer assets or as a production signing identity.
