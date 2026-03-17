import { relative, resolve } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { getBarrelPath, getFeature } from '../files/file-discovery.js';
import type { CustomRule } from './custom-rules.js';

function isBarrelFile(
  filePath: string,
  feature: string,
  config: FeatureBoundariesConfig,
): boolean {
  const featureDir = resolve(config.featuresDir, feature);
  const relativePath = relative(featureDir, filePath);
  return config.barrelFiles.includes(relativePath);
}

export const featureBoundaryRule: CustomRule = {
  name: 'cross-feature-imports',
  check({ graph, config, emitViolation }) {
    for (const edge of graph.edges) {
      const fromPath =
        graph.normalizedToOriginalPath?.get(edge.from) || edge.from;
      const toPath = graph.normalizedToOriginalPath?.get(edge.to) || edge.to;

      const fromFeature = getFeature(fromPath, config);
      const toFeature = getFeature(toPath, config);

      // Rule 1: No feature imports from non-domain directories
      if (fromFeature && !toFeature) {
        emitViolation({
          code: 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
          file: fromPath,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: `Feature files cannot import from non-domain directories. Import "${edge.importInfo.specifier}" resolves to "${toPath}" which is outside the features directory. Feature files should only import from within features or feature barrel files.`,
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
      if (!isBarrelFile(toPath, toFeature, config)) {
        const expectedBarrelPath = getBarrelPath(toFeature, config);

        emitViolation({
          code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          file: fromPath,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: `Cross-feature deep import not allowed. Import "${edge.importInfo.specifier}" resolves to "${toPath}" but should import from feature barrel "${expectedBarrelPath}" instead.`,
        });
      }
    }
  },
};
