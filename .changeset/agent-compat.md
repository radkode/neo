---
'@radkode/neo': minor
---

feat: make the CLI agent-compatible end-to-end

- Add global `--json`, `--yes`, `--non-interactive`, `--quiet` flags, plus matching `NEO_*` env vars. Auto-detect TTY, CI, and known agent env vars (`CLAUDECODE`, `CURSOR_AGENT`, `AIDER`, …).
- Route all diagnostic output (`logger`, `ui.*`, spinners) to stderr; reserve stdout for data. Banner and update-check now suppress in agent/JSON/quiet/CI modes.
- Every interactive prompt now honors `--yes` (auto-accept safe defaults) or fails fast with exit code 2 and a structured `NonInteractiveError` that names the flag an agent should pass next time. Destructive defaults (force-delete, main-branch push, unmerged branch removal) require explicit opt-in.
- Commands emit structured JSON on stdout under `--json` via `emitJson` / `emitError` helpers, including error code/category/severity/suggestions.
- New `neo schema` command dumps an OpenCLI-style JSON description of every command, option, argument, exit code, and env var — the self-describing surface agents use for discovery.
- Top-level `--help` and every leaf command gain an `Examples:` section with agent-friendly invocations.
