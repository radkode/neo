export interface BaseOptions {
  verbose?: boolean;
  config?: string;
  color?: boolean;
  banner?: boolean;
}

export interface InitOptions extends BaseOptions {
  template: string;
  skipInstall?: boolean;
  force?: boolean;
}

export interface GitPushOptions extends BaseOptions {
  dryRun?: boolean;
  force?: boolean;
  setUpstream?: string;
  tags?: boolean;
}
