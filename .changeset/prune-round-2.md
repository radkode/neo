---
'@radkode/neo': minor
---

Round 2 cleanup: drop `ui-examples.ts` (no importers), delete stale `docs/DX_IMPROVEMENTS_ROADMAP.md`, consolidate prompt libraries by removing `@inquirer/select` and routing `promptSelect` through the existing `inquirer` package, and trim `src/core/errors` to only the surface the codebase actually consumes (`AppError`, `CommandError`, `Result<T>`, `success`/`failure`/`isFailure`). Removes `ValidationError`, `FileSystemError`, `NetworkError`, `PluginError`, `AuthenticationError`, `PermissionError`, `ConfigurationError`, `RetryStrategy`, `ErrorHandler`, `errorHandler`, `isSuccess`, `handleCommandResult*`, and unused `getUserMessage`/`getDetailedReport`/`toJSON` methods.
