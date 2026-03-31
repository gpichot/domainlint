import { relative } from 'node:path';
import { minimatch } from 'minimatch';
import type { PackageRule } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import type { ImportInfo } from '../parser/types.js';
import type { WorkspacePackage } from '../workspace/workspace-detector.js';

export interface PackageImportInfo {
  /** Absolute file path of the importing file */
  filePath: string;
  /** Import specifier (e.g., '@myorg/core') */
  specifier: string;
  /** Import details (line, col, etc.) */
  importInfo: ImportInfo;
}

export interface PackageBoundaryContext {
  /** Workspace root path */
  workspaceRoot: string;
  /** All workspace packages */
  packages: WorkspacePackage[];
  /** Package rules from config */
  packageRules: PackageRule[];
  /** Map of file paths to their parsed imports */
  fileImports: Map<string, ImportInfo[]>;
}

/**
 * Validates cross-package imports against package rules.
 *
 * For each file, checks whether its imports to other workspace packages
 * violate any configured deny rules.
 */
export function validatePackageBoundaries(
  context: PackageBoundaryContext,
): Violation[] {
  const { workspaceRoot, packages, packageRules, fileImports } = context;

  if (packageRules.length === 0) {
    return [];
  }

  // Build a map: package name → relative path (from workspace root)
  const packageNameToRelPath = new Map<string, string>();
  for (const pkg of packages) {
    const relPath = relative(workspaceRoot, pkg.path);
    packageNameToRelPath.set(pkg.name, relPath);
  }

  // Build a map: file path → which package it belongs to (relative path)
  // Use pkg.path + '/' to avoid prefix collisions (e.g., core vs core-utils)
  const fileToPackageRelPath = new Map<string, string>();
  for (const pkg of packages) {
    const relPath = relative(workspaceRoot, pkg.path);
    const prefix = `${pkg.path}/`;
    for (const filePath of fileImports.keys()) {
      if (filePath.startsWith(prefix)) {
        fileToPackageRelPath.set(filePath, relPath);
      }
    }
  }

  const violations: Violation[] = [];

  for (const [filePath, imports] of fileImports) {
    const sourcePackageRelPath = fileToPackageRelPath.get(filePath);
    if (!sourcePackageRelPath) continue;

    // Find which rules apply to this source package
    const applicableRules = packageRules.filter((rule) =>
      minimatch(sourcePackageRelPath, rule.from),
    );

    if (applicableRules.length === 0) continue;

    for (const imp of imports) {
      // Check if this import targets a workspace package
      const targetPackageName = findMatchingPackageName(
        imp.specifier,
        packages,
      );
      if (!targetPackageName) continue;

      const targetPackageRelPath = packageNameToRelPath.get(targetPackageName);
      if (!targetPackageRelPath) continue;

      // Skip self-imports
      if (targetPackageRelPath === sourcePackageRelPath) continue;

      // Check against deny rules
      for (const rule of applicableRules) {
        const isDenied = rule.deny.some((denyPattern) =>
          minimatch(targetPackageRelPath, denyPattern),
        );

        if (isDenied) {
          violations.push({
            code: 'ARCH_NO_PACKAGE_IMPORT',
            file: filePath,
            line: imp.line,
            col: imp.col,
            message: `Package "${sourcePackageRelPath}" is not allowed to import from "${targetPackageRelPath}" (${imp.specifier})`,
          });
          break; // One violation per import is enough
        }
      }
    }
  }

  return violations;
}

/**
 * Checks if an import specifier matches a workspace package name.
 * Handles both exact matches (e.g., `@myorg/core`) and subpath imports
 * (e.g., `@myorg/core/utils`).
 */
function findMatchingPackageName(
  specifier: string,
  packages: WorkspacePackage[],
): string | null {
  // Skip relative imports and node builtins
  if (specifier.startsWith('.') || specifier.startsWith('node:')) {
    return null;
  }

  for (const pkg of packages) {
    if (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) {
      return pkg.name;
    }
  }

  return null;
}
