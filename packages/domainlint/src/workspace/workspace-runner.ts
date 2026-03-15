import { loadConfig } from '../config/config-loader.js';
import type { ConfigOverrides } from '../config/types.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
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

  const totalTimeMs = Date.now() - startTime;
  const totalFileCount = packageResults
    .filter((r) => !r.skipped)
    .reduce((sum, r) => sum + r.result.fileCount, 0);
  const hasViolations = packageResults.some(
    (r) => !r.skipped && r.result.violations.length > 0,
  );

  return {
    root: workspace.root,
    type: workspace.type,
    packageResults,
    totalTimeMs,
    totalFileCount,
    hasViolations,
  };
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
