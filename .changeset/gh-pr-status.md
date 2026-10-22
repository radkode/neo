---
'@radkode/neo': minor
---

Add `neo gh pr status`, a read-only view of whether a pull request can merge: checks (required ones decide when branch protection names any), review decision, unresolved review threads, and mergeability, reduced to one verdict with its reasons. `--wait` polls until checks settle and exits `0` only when the PR is ready or merged. `neo gh pr merge --head <sha>` refuses to merge unless the PR head is still the commit you inspected. `neo work ship` now points at `neo gh pr status --wait` once the PR is open.

Fix upstream tracking for pushed branches: `neo git push` sets the upstream on a branch's first push, `neo work ship` retargets a branch that still tracks the base to its own remote branch, and `neo work start` no longer makes new branches track the base.
