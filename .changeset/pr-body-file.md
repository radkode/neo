---
'@radkode/neo': minor
---

`neo gh pr create` (and its `neo pr` alias) accepts `--body-file <path>` / `-F`, with `-` reading stdin, so a multi-paragraph PR body no longer has to go through `--body` quoting; the file is passed through exactly as written, and combining it with `--body` is an error. `--head <branch>` / `-H` opens a PR for a branch that is not checked out, including `<owner>:<branch>`, without guarding or pushing the checked-out branch. Every PR neo creates (`gh pr create`, `ai pr`, `work ship`) now hands the body to gh on stdin, keeping it out of the process list, shell history, debug logs, and error messages.
