---
'@radkode/neo': patch
---

`neo git push` now reports its final outcome once on every path. After `--on-reject pull-rebase` or `--on-reject force` recovers a rejected push, `--json` emits the usual success envelope with `recovery` set to the strategy used (it previously printed nothing), and text mode shows the rejection as a warning followed by the result instead of an error line. The pull-rebase recovery rebases onto the remote and branch the push targets rather than always `origin/<current branch>`. The force fallback keeps a caller's `--force-with-lease`, scoped or bare, instead of adding `--force`, which discarded the lease's expected-value check. Push failures keep git's stderr and exit code in the JSON error (credentials redacted), a cancelled or repeated rejection reports `GIT_NON_FAST_FORWARD`, and an authenticated account without write access is reported as `GIT_PERMISSION_DENIED`.
