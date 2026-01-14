---
"@radkode/neo": minor
---

Implement ILogger interface in logger.ts

- Logger class now implements the ILogger interface from core/interfaces
- Added setLevel/getLevel methods for proper log level management
- Added optional context parameter to debug, info, warn, error, success methods
- Log messages are now filtered based on the configured log level
- Maintained backwards compatibility with setVerbose method
