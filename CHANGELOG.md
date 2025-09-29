# @radkode/neo

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
