import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  // Try using tsc --showConfig first for full resolution including extends
  try {
    const { stdout } = await execAsync(
      `tsc --showConfig --project "${tsconfigPath}"`,
    );
    return JSON.parse(stdout) as TsConfig;
  } catch {
    // Fallback to manual parsing for cases where tsc is not available or fails
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

  // Handle extends
  if (config.extends) {
    const basePath = resolve(dirname(tsconfigPath), config.extends);
    let baseConfigPath = basePath;

    // Handle extends without .json extension
    if (!baseConfigPath.endsWith('.json')) {
      baseConfigPath += '.json';
    }

    const baseConfig = await loadTsConfigWithExtends(baseConfigPath);

    // Merge configurations
    return {
      ...baseConfig,
      ...config,
      compilerOptions: {
        ...baseConfig.compilerOptions,
        ...config.compilerOptions,
        paths: {
          ...baseConfig.compilerOptions?.paths,
          ...config.compilerOptions?.paths,
        },
      },
    };
  }

  return config;
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
