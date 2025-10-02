# @radkode/neo

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
