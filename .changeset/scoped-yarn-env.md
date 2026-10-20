---
'@radkode/neo': minor
---

Add `neo yarn` with repository-local `.env.yarn.local` discovery and an opt-in yarn shell alias (`neo alias setup --yarn`), matching `neo pnpm` so Yarn package tokens stay out of the parent shell environment. `neo pnpm` and `neo yarn` now report when the package manager cannot be started instead of exiting silently, and `neo alias setup` detects conflicting aliases written without quotes.
