---
'@radkode/neo': patch
---

Correct the shipped neo skill's main-branch push guidance: the bypass flag is `--force-main`, not `--force`, which is not a neo flag and passes through to git as a real force-push. Adds an anti-pattern for falling back to raw git/gh when neo is installed but misbehaving.
