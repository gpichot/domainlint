import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { ZodError } from 'zod';
import type { ConfigOverrides, FeatureBoundariesConfig } from './types.js';
import { configFileSchema } from './types.js';

const DEFAULT_CONFIG: FeatureBoundariesConfig = {
  rootDir: '.',
  srcDir: 'src',
  featuresDir: 'src/features',
  barrelFiles: ['index.ts'],
  extensions: ['.ts', '.tsx', '.d.ts'],
  tsconfigPath: './tsconfig.json',
  exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  includeDynamicImports: false,
  overrides: {},
};

export async function loadConfig(
  projectPath: string,
  configFilePath?: string,
  overrides: ConfigOverrides = {},
): Promise<FeatureBoundariesConfig> {
  const rootDir = resolve(projectPath);
  let rawFileConfig: unknown = {};

  // Try to load config file
  if (configFilePath) {
    try {
      const configContent = await readFile(
        resolve(rootDir, configFilePath),
        'utf-8',
      );
      rawFileConfig = parse(configContent);
    } catch (error) {
      throw new Error(
        `Failed to load config file ${configFilePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // Try default config file names
    const defaultConfigFiles = ['domainlint.json', '.domainlint.json'];
    for (const configFile of defaultConfigFiles) {
      try {
        const configPath = join(rootDir, configFile);
        const configContent = await readFile(configPath, 'utf-8');
        rawFileConfig = parse(configContent);
        break;
      } catch {
        // Continue to next config file
      }
    }
  }

  // Validate config file shape with zod
  let fileConfig: ReturnType<typeof configFileSchema.parse>;
  try {
    fileConfig = configFileSchema.parse(rawFileConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.issues
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      throw new Error(`Invalid config:\n${messages}`);
    }
    throw error;
  }

  // Merge configurations with priority: overrides > fileConfig > defaults
  const config: FeatureBoundariesConfig = {
    rootDir,
    srcDir: overrides.srcDir ?? fileConfig.srcDir ?? DEFAULT_CONFIG.srcDir,
    featuresDir:
      overrides.featuresDir ??
      fileConfig.featuresDir ??
      DEFAULT_CONFIG.featuresDir,
    barrelFiles: fileConfig.barrelFiles ?? DEFAULT_CONFIG.barrelFiles,
    extensions: fileConfig.extensions ?? DEFAULT_CONFIG.extensions,
    tsconfigPath:
      overrides.tsconfigPath ??
      fileConfig.tsconfigPath ??
      DEFAULT_CONFIG.tsconfigPath,
    exclude: fileConfig.exclude ?? DEFAULT_CONFIG.exclude,
    includeDynamicImports:
      overrides.includeDynamicImports ??
      fileConfig.includeDynamicImports ??
      DEFAULT_CONFIG.includeDynamicImports,
    customRules: fileConfig.customRules,
    overrides: fileConfig.overrides ?? DEFAULT_CONFIG.overrides,
  };

  // Resolve relative paths
  config.srcDir = resolve(rootDir, config.srcDir);
  config.featuresDir = resolve(rootDir, config.featuresDir);
  config.tsconfigPath = resolve(rootDir, config.tsconfigPath);

  // Validate that srcDir exists
  try {
    await access(config.srcDir);
  } catch {
    throw new Error(
      `Invalid config: "srcDir" does not exist: ${config.srcDir}`,
    );
  }

  // Validate that featuresDir exists
  try {
    await access(config.featuresDir);
  } catch {
    throw new Error(
      `Invalid config: "featuresDir" does not exist: ${config.featuresDir}`,
    );
  }

  return config;
}
