import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'glob';
import { parse as parseJsonc } from 'jsonc-parser';
import { loadConfig } from '../config/config-loader.js';
import type { ConfigOverrides, PackageRule } from '../config/types.js';
import { configFileSchema } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
import { parseFile } from '../parser/swc-parser.js';
import type { ImportInfo } from '../parser/types.js';
import { validatePackageBoundaries } from '../rules/package-boundary-validator.js';
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
  /** Violations from cross-package import rules */
  packageBoundaryViolations?: Violation[];
}

const EMPTY_RESULT: LintResult = {
  violations: [],
  fileCount: 0,
  analysisTimeMs: 0,
  dependencyGraph: { nodes: new Set(), edges: [], adjacencyList: new Map() },
};

/**
 * Runs domainlint on each package in a workspace.
 * Each package is linted independently with its own config.
 * Also checks cross-package import rules if configured.
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

  // Check cross-package import rules
  const packageRules = await loadPackageRules(
    workspace.root,
    options.configPath,
  );
  let packageBoundaryViolations: Violation[] = [];
  if (packageRules.length > 0) {
    packageBoundaryViolations = await checkPackageBoundaries(
      workspace,
      packageRules,
    );
  }

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
 * Loads packageRules from the workspace root domainlint.json.
 */
async function loadPackageRules(
  workspaceRoot: string,
  configPath?: string,
): Promise<PackageRule[]> {
  const configFiles = configPath
    ? [configPath]
    : ['domainlint.json', '.domainlint.json'];

  for (const configFile of configFiles) {
    try {
      const content = await readFile(join(workspaceRoot, configFile), 'utf-8');
      const parsed = parseJsonc(content);
      const validated = configFileSchema.parse(parsed);
      return validated.packageRules ?? [];
    } catch {
      // Continue to next config file
    }
  }

  return [];
}

/**
 * Collects imports from all source files across workspace packages
 * and checks them against package boundary rules.
 */
async function checkPackageBoundaries(
  workspace: WorkspaceInfo,
  packageRules: PackageRule[],
): Promise<Violation[]> {
  const fileImports = new Map<string, ImportInfo[]>();
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

  // Minimal config for parsing (we only need the imports)
  const parseConfig = {
    rootDir: workspace.root,
    srcDir: workspace.root,
    featuresDir: `${workspace.root}/__unused__`,
    barrelFiles: ['index.ts'],
    extensions,
    tsconfigPath: `${workspace.root}/tsconfig.json`,
    exclude: ['**/node_modules/**', '**/dist/**'],
    includeDynamicImports: false,
  };

  for (const pkg of workspace.packages) {
    // Discover source files in the package
    const patterns = extensions.map((ext) => `**/*${ext}`);
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: join(pkg.path, 'src'),
        absolute: true,
        nodir: true,
        ignore: ['**/node_modules/**', '**/dist/**'],
      });
      files.push(...matches);
    }

    // Parse each file for imports
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
  }

  return validatePackageBoundaries({
    workspaceRoot: workspace.root,
    packages: workspace.packages,
    packageRules,
    fileImports,
  });
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

    // Detect srcDir/featuresDir not found as a skip reason
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
