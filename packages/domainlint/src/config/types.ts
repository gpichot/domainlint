import { z } from 'zod';

export type RuleName =
  | 'import-cycles'
  | 'cross-feature-imports'
  | 'no-external-feature-imports';
export type RuleLevel = 'off' | 'warn' | 'error';

export interface RuleOverride {
  rules?: Partial<Record<RuleName, RuleLevel>>;
}

export interface PackageRule {
  /** Glob pattern matching source package paths (relative to workspace root) */
  from: string;
  /** Glob patterns for packages that `from` is not allowed to import */
  deny: string[];
}

const ruleOverrideSchema = z.object({
  rules: z
    .object({
      'import-cycles': z.enum(['off', 'warn', 'error']).optional(),
      'cross-feature-imports': z.enum(['off', 'warn', 'error']).optional(),
      'no-external-feature-imports': z
        .enum(['off', 'warn', 'error'])
        .optional(),
    })
    .optional(),
});

const packageRuleSchema = z.object({
  from: z.string().min(1, '"from" must be a non-empty string'),
  deny: z
    .array(z.string().min(1, '"deny" entries must be non-empty strings'))
    .min(1, '"deny" must have at least one entry'),
});

export const configFileSchema = z.object({
  rootDir: z.string().optional(),
  srcDir: z.string().optional(),
  featuresDir: z.string().optional(),
  barrelFiles: z
    .array(z.string().min(1, '"barrelFiles" entries must be non-empty strings'))
    .optional(),
  extensions: z
    .array(
      z.string().startsWith('.', '"extensions" entries must start with \'.\''),
    )
    .optional(),
  tsconfigPath: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  includeDynamicImports: z.boolean().optional(),
  rulesFile: z.string().optional(),
  overrides: z
    .object({
      global: ruleOverrideSchema.optional(),
      features: z.record(z.string(), ruleOverrideSchema).optional(),
    })
    .optional(),
  packageRules: z.array(packageRuleSchema).optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

export interface FeatureBoundariesConfig {
  rootDir: string;
  srcDir: string;
  featuresDir: string;
  barrelFiles: string[];
  extensions: string[];
  tsconfigPath: string;
  exclude: string[];
  includeDynamicImports: boolean;
  rulesFile?: string;
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
