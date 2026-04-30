---
'@radkode/neo': patch
---

Add unit/orchestration tests for `neo work start`, `neo work ship`, `neo work finish` (29 tests). Also fix a stale success-message reference to `.neo/agent/context.db` in `work start` — the path is now `.neo/agent/contexts.json`.
