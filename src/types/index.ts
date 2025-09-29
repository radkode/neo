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
