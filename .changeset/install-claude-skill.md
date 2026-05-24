---
'@radkode/neo': minor
---

`neo init` now installs the bundled Claude Code skill at `~/.claude/skills/neo/SKILL.md`. No-op when `~/.claude` is absent; pass `--no-skill` to opt out, or `--force` to overwrite a divergent local copy.
