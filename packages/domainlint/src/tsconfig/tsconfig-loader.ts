import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'jsonc-parser';
import type { ResolvedTsConfig, TsConfig } from './types.js';

const execAsync = promisify(exec);

export async function loadTsConfig(
  tsconfigPath: string,
): Promise<ResolvedTsConfig> {
  const resolvedTsConfig = await loadTsConfigWithFallback(tsconfigPath);
  const rootDir = dirname(tsconfigPath);

  // TypeScript defaults baseUrl to "." when paths is defined but baseUrl is not
  const baseUrl =
    resolvedTsConfig.compilerOptions?.baseUrl ??
    (resolvedTsConfig.compilerOptions?.paths ? '.' : undefined);

  return {
    baseUrl,
    paths: resolvedTsConfig.compilerOptions?.paths,
    rootDir,
  };
}

async function loadTsConfigWithFallback(
  tsconfigPath: string,
): Promise<TsConfig> {
  try {
    const { stdout } = await execAsync(
      `npx tsc --showConfig --project "${tsconfigPath}"`,
    );
    return JSON.parse(stdout) as TsConfig;
  } catch {
    return await loadTsConfigWithExtends(tsconfigPath);
  }
}

async function loadTsConfigWithExtends(
  tsconfigPath: string,
): Promise<TsConfig> {
  let configContent: string;
  try {
    configContent = await readFile(tsconfigPath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read tsconfig.json at ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let config: TsConfig;
  try {
    config = parse(configContent) as TsConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse tsconfig.json at ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const extendsValue = config.extends;
  if (!extendsValue) {
    return config;
  }

  // extends can be a string or an array (TypeScript 5.0+)
  const extendsArray = Array.isArray(extendsValue)
    ? extendsValue
    : [extendsValue];

  // Resolve each base config left-to-right, each overriding the previous
  let merged: TsConfig = {};
  for (const ext of extendsArray) {
    const baseConfigPath = resolveExtendsPath(ext, dirname(tsconfigPath));
    const baseConfig = await loadTsConfigWithExtends(baseConfigPath);
    merged = mergeConfigs(merged, baseConfig);
  }

  // Current config overrides the merged base (strip extends to avoid re-processing)
  const { extends: _extends, ...configWithoutExtends } = config;
  return mergeConfigs(merged, configWithoutExtends);
}

function resolveExtendsPath(extendsValue: string, configDir: string): string {
  // Relative or absolute path
  if (extendsValue.startsWith('.') || isAbsolute(extendsValue)) {
    const resolved = resolve(configDir, extendsValue);
    return resolved.endsWith('.json') ? resolved : `${resolved}.json`;
  }

  // node_modules package resolution
  // e.g. "tsconfig-strict" → node_modules/tsconfig-strict/tsconfig.json
  // e.g. "@scope/pkg/base" → node_modules/@scope/pkg/base.json
  const isScoped = extendsValue.startsWith('@');
  const parts = extendsValue.split('/');
  const pkgName = isScoped ? `${parts[0]}/${parts[1]}` : parts[0];
  const subPath = isScoped
    ? parts.slice(2).join('/')
    : parts.slice(1).join('/');

  const resolved = subPath
    ? resolve(configDir, 'node_modules', pkgName, subPath)
    : resolve(configDir, 'node_modules', pkgName, 'tsconfig.json');

  return resolved.endsWith('.json') ? resolved : `${resolved}.json`;
}

function mergeConfigs(base: TsConfig, override: TsConfig): TsConfig {
  const basePaths = base.compilerOptions?.paths;
  const overridePaths = override.compilerOptions?.paths;
  const mergedPaths =
    basePaths || overridePaths ? { ...basePaths, ...overridePaths } : undefined;

  return {
    ...base,
    ...override,
    compilerOptions: {
      ...base.compilerOptions,
      ...override.compilerOptions,
      ...(mergedPaths ? { paths: mergedPaths } : {}),
    },
  };
}

export function resolvePathMapping(
  specifier: string,
  paths: Record<string, string[]> | undefined,
  baseUrl: string | undefined,
  rootDir: string,
): string[] {
  if (!paths || !baseUrl) {
    return [];
  }

  const resolvedBaseUrl = resolve(rootDir, baseUrl);
  const candidates: string[] = [];

  for (const [pattern, mappings] of Object.entries(paths)) {
    const match = matchPattern(specifier, pattern);
    if (match !== null) {
      for (const mapping of mappings) {
        const resolvedMapping = mapping.replace('*', match);
        candidates.push(resolve(resolvedBaseUrl, resolvedMapping));
      }
    }
  }

  return candidates;
}

function matchPattern(specifier: string, pattern: string): string | null {
  const starIndex = pattern.indexOf('*');

  if (starIndex === -1) {
    return specifier === pattern ? '' : null;
  }

  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);

  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }

  return specifier.slice(prefix.length, specifier.length - suffix.length);
}
