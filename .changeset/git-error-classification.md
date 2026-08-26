---
'@radkode/neo': patch
---

Stop reporting a rebase conflict for any git failure whose stderr merely contains "rebase". `neo git pull` on a dirty working tree now says the tree is dirty and suggests stash or commit, instead of suggesting `git rebase --continue` to people with no rebase in progress.
