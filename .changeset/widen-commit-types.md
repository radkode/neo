---
'@radkode/neo': minor
---

Accept the full Conventional Commits type set. `perf`, `build`, `ci`, and `revert` were previously rejected, so repos that use `ci:` for workflow changes could not commit through neo at all. The list now lives in one place instead of five.
