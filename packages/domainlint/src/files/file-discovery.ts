import { relative, resolve } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';

/** A discovered source file (discovery itself is done by the native addon). */
export interface FileInfo {
  path: string;
  relativePath: string;
  feature: string | null;
  isBarrel: boolean;
}

export function getFeature(
  filePath: string,
  config: FeatureBoundariesConfig,
): string | null {
  const { featuresDir } = config;
  const relativePath = relative(featuresDir, filePath);

  // Check if file is inside features directory
  if (relativePath.startsWith('../') || relativePath.startsWith('/')) {
    return null;
  }

  // Extract feature name (first directory segment)
  const pathParts = relativePath.split('/');
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
