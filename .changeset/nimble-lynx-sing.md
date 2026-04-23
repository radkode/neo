---
'@radkode/neo': minor
---

Add workflow commands: `neo sync`, `neo verify`, and `neo changeset`. `sync` rebases the current branch onto origin/<default> with auto-stash. `verify` runs build/test/lint/typecheck and reports structured pass/fail per script. `changeset` creates changeset files with an interactive prompt or fully non-interactively for agents.
