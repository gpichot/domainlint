import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';

/** A discovered source file (discovery itself is done by the native addon). */
export interface FileInfo {
  path: string;
  relativePath: string;
  feature: string | null;
  isBarrel: boolean;
  /** Non-blank line count, when already known (computed by the native core). */
  lineCount?: number;
}

// `path.resolve` + `path.relative` dominate `getFeature` (called for every file
// and edge endpoint): cache the normalized prefix and take a string fast path.
const featuresPrefixCache = new Map<string, string>();

function featuresPrefix(featuresDir: string): string {
  let prefix = featuresPrefixCache.get(featuresDir);
  if (prefix === undefined) {
    const normalized = resolve(featuresDir);
    prefix = normalized.endsWith(sep) ? normalized : normalized + sep;
    featuresPrefixCache.set(featuresDir, prefix);
  }
  return prefix;
}

export function getFeature(
  filePath: string,
  config: FeatureBoundariesConfig,
): string | null {
  const { featuresDir } = config;

  // Fast path: a path already below the (normalized) features dir, without
  // dot segments, so `relative` would just strip the prefix.
  const prefix = featuresPrefix(featuresDir);
  if (filePath.startsWith(prefix)) {
    const rest = filePath.slice(prefix.length);
    if (!rest.includes('..') && !rest.includes('/.') && !rest.includes('\\.')) {
      const end = rest.search(/[\\/]/);
      const first = end === -1 ? rest : rest.slice(0, end);
      if (first !== '' && first !== '.') return first;
    }
  }

  const relativePath = relative(featuresDir, filePath);

  // Check if file is inside features directory (`relative` uses the platform
  // separator, and returns an absolute path across Windows drives)
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  // Extract feature name (first directory segment)
  const pathParts = relativePath.split(/[\\/]/);
  return pathParts[0] || null;
}

export function getBarrelPath(
  feature: string,
  config: FeatureBoundariesConfig,
): string {
  const { featuresDir, barrelFiles } = config;
  const barrelFile = barrelFiles[0]; // Use first barrel file as default
  return resolve(featuresDir, feature, barrelFile);
}
