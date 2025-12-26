import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { getBarrelPath, getFeature } from '../files/file-discovery.js';
import type { DependencyGraph, Violation } from '../graph/types.js';

export function validateFeatureBoundaries(
  graph: DependencyGraph,
  files: FileInfo[],
  config: FeatureBoundariesConfig,
): Violation[] {
  const violations: Violation[] = [];
  const fileInfoMap = new Map<string, FileInfo>();

  // Create a map for quick file info lookup using both normalized and original paths
  for (const file of files) {
    fileInfoMap.set(file.path, file);
    // Also map by normalized path if we have the normalization mapping
    if (graph.normalizedToOriginalPath) {
      // Find the normalized path for this original path
      for (const [normalized, original] of graph.normalizedToOriginalPath) {
        if (original === file.path) {
          fileInfoMap.set(normalized, file);
          break;
        }
      }
    }
  }

  // Check each edge for violations
  for (const edge of graph.edges) {
    const fromFile = fileInfoMap.get(edge.from);
    const toFile = fileInfoMap.get(edge.to);

    if (!fromFile || !toFile) {
      continue;
    }

    const fromFeature = fromFile.feature;
    const toFeature = toFile.feature;

    // Rule 1: No feature imports from non-domain directories
    if (fromFeature && !toFeature) {
      // File is in a feature but importing from outside features directory
      const originalFromFile =
        graph.normalizedToOriginalPath?.get(edge.from) || edge.from;
      const originalToFile =
        graph.normalizedToOriginalPath?.get(edge.to) || edge.to;

      violations.push({
        code: 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
        file: originalFromFile,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: `Feature files cannot import from non-domain directories. Import "${edge.importInfo.specifier}" resolves to "${originalToFile}" which is outside the features directory. Feature files should only import from within features or feature barrel files.`,
      });
      continue;
    }

    // Skip if target is not in a feature (for the cross-feature rule)
    if (!toFeature) {
      continue;
    }

    // Skip if same feature (same-feature deep imports are allowed)
    if (fromFeature === toFeature) {
      continue;
    }

    // Rule 2: Cross-feature import detected - must use barrel
    if (!toFile.isBarrel) {
      const expectedBarrelPath = getBarrelPath(toFeature, config);

      const originalFromFile =
        graph.normalizedToOriginalPath?.get(edge.from) || edge.from;
      const originalToFile =
        graph.normalizedToOriginalPath?.get(edge.to) || edge.to;

      violations.push({
        code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
        file: originalFromFile,
        line: edge.importInfo.line,
        col: edge.importInfo.col,
        message: `Cross-feature deep import not allowed. Import "${edge.importInfo.specifier}" resolves to "${originalToFile}" but should import from feature barrel "${expectedBarrelPath}" instead.`,
      });
    }
  }

  return violations;
}
