---
"@radkode/neo": minor
---

Add interactive git stash management commands

New commands:
- `neo git stash` - Save changes to stash with interactive naming
- `neo git stash list` - List stashes with interactive selection
- `neo git stash show [n]` - Show stash contents with optional diff
- `neo git stash apply [n]` - Apply stash with conflict detection
- `neo git stash pop [n]` - Apply and remove stash
- `neo git stash drop [n]` - Remove stash with confirmation

Features:
- Visual stash list with timestamps and branch info
- Interactive selection for all operations
- Conflict detection before applying
- Confirmation prompts for destructive operations
- Support for untracked files and keep-index options
