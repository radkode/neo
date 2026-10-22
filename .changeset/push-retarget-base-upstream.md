---
'@radkode/neo': patch
---

`neo git push` now retargets a branch that still tracks the remote's default branch, such as one created with `git checkout -b x origin/main`, to its own remote branch when it pushes it, and reports the upstream it replaced (`replacedUpstream` in JSON). Branches tracking a different remote or another feature branch keep their upstream.
