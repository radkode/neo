---
"@radkode/neo": minor
---

Add AI configuration management via `neo config` command

- Add `neo config set ai.apiKey` to securely store Anthropic API key
- Store secrets in separate `~/.config/neo/secrets.json` with restricted permissions (0600)
- API key is masked in output (shows only last 4 characters)
- Support interactive masked input when setting API key without value
- Add `ai` section to config with `enabled` and `model` settings
- AI service now reads from secrets file first, falls back to ANTHROPIC_API_KEY env var
