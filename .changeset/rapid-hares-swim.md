---
'@radkode/neo': minor
---

Add `neo doctor` — read-only diagnostic that checks node version (against engines.node), package managers on PATH, git identity, gh auth, Neo config file integrity, ~/.config/neo writability, and Anthropic API key presence. Exits 1 only on failures — warnings don't fail CI.
