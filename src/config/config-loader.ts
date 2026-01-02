import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import type {
  ConfigFile,
  ConfigOverrides,
  FeatureBoundariesConfig,
} from './types.js';

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
  let fileConfig: ConfigFile = {};

  // Try to load config file
  if (configFilePath) {
    try {
      const configContent = await readFile(
        resolve(rootDir, configFilePath),
        'utf-8',
      );
      fileConfig = parse(configContent) as ConfigFile;
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
        fileConfig = parse(configContent) as ConfigFile;
        break;
      } catch {
        // Continue to next config file
      }
    }
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
    overrides: fileConfig.overrides ?? DEFAULT_CONFIG.overrides,
  };

  // Resolve relative paths
  config.srcDir = resolve(rootDir, config.srcDir);
  config.featuresDir = resolve(rootDir, config.featuresDir);
  config.tsconfigPath = resolve(rootDir, config.tsconfigPath);

  return config;
}
