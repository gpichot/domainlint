export interface TsConfigCompilerOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  rootDir?: string;
  outDir?: string;
}

export interface TsConfig {
  extends?: string;
  compilerOptions?: TsConfigCompilerOptions;
}

export interface ResolvedTsConfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  rootDir: string;
}
