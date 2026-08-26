---
'@radkode/neo': patch
---

Add `-n` / `--no-verify` to `neo git commit`, forwarded to git on both the quick/interactive and `--ai` paths. Repositories that mandate `git commit -n` previously had to bypass neo entirely to commit.
