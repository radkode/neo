---
"@radkode/neo": minor
---

Adopt Result<T> pattern for error handling in git commands

- Refactored git/push, git/pull, git/commit, git/branch to return Result<void>
- Commands now use `success()` and `failure()` helpers from core/errors
- Replaced direct `process.exit()` calls with Result-based error handling
- Added `handleCommandResult` and `handleCommandResultSync` utilities
- Improved testability by removing process.exit from command logic
- Consistent error reporting with suggestions across all git commands
