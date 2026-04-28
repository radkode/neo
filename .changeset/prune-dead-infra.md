---
'@radkode/neo': minor
---

Remove unused plugin system, DI container, and event bus infrastructure. The plugin loader never discovered any plugins in production, the container had zero call sites, and the event bus had no subscribers. Also drops `config.plugins` and `getPluginsDir()` from the config schema, and removes the stale WARP.md and ARCHITECTURE_ANALYSIS docs that documented the removed architecture.
