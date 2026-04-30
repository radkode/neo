---
'@radkode/neo': minor
---

Replace SQLite-backed agent context store with a JSON file. Drops the `better-sqlite3` and `@types/better-sqlite3` dependencies (and the `pnpm.onlyBuiltDependencies` native-build allowance), making `npm install` faster and friendlier on locked-down machines. The public `ContextDB` surface (`addContext`, `listContexts`, `getContext`, `removeContext`, `updateContext`, `getStats`, `close`) is unchanged. Storage moves from `.neo/agent/context.db` to `.neo/agent/contexts.json` — re-run `neo agent init` to recreate the store if you have existing data.
