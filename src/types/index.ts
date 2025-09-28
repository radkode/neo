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

export interface BuildOptions extends BaseOptions {
  watch?: boolean;
  minify?: boolean;
  sourceMaps?: boolean;
  output: string;
}

export interface DeployOptions extends BaseOptions {
  environment?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
  force?: boolean;
}

export interface GitPushOptions extends BaseOptions {
  dryRun?: boolean;
  force?: boolean;
  setUpstream?: string;
  tags?: boolean;
}
