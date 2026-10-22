---
'@radkode/neo': minor
---

`neo git push` now guards protected branches by where a push lands instead of by the checked-out branch. Protected means the remote's default branch plus `main` and `master`. Neo parses every refspec, so `HEAD:main` from a feature branch is no longer pushed unchecked, and deleting an unrelated branch from a `main` checkout no longer asks for main-push confirmation. Force-pushes, deletions, and pushes neo cannot resolve (`--mirror`, `--all`, `--prune`, wildcards, `remote.<name>.push` mappings) of protected branches need `--allow-main` or a confirmation. A checkout can allow plain pushes of its default branch with `git config neo.allowMainPush true`. `--allow-main` replaces `--force-main`, which keeps working as a hidden alias. `--dry-run` now honors the remote and refspecs given and reports each destination. Every refspec after the remote is now pushed, and the value of `-o`/`--push-option` is no longer mistaken for the remote.
