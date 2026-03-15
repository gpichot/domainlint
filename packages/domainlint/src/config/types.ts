export type RuleName = 'import-cycles' | 'cross-feature-imports';
export type RuleLevel = 'off' | 'warn' | 'error';

export interface RuleOverride {
  rules?: Partial<Record<RuleName, RuleLevel>>;
}

export interface FeatureBoundariesConfig {
  rootDir: string;
  srcDir: string;
  featuresDir: string;
  barrelFiles: string[];
  extensions: string[];
  tsconfigPath: string;
  exclude: string[];
  includeDynamicImports: boolean;
  overrides?: {
    global?: RuleOverride;
    features?: Record<string, RuleOverride>;
  };
}

export interface ConfigOverrides {
  srcDir?: string;
  featuresDir?: string;
  tsconfigPath?: string;
  includeDynamicImports?: boolean;
}

export interface ConfigFile {
  rootDir?: string;
  srcDir?: string;
  featuresDir?: string;
  barrelFiles?: string[];
  extensions?: string[];
  tsconfigPath?: string;
  exclude?: string[];
  includeDynamicImports?: boolean;
  overrides?: {
    global?: RuleOverride;
    features?: Record<string, RuleOverride>;
  };
}
