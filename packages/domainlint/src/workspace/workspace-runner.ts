import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { parse as parseJsonc } from 'jsonc-parser';
import { loadConfig } from '../config/config-loader.js';
import type {
  ConfigOverrides,
  PackageImportRestriction,
} from '../config/types.js';
import { configFileSchema } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
import { parseFile } from '../parser/swc-parser.js';
import type { ImportInfo } from '../parser/types.js';
import { packageCycleRule } from '../rules/package-cycle-detector.js';
import { packageImportDenyRule } from '../rules/package-import-deny-rule.js';
import {
  buildPackageImportEdges,
  loadWorkspaceRules,
  runWorkspaceRules,
  type WorkspaceRule,
} from '../rules/workspace-rules.js';
import type { WorkspaceInfo, WorkspacePackage } from './workspace-detector.js';

export interface WorkspacePackageResult {
  /** Package name */
  name: string;
  /** Absolute path to the package root */
  path: string;
  /** Lint result for this package */
  result: LintResult;
  /** Whether linting was skipped (e.g., no srcDir found) */
  skipped: boolean;
  /** Reason for skipping, if applicable */
  skipReason?: string;
}

export interface WorkspaceLintResult {
  /** Workspace root path */
  root: string;
  /** Workspace type */
  type: 'pnpm' | 'npm' | 'yarn';
  /** Results per package */
  packageResults: WorkspacePackageResult[];
  /** Total time in ms */
  totalTimeMs: number;
  /** Total files analyzed across all packages */
  totalFileCount: number;
  /** Whether any violations were found */
  hasViolations: boolean;
  /** Violations from workspace-level rules (cross-package imports, cycles, custom) */
  packageBoundaryViolations?: Violation[];
}

const EMPTY_RESULT: LintResult = {
  violations: [],
  fileCount: 0,
  analysisTimeMs: 0,
  dependencyGraph: { nodes: new Set(), edges: [], adjacencyList: new Map() },
  parseResults: [],
};

/**
 * Runs domainlint on each package in a workspace.
 * Each package is linted independently with its own config.
 * Also runs workspace-level rules (package imports, cycles, custom rules).
 */
export async function runWorkspaceLint(
  workspace: WorkspaceInfo,
  options: {
    configOverrides?: ConfigOverrides;
    configPath?: string;
  } = {},
): Promise<WorkspaceLintResult> {
  const startTime = Date.now();
  const packageResults: WorkspacePackageResult[] = [];

  for (const pkg of workspace.packages) {
    const pkgResult = await lintPackage(pkg, options);
    packageResults.push(pkgResult);
  }

  // Run workspace-level rules using parse results from per-package linting
  const packageBoundaryViolations = await runWorkspaceLevelRules(
    workspace,
    packageResults,
    options.configPath,
  );

  const totalTimeMs = Date.now() - startTime;
  const totalFileCount = packageResults
    .filter((r) => !r.skipped)
    .reduce((sum, r) => sum + r.result.fileCount, 0);
  const hasViolations =
    packageResults.some((r) => !r.skipped && r.result.violations.length > 0) ||
    packageBoundaryViolations.length > 0;

  return {
    root: workspace.root,
    type: workspace.type,
    packageResults,
    totalTimeMs,
    totalFileCount,
    hasViolations,
    packageBoundaryViolations,
  };
}

/**
 * Runs all workspace-level rules: built-in (deny, cycles) and custom.
 * Reuses parse results from per-package linting when available,
 * and parses skipped packages separately so they still participate
 * in cross-package analysis (e.g., cycle detection).
 */
