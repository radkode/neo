---
"@radkode/neo": patch
---

Fix Node.js v22 compatibility:
- Update JSON import syntax from `assert` to `with`
- Replace `sqlite3` with `better-sqlite3` for better native binary support and reliability
- `better-sqlite3` provides prebuilt binaries for all major platforms and Node.js versions
