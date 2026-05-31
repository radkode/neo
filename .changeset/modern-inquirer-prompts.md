---
'@radkode/neo': patch
---

Fix interactive prompts not responding to arrow keys. Migrated every prompt off the legacy `inquirer` rxjs API to the modern `@inquirer/prompts` (`select`, `confirm`, `input`, `checkbox`). The legacy list prompt in inquirer v13 ignored arrow-key navigation, so menus like the `git pull` merged-branch resolver and the `git branch`/`git stash` selectors were stuck on the default option. `inquirer` (and its rxjs/run-async dependencies) is dropped in favor of the lighter, actively maintained packages.
