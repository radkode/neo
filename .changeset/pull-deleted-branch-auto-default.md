---
'@radkode/neo': patch
---

`git pull`: auto-apply the recommended default when a merged branch's remote was deleted, instead of blocking on a prompt in non-interactive/agent environments. The deleted-remote-branch resolution now passes through `safeDefaultForNonInteractive`, matching the diverged-branch path, so agent runs switch to main and safe-delete the branch rather than stopping for input that can't be given.
