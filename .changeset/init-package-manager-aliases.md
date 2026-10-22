---
'@radkode/neo': minor
---

`neo init` now offers the opt-in pnpm and yarn aliases (`--pnpm`, `--yarn`, and `--no-pnpm`/`--no-yarn` to remove them), preselecting the ones `~/.zshrc` already has and recording the choice in config. Non-interactive runs keep the current aliases. `neo init` also generates shell completions from the full command tree, so completions written at install time now include `pnpm`, `yarn`, `verify`, `work`, and every other command instead of a hard-coded subset.
