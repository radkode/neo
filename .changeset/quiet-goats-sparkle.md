---
'@radkode/neo': patch
---

Refuse symlinked agent context paths, bind `.neo` discovery to the Git root, and write `contexts.json` through an exclusive no-follow temporary file so agent context writes cannot overwrite files outside the repository.
