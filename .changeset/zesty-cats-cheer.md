---
'@radkode/neo': minor
---

Add `neo ai pr` — generate PR title + body from the current branch using Claude, preview, and (optionally) create via gh. Service layer refactor: `callAnthropicAPI` is now exported with configurable `maxTokens`, so new AI commands share the API/retry/cache logic.
