import type { CustomRule } from './custom-rules.js';

export const featureBoundaryRule: CustomRule = {
  name: 'cross-feature-imports',
  check({ graph, query, emitViolation }) {
    for (const edge of graph.edges) {
      const fromInfo = query.fileInfo(edge.from);
      const toInfo = query.fileInfo(edge.to);

      if (!fromInfo || !toInfo) {
        continue;
      }

      const fromFeature = fromInfo.feature;
      const toFeature = toInfo.feature;

      // Rule: No feature imports from non-domain directories
      if (fromFeature && !toFeature) {
        const originalFrom = query.originalPath(edge.from);
        const originalTo = query.originalPath(edge.to);

        emitViolation({
          code: 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
          file: originalFrom,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: `Feature files cannot import from non-domain directories. Import "${edge.importInfo.specifier}" resolves to "${originalTo}" which is outside the features directory. Feature files should only import from within features or feature barrel files.`,
        });
        continue;
      }

      // Skip if target is not in a feature
      if (!toFeature) {
        continue;
      }

      // Skip same-feature imports (always allowed)
      if (fromFeature === toFeature) {
        continue;
      }

      // Cross-feature import: must use barrel
      if (!toInfo.isBarrel) {
        const expectedBarrelPath = query.barrelPathFor(toFeature);
        const originalFrom = query.originalPath(edge.from);
        const originalTo = query.originalPath(edge.to);

        emitViolation({
          code: 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          file: originalFrom,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          message: `Cross-feature deep import not allowed. Import "${edge.importInfo.specifier}" resolves to "${originalTo}" but should import from feature barrel "${expectedBarrelPath}" instead.`,
        });
      }
    }
  },
};
