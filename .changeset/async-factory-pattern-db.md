---
"@radkode/neo": patch
---

Refactor ContextDB to use async factory pattern with sync methods

- Made constructor private, moved initialization to static `create()` factory
- Converted all DB methods from async to sync (better-sqlite3 is synchronous)
- Removed unnecessary `ready` promise and `ensureReady()` calls
- Updated all callers to use sync method signatures
