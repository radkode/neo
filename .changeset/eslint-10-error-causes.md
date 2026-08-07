---
'@radkode/neo': patch
---

Attach the originating error as `cause` at nine sites that previously rethrew a wrapped error without it, so the underlying failure is now recoverable from the thrown error. User-facing messages are unchanged. Surfaced by upgrading to eslint 10.
