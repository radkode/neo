---
'@radkode/neo': minor
---

Finish the agent-mode migration started in 1.2.0 and refresh the AI path.

- Bump the default AI model to `claude-haiku-4-5-20251001` (configurable via `neo config set ai.model`).
- Add prompt caching on the commit-generation system prompt so repeated `neo git commit --ai` calls reuse the cached prefix.
- Expand `--json` coverage to `config get/set/list`, `config profile`, `git worktree add/list`, `agent init`, `agent context`, `completions install`, and more — every success path now emits `{ok, command, ...}`.
- Replace lingering `process.exit()` calls inside command handlers with thrown errors so `runAction` produces structured JSON errors under `--json` (and reliable exit codes 1/2 otherwise).
- Add `neo schema --markdown` so agents and docs pipelines can render the command tree without parsing JSON.
- README rewrite: keep the human-friendly "Why Neo?" pitch, add a prominent "Agent mode" section covering flags, exit codes, environment markers, and the schema workflow.
