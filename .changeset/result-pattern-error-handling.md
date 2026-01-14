---
"@radkode/neo": minor
---

Adopt Result<T> pattern and shared git error utilities

- Refactored git/push, git/pull, git/commit, git/branch to return Result<void>
- Commands now use `success()` and `failure()` helpers from core/errors
- Replaced direct `process.exit()` calls with Result-based error handling
- Added shared `git-errors.ts` utility module with GitError class and error detection
- Extracted common error patterns (not a repo, auth, network, conflicts, etc.)
- Consistent error reporting with suggestions across all git commands
