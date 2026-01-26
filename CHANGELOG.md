# @radkode/neo

## 0.16.0

### Minor Changes

- [#79](https://github.com/radkode/neo/pull/79) [`ce8617f`](https://github.com/radkode/neo/commit/ce8617f640b25e7cbd6bd44de4baf715ff684798) Thanks [@jacekradko](https://github.com/jacekradko)! - Add compact banner redesign with gradient styling and GitHub PR creation command

- [#78](https://github.com/radkode/neo/pull/78) [`4b5e48c`](https://github.com/radkode/neo/commit/4b5e48c7357c3bf883ca0df43d69ec12ac8e4878) Thanks [@jacekradko](https://github.com/jacekradko)! - Add configuration profiles support for managing multiple config presets

### Patch Changes

- [#76](https://github.com/radkode/neo/pull/76) [`75f84d9`](https://github.com/radkode/neo/commit/75f84d989f41f07bfeceed26cd010a3cf224702c) Thanks [@jacekradko](https://github.com/jacekradko)! - Fix update notification not showing when using `--no-banner` flag

## 0.15.0

### Minor Changes

- [#74](https://github.com/radkode/neo/pull/74) [`634895a`](https://github.com/radkode/neo/commit/634895aee6b75c7e9d07ebc913e6da6637e4c734) Thanks [@jacekradko](https://github.com/jacekradko)! - Add AI configuration management via `neo config` command
  - Add `neo config set ai.apiKey` to securely store Anthropic API key
  - Store secrets in separate `~/.config/neo/secrets.json` with restricted permissions (0600)
  - API key is masked in output (shows only last 4 characters)
  - Support interactive masked input when setting API key without value
  - Add `ai` section to config with `enabled` and `model` settings
  - AI service now reads from secrets file first, falls back to ANTHROPIC_API_KEY env var

## 0.14.0

### Minor Changes

- [#72](https://github.com/radkode/neo/pull/72) [`640ea39`](https://github.com/radkode/neo/commit/640ea39950b4bcc4b7d4c837606774401ba37921) Thanks [@jacekradko](https://github.com/jacekradko)! - Add AI-powered commit message generation with `neo git commit --ai`
  - Generates conventional commit messages using Claude API (claude-3-haiku)
  - Analyzes staged diff and repository context (recent commits, branch name)
  - Shows preview with options to commit, edit in wizard, regenerate, or cancel
  - Requires ANTHROPIC_API_KEY environment variable

## 0.13.0

### Minor Changes

- [#71](https://github.com/radkode/neo/pull/71) [`23b4c1b`](https://github.com/radkode/neo/commit/23b4c1bbe14549ab08c9129a2541b70ed4bb45e0) Thanks [@jacekradko](https://github.com/jacekradko)! - Add interactive git stash management commands

  New commands:
  - `neo git stash` - Save changes to stash with interactive naming
  - `neo git stash list` - List stashes with interactive selection
  - `neo git stash show [n]` - Show stash contents with optional diff
  - `neo git stash apply [n]` - Apply stash with conflict detection
  - `neo git stash pop [n]` - Apply and remove stash
  - `neo git stash drop [n]` - Remove stash with confirmation

  Features:
  - Visual stash list with timestamps and branch info
  - Interactive selection for all operations
  - Conflict detection before applying
  - Confirmation prompts for destructive operations
  - Support for untracked files and keep-index options

### Patch Changes

- [#69](https://github.com/radkode/neo/pull/69) [`fd65a4f`](https://github.com/radkode/neo/commit/fd65a4f6b78ca01289059ca7c51a54d0d11d3a4b) Thanks [@jacekradko](https://github.com/jacekradko)! - Refactor ContextDB to use async factory pattern with sync methods
  - Made constructor private, moved initialization to static `create()` factory
  - Converted all DB methods from async to sync (better-sqlite3 is synchronous)
  - Removed unnecessary `ready` promise and `ensureReady()` calls
  - Updated all callers to use sync method signatures

## 0.12.0

### Minor Changes

- [#65](https://github.com/radkode/neo/pull/65) [`73a96b1`](https://github.com/radkode/neo/commit/73a96b1e72f7169fef3a5b6fd241375f14ce98be) Thanks [@jacekradko](https://github.com/jacekradko)! - Implement ILogger interface in logger.ts
  - Logger class now implements the ILogger interface from core/interfaces
  - Added setLevel/getLevel methods for proper log level management
  - Added optional context parameter to debug, info, warn, error, success methods
  - Log messages are now filtered based on the configured log level
  - Maintained backwards compatibility with setVerbose method

- [#67](https://github.com/radkode/neo/pull/67) [`93d8091`](https://github.com/radkode/neo/commit/93d8091f752f9b5b5a9832b3e121a2c559d031eb) Thanks [@jacekradko](https://github.com/jacekradko)! - Adopt Result<T> pattern and shared git error utilities
  - Refactored git/push, git/pull, git/commit, git/branch to return Result<void>
  - Commands now use `success()` and `failure()` helpers from core/errors
  - Replaced direct `process.exit()` calls with Result-based error handling
  - Added shared `git-errors.ts` utility module with GitError class and error detection
  - Extracted common error patterns (not a repo, auth, network, conflicts, etc.)
  - Consistent error reporting with suggestions across all git commands

## 0.11.6

### Patch Changes

- [#60](https://github.com/radkode/neo/pull/60) [`a3381ad`](https://github.com/radkode/neo/commit/a3381ad7ccffb4260201b0c49c67b6e8778ee7d6) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: remove provenance for private repository compatibility

## 0.11.5

### Patch Changes

- [#58](https://github.com/radkode/neo/pull/58) [`96209d1`](https://github.com/radkode/neo/commit/96209d160f3ae959ad50f173a1711fbba8ec342c) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: create .npmrc file explicitly for npm authentication in CI

- [#58](https://github.com/radkode/neo/pull/58) [`96209d1`](https://github.com/radkode/neo/commit/96209d160f3ae959ad50f173a1711fbba8ec342c) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: configure pnpm for npm registry authentication in CI

## 0.11.4

### Patch Changes

- [#56](https://github.com/radkode/neo/pull/56) [`281d772`](https://github.com/radkode/neo/commit/281d7728c9232222c12cb0917a03d3d7ff1e36e5) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: configure pnpm for npm registry authentication in CI

## 0.11.3

### Patch Changes

- [#54](https://github.com/radkode/neo/pull/54) [`b47d77c`](https://github.com/radkode/neo/commit/b47d77c416d2b4efe45710b868e774d6716baa3f) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: use NODE_AUTH_TOKEN for npm authentication in CI

- [#54](https://github.com/radkode/neo/pull/54) [`b47d77c`](https://github.com/radkode/neo/commit/b47d77c416d2b4efe45710b868e774d6716baa3f) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: configure npm trusted publishing with provenance

## 0.11.2

### Patch Changes

- [#52](https://github.com/radkode/neo/pull/52) [`d22c1c5`](https://github.com/radkode/neo/commit/d22c1c50859a6bf099995b197996f43ba701cfd3) Thanks [@jacekradko](https://github.com/jacekradko)! - fix: configure npm trusted publishing with provenance

## 0.11.1

### Patch Changes

- [#50](https://github.com/radkode/neo/pull/50) [`b265714`](https://github.com/radkode/neo/commit/b265714ebfab8c15d115914a6276a1853600f108) Thanks [@jacekradko](https://github.com/jacekradko)! - Fix GitHub Actions release workflow permissions to allow Changesets to create release PRs

- [#49](https://github.com/radkode/neo/pull/49) [`06e7f8a`](https://github.com/radkode/neo/commit/06e7f8ab89f915a6bf85154b2d0d9139f0dcb818) Thanks [@jacekradko](https://github.com/jacekradko)! - Configured NPM trusted publisher for automated releases

## 0.11.0

### Minor Changes

- [#46](https://github.com/radkode/neo/pull/46) [`bc3c4dc`](https://github.com/radkode/neo/commit/bc3c4dcfdad28f1fc8b53d7a71b3a5a2356f4a4c) Thanks [@jacekradko](https://github.com/jacekradko)! - Initialize beads functionality

### Patch Changes

- [#48](https://github.com/radkode/neo/pull/48) [`aa2583d`](https://github.com/radkode/neo/commit/aa2583d17fda1c169c6ffd0b9c1e18bbc592518e) Thanks [@jacekradko](https://github.com/jacekradko)! - Streamline CLI output styling with reduced color palette
  - Reduce color palette from 7 to 4 semantic colors (primary, success, error, muted)
  - Simplify banner gradient from 6 colors to 3 blue shades
  - Update info() and step() to use muted gray for cleaner output
  - Unify logger to use Colors constant for consistent styling

## 0.10.3

### Patch Changes

- [#44](https://github.com/radkode/neo/pull/44) [`95d6e67`](https://github.com/radkode/neo/commit/95d6e6742cc8f03063eed3cde43f5e75e4c2df3f) Thanks [@jacekradko](https://github.com/jacekradko)! - Fixing an issue with multiple choice prompt

## 0.10.2

### Patch Changes

- [#42](https://github.com/radkode/neo/pull/42) [`41de441`](https://github.com/radkode/neo/commit/41de441086afa5f9c989a541038bc0ad20606fea) Thanks [@jacekradko](https://github.com/jacekradko)! - Fix Select component

## 0.10.1

### Patch Changes

- [#40](https://github.com/radkode/neo/pull/40) [`b5d2817`](https://github.com/radkode/neo/commit/b5d28173c6b59515f4e129f9e8f0aef28fdb2b8b) Thanks [@jacekradko](https://github.com/jacekradko)! - chore: update dependencies and package manager pin

## 0.10.0

### Minor Changes

- [#39](https://github.com/radkode/neo/pull/39) [`1ec42f7`](https://github.com/radkode/neo/commit/1ec42f7cfe1529c13664b2ef31a930ddb0f05d77) Thanks [@jacekradko](https://github.com/jacekradko)! - Add periodic npm version checks and show upgrade prompt before commands.

### Patch Changes

- [#37](https://github.com/radkode/neo/pull/37) [`cf73dda`](https://github.com/radkode/neo/commit/cf73ddaa78dfc089927fdda5f28a709e37948751) Thanks [@jacekradko](https://github.com/jacekradko)! - Improve git push/pull divergence handling UX and cover flows with tests.

## 0.9.2

### Patch Changes

- [#35](https://github.com/radkode/neo/pull/35) [`f63fabf`](https://github.com/radkode/neo/commit/f63fabf4106157818b615114ed4085d88e9199ea) Thanks [@jacekradko](https://github.com/jacekradko)! - Fix Node.js v22 compatibility:
  - Update JSON import syntax from `assert` to `with`
  - Replace `sqlite3` with `better-sqlite3` for better native binary support and reliability
  - `better-sqlite3` provides prebuilt binaries for all major platforms and Node.js versions

## 0.9.1

### Patch Changes

- [#33](https://github.com/radkode/neo/pull/33) [`c6f1970`](https://github.com/radkode/neo/commit/c6f1970ad2931684e4008ef2275820c3dcfb75f7) Thanks [@jacekradko](https://github.com/jacekradko)! - Fix Node.js v22 compatibility by updating JSON import syntax from `assert` to `with`

## 0.9.0

### Minor Changes

- [#29](https://github.com/radkode/neo/pull/29) [`59146b3`](https://github.com/radkode/neo/commit/59146b326085752b37727020c9abba307d4b2f8e) Thanks [@jacekradko](https://github.com/jacekradko)! - Adding agent command

- [#32](https://github.com/radkode/neo/pull/32) [`2554cf7`](https://github.com/radkode/neo/commit/2554cf7c78d9273f388f60073cc5a70cd04c0d4e) Thanks [@jacekradko](https://github.com/jacekradko)! - Added git commit command

## 0.8.0

### Minor Changes

- [#27](https://github.com/radkode/neo/pull/27) [`3695a9d`](https://github.com/radkode/neo/commit/3695a9d8e26d3c782eed4ed5e90c3f2f879cf34c) Thanks [@jacekradko](https://github.com/jacekradko)! - Added git branch command

## 0.7.0

### Minor Changes

- [#26](https://github.com/radkode/neo/pull/26) [`e3bda6d`](https://github.com/radkode/neo/commit/e3bda6d494fd3f07d16a6af1edeb405d5f15912e) Thanks [@jacekradko](https://github.com/jacekradko)! - Enhancing the git pull command to handle common scenarios

- [#24](https://github.com/radkode/neo/pull/24) [`adc6564`](https://github.com/radkode/neo/commit/adc656444b6ba767e21fa4186818f241b64b0212) Thanks [@jacekradko](https://github.com/jacekradko)! - Added zod validation for command inputs

## 0.6.1

### Patch Changes

- [#22](https://github.com/radkode/neo/pull/22) [`1dda7c7`](https://github.com/radkode/neo/commit/1dda7c784614e7b629b482acdc6206e45ff4c494) Thanks [@jacekradko](https://github.com/jacekradko)! - Better handling of missing branches in git pull

## 0.6.0

### Minor Changes

- [#17](https://github.com/radkode/neo/pull/17) [`9192cc5`](https://github.com/radkode/neo/commit/9192cc518ee13628621be50d8938394aedf6338c) Thanks [@jacekradko](https://github.com/jacekradko)! - Update config command and add slim banner

- [#20](https://github.com/radkode/neo/pull/20) [`55aa05d`](https://github.com/radkode/neo/commit/55aa05dd21658f5362e531aa9ec7ac8f9482b220) Thanks [@jacekradko](https://github.com/jacekradko)! - Improve banner look and feel

- [#21](https://github.com/radkode/neo/pull/21) [`69a402f`](https://github.com/radkode/neo/commit/69a402fd4177a1246b9da94ce1f3d0dce4c635b6) Thanks [@jacekradko](https://github.com/jacekradko)! - Streamline the CLI UI output

## 0.5.0

### Minor Changes

- [#15](https://github.com/radkode/neo/pull/15) [`b562b0e`](https://github.com/radkode/neo/commit/b562b0e9bec35e4330dba6e666ab257e3f66f613) Thanks [@jacekradko](https://github.com/jacekradko)! - Added alias command to set up local dev environment

## 0.4.0

### Minor Changes

- [#13](https://github.com/radkode/neo/pull/13) [`c8c4fa3`](https://github.com/radkode/neo/commit/c8c4fa3aec4339b5fa519de0b425986ba12965a3) Thanks [@jacekradko](https://github.com/jacekradko)! - Adding Update and Git Pull commands

## 0.3.0

### Minor Changes

- [#6](https://github.com/radkode/neo/pull/6) [`873efe5`](https://github.com/radkode/neo/commit/873efe5494413a58c85b2677e428d0e2c00dfb22) Thanks [@jacekradko](https://github.com/jacekradko)! - Implement git push internals

## 0.2.0

### Minor Changes

- # Neo CLI Framework Improvements

  ## 🚀 Enhanced Git Push Command
  - **Improved main branch protection**: Replaced hard blocking with user-friendly confirmation prompts
  - **Better UX**: Interactive confirmation using inquirer with helpful guidance
  - **Graceful handling**: Exit with success code when user cancels instead of error code
  - **Preserved safety**: Still encourages best practices while allowing flexibility for legitimate cases

  ## 🔧 Build & Development Experience
  - **Fixed path aliases**: Added tsc-alias integration to properly resolve TypeScript path aliases in compiled output
  - **Better CLI behavior**: Running `neo` without arguments now shows help with success exit code instead of error
  - **Improved version handling**: Fixed version command to exit cleanly without errors
  - **Smart banner display**: Banner now hidden for help/version commands for cleaner output

  ## 📦 Changeset Integration
  - **Added changeset support**: Integrated @changesets/cli for semantic versioning
  - **GitHub integration**: Configured changelog generation with GitHub links
  - **Release workflow**: Added comprehensive scripts for version management and publishing
  - **Documentation**: Updated README with detailed versioning and release workflow instructions

  This release significantly improves the developer experience with better error handling, cleaner output, and a more flexible git workflow while maintaining safety best practices.
