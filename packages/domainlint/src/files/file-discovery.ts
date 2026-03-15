import { relative, resolve } from 'node:path';
import { glob as defaultGlob } from 'glob';
import { minimatch } from 'minimatch';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { normalizePath } from '../normalize-path.js';

export interface FileInfo {
  path: string;
  relativePath: string;
  feature: string | null;
  isBarrel: boolean;
}

export type GlobFunction = (
  pattern: string,
  options: { cwd: string; absolute: boolean; nodir: boolean },
) => Promise<string[]>;

export async function discoverFiles(
  config: FeatureBoundariesConfig,
  glob: GlobFunction = defaultGlob,
): Promise<FileInfo[]> {
  const { srcDir, extensions, exclude } = config;

  // Create glob pattern for all files with configured extensions
  const patterns = extensions.map((ext) => `**/*${ext}`);

  // Find all files in source directory
  const allFilesSet = new Set<string>();
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: srcDir,
      absolute: true,
      nodir: true,
    });
    for (const file of files) {
      allFilesSet.add(file);
    }
  }
  const allFiles = Array.from(allFilesSet);

  // Filter out excluded files
  const filteredFiles = allFiles.filter((file) => {
    const relativePath = normalizePath(relative(srcDir, file));
    return !exclude.some((pattern) => minimatch(relativePath, pattern));
  });

  // Convert to FileInfo objects
  return filteredFiles.map((file) => {
    const relativePath = normalizePath(relative(config.rootDir, file));
    const feature = getFeature(file, config);
    const isBarrel = checkIsBarrel(file, feature, config);

    return {
      path: file,
      relativePath,
      feature,
      isBarrel,
    };
  });
}

export function getFeature(
  filePath: string,
  config: FeatureBoundariesConfig,
): string | null {
  const { featuresDir } = config;
  const relativePath = normalizePath(relative(featuresDir, filePath));

  // Check if file is inside features directory
  if (relativePath.startsWith('../') || relativePath.startsWith('/')) {
    return null;
  }

  // Extract feature name (first directory segment)
  const pathParts = relativePath.split('/');
  return pathParts[0] || null;
}

function checkIsBarrel(
  filePath: string,
  feature: string | null,
  config: FeatureBoundariesConfig,
): boolean {
  if (!feature) {
    return false;
  }

  const { featuresDir, barrelFiles } = config;
  const featureDir = resolve(featuresDir, feature);
  const rel = normalizePath(relative(featureDir, filePath));

  return barrelFiles.includes(rel);
}

export function getBarrelPath(
  feature: string,
  config: FeatureBoundariesConfig,
): string {
  const { featuresDir, barrelFiles } = config;
  const barrelFile = barrelFiles[0]; // Use first barrel file as default
  return resolve(featuresDir, feature, barrelFile);
}