async function runWorkspaceLevelRules(
  workspace: WorkspaceInfo,
  packageResults: WorkspacePackageResult[],
  configPath?: string,
): Promise<Violation[]> {
  const { packageRules, packageRulesFile } = await loadWorkspaceConfig(
    workspace.root,
    configPath,
  );

  // Extract file imports from per-package parse results
  const fileImports = new Map<string, ImportInfo[]>();
  for (const pkgResult of packageResults) {
    if (!pkgResult.skipped) {
      for (const parseResult of pkgResult.result.parseResults) {
        if (parseResult.imports.length > 0) {
          fileImports.set(parseResult.filePath, parseResult.imports);
        }
      }
    }
  }

  // Parse skipped packages so they participate in workspace-level rules
  const skippedPackages = packageResults
    .filter((r) => r.skipped)
    .map((r) => workspace.packages.find((p) => p.path === r.path))
    .filter((p): p is WorkspacePackage => p !== undefined);

  if (skippedPackages.length > 0) {
    const skippedImports = await parseSkippedPackages(skippedPackages);
    for (const [filePath, imports] of skippedImports) {
      fileImports.set(filePath, imports);
    }
  }

  // Build cross-package import edges
  const edges = buildPackageImportEdges(
    workspace.root,
    workspace.packages,
    fileImports,
  );

  // If no edges and no deny rules, skip
  if (edges.length === 0 && packageRules.length === 0) {
    return [];
  }

  // Build package info with relative paths
  const packages = workspace.packages.map((pkg) => ({
    name: pkg.name,
    path: pkg.path,
    relPath: relative(workspace.root, pkg.path),
  }));

  // Assemble rules: built-in + custom
  const builtInRules: WorkspaceRule[] = [
    packageImportDenyRule,
    packageCycleRule,
  ];

  const customRules = await loadWorkspaceRules(
    workspace.root,
    packageRulesFile,
  );

  const allRules = [...builtInRules, ...customRules];

  return runWorkspaceRules(allRules, { packages, edges, packageRules });
}

/**
 * Loads workspace config (packageRules and packageRulesFile) from workspace root.
 */
async function loadWorkspaceConfig(
  workspaceRoot: string,
  configPath?: string,
): Promise<{
  packageRules: PackageImportRestriction[];
  packageRulesFile?: string;
}> {
  const configFiles = configPath
    ? [configPath]
    : ['domainlint.json', '.domainlint.json'];

  for (const configFile of configFiles) {
    try {
      const content = await readFile(join(workspaceRoot, configFile), 'utf-8');
      const parsed = parseJsonc(content);
      const validated = configFileSchema.parse(parsed);
      return {
        packageRules: validated.packageRules ?? [],
        packageRulesFile: validated.packageRulesFile,
      };
    } catch {
      // Continue to next config file
    }
  }

  return { packageRules: [] };
}

/**
 * Parses source files in skipped packages to collect import specifiers.
 * This ensures skipped packages (e.g., missing featuresDir) still participate
 * in workspace-level rules like cycle detection.
 */
async function parseSkippedPackages(
  packages: WorkspacePackage[],
): Promise<Map<string, ImportInfo[]>> {
  const fileImports = new Map<string, ImportInfo[]>();
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

  for (const pkg of packages) {
    // Try common source directories
    const srcDirs = ['src', 'lib', '.'];
    for (const srcDir of srcDirs) {
      const cwd = join(pkg.path, srcDir);
      const patterns = extensions.map((ext) => `**/*${ext}`);
      const files: string[] = [];

      for (const pattern of patterns) {
        try {
          const matches = await glob(pattern, {
            cwd,
            absolute: true,
            nodir: true,
            ignore: ['**/node_modules/**', '**/dist/**'],
          });
          files.push(...matches);
        } catch {
          // Directory doesn't exist, skip
        }
      }

      if (files.length === 0) continue;

      // Minimal config for parsing
      const parseConfig = {
        rootDir: pkg.path,
        srcDir: cwd,
        featuresDir: join(pkg.path, '__unused__'),
        barrelFiles: ['index.ts'],
        extensions,
        tsconfigPath: join(pkg.path, 'tsconfig.json'),
        exclude: ['**/node_modules/**', '**/dist/**'],
        includeDynamicImports: false,
      };

      for (const filePath of files) {
        try {
          const result = await parseFile(filePath, parseConfig);
          if (result.imports.length > 0) {
            fileImports.set(filePath, result.imports);
          }
        } catch {
          // Skip files that fail to parse
        }
      }

      // Found source files in this directory, don't try other srcDirs
      break;
    }
  }

  return fileImports;
}

async function lintPackage(
  pkg: WorkspacePackage,
  options: {
    configOverrides?: ConfigOverrides;
    configPath?: string;
  },
): Promise<WorkspacePackageResult> {
  try {
    const config = await loadConfig(
      pkg.path,
      options.configPath,
      options.configOverrides,
    );

    const linter = new FeatureBoundariesLinter(config);
    const result = await linter.lint();

    return {
      name: pkg.name,
      path: pkg.path,
      result,
      skipped: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const isMissingDir =
      message.includes('"srcDir" does not exist') ||
      message.includes('"featuresDir" does not exist');

    return {
      name: pkg.name,
      path: pkg.path,
      result: { ...EMPTY_RESULT },
      skipped: true,
      skipReason: isMissingDir ? 'No src/features directory found' : message,
    };
  }
}
