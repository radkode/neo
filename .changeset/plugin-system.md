---
"@radkode/neo": minor
---

Add plugin system for extending CLI functionality

- Load local ESM plugins from ~/.config/neo/plugins/
- Support lifecycle hooks (beforeCommand, afterCommand, onError, onExit)
- Plugin commands automatically registered with CLI
- Configuration options for enabling/disabling plugins
