export interface BaseOptions {
  verbose?: boolean;
  config?: string;
  color?: boolean;
  banner?: boolean;
}

export interface InitOptions extends BaseOptions {
  force?: boolean;
  skipInstall?: boolean;
}

export interface GitPushOptions extends BaseOptions {
  dryRun?: boolean;
  force?: boolean;
  setUpstream?: string;
  tags?: boolean;
}

export interface GitPullOptions extends BaseOptions {
  rebase?: boolean;
  noRebase?: boolean;
}

export interface UpdateOptions extends BaseOptions {
  checkOnly?: boolean;
  force?: boolean;
}

export interface NpmPackageInfo {
  name: string;
  version: string;
  'dist-tags': {
    latest: string;
    [key: string]: string;
  };
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
