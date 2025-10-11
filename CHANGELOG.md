# @radkode/neo

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
