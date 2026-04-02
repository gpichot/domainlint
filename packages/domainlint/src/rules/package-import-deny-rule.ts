import { minimatch } from 'minimatch';
import type { WorkspaceRule } from './workspace-rules.js';

/**
 * Built-in workspace rule that enforces `packageRules` deny lists.
 *
 * For each cross-package import edge, checks if the source package
 * matches a `from` glob and the target package matches a `deny` glob.
 */
export const packageImportDenyRule: WorkspaceRule = {
  name: 'package-imports',
  check({ edges, packageRules, emitViolation }) {
    if (packageRules.length === 0) return;

    for (const edge of edges) {
      const applicableRules = packageRules.filter((rule) =>
        minimatch(edge.fromPackage, rule.from),
      );

      for (const rule of applicableRules) {
        const isDenied = rule.deny.some((denyPattern) =>
          minimatch(edge.toPackage, denyPattern),
        );

        if (isDenied) {
          emitViolation({
            code: 'noPackageImport',
            file: edge.file,
            line: edge.line,
            col: edge.col,
            message: `Package "${edge.fromPackage}" is not allowed to import from "${edge.toPackage}" (${edge.specifier})`,
          });
          break;
        }
      }
    }
  },
};
