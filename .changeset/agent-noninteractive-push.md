---
'@radkode/neo': patch
---

Fix agent/non-interactive mode being silently disabled by the root CLI hook. Unset boolean flags were coerced to `false` and overrode the auto-detection from `CLAUDECODE`/TTY/CI, so commands like `neo git push` would still prompt under an agent. `neo git push` to main now fails fast with a clear "pass --force-main to bypass" message instead of hanging on a confirm prompt that gets swallowed as a generic "Git command failed".
