---
"@radkode/neo": patch
---

Fix `neo git push` to accept positional arguments like standard git push

The command now supports:
- `neo git push -u origin branch-name`
- `neo git push origin branch-name`
- `neo git push` (defaults to origin + current branch)

Previously, `--set-upstream` expected a single branch value, but git uses it as a flag with separate remote and branch arguments.
