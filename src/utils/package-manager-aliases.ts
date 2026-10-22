/**
 * Opt-in shell aliases that route a package manager through neo's scoped-env wrapper,
 * so it loads the repository-local `.env.<tool>.local` without exporting it to the shell.
 */
export const PACKAGE_MANAGER_ALIASES = Object.freeze({
  pnpm: 'neo --quiet pnpm --',
  yarn: 'neo --quiet yarn --',
});

export type PackageManagerAlias = keyof typeof PACKAGE_MANAGER_ALIASES;

export const PACKAGE_MANAGER_ALIAS_NAMES = Object.keys(
  PACKAGE_MANAGER_ALIASES
) as PackageManagerAlias[];
