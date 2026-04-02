import { loadConfig } from '../config/config-loader.js';
import type {
  ConfigOverrides,
  FeatureBoundariesConfig,
} from '../config/types.js';
import { discoverFiles } from '../files/file-discovery.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
import {
  ColoredReporter,
  type FeatureStats,
  type ReporterOptions,
} from '../reporter/colored-reporter.js';
import { detectWorkspace } from '../workspace/workspace-detector.js';
import {
  runWorkspaceLint,
  type WorkspaceLintResult,
} from '../workspace/workspace-runner.js';
import { StatisticsCalculator } from './statistics-calculator.js';
import {
  type ViolationFilterOptions,
  ViolationFilterService,
} from './violation-filter.js';

export interface LintOptions {
  projectPath: string;
  configPath?: string;
  configOverrides?: ConfigOverrides;
  filterOptions?: ViolationFilterOptions;
  reporterOptions?: ReporterOptions;
  includeFeatureStats?: boolean;
}

export interface LintExecutionResult {
  violations: Array<any>;
  allFeatures?: string[];
  featureStats?: FeatureStats[];
  analysisTimeMs: number;
  fileCount: number;
  hasViolations: boolean;
  /** Present when running in workspace mode */
  workspaceResult?: WorkspaceLintResult;
}

export class LintOrchestrator {
  private statisticsCalculator: StatisticsCalculator;
  private violationFilter: ViolationFilterService;

  constructor() {
    this.statisticsCalculator = new StatisticsCalculator();
    this.violationFilter = new ViolationFilterService();
  }

  async executeLinting(options: LintOptions): Promise<LintExecutionResult> {
    // Check for workspace mode
    const workspace = await detectWorkspace(options.projectPath);
    if (workspace && workspace.packages.length > 0) {
      return this.executeWorkspaceLinting(workspace, options);
    }

    return this.executeSingleProjectLinting(options);
  }

  private async executeWorkspaceLinting(
    workspace: import('../workspace/workspace-detector.js').WorkspaceInfo,
    options: LintOptions,
  ): Promise<LintExecutionResult> {
    const workspaceResult = await runWorkspaceLint(workspace, {
      configOverrides: options.configOverrides,
      configPath: options.configPath,
    });

    // Aggregate violations across all packages
    const allViolations = [
      ...workspaceResult.packageResults
        .filter((r) => !r.skipped)
        .flatMap((r) => r.result.violations),
      ...(workspaceResult.packageBoundaryViolations ?? []),
    ];

    return {
      violations: allViolations,
      analysisTimeMs: workspaceResult.totalTimeMs,
      fileCount: workspaceResult.totalFileCount,
      hasViolations: workspaceResult.hasViolations,
      workspaceResult,
    };
  }

  private async executeSingleProjectLinting(
    options: LintOptions,
  ): Promise<LintExecutionResult> {
    // Load configuration
    const config = await loadConfig(
      options.projectPath,
      options.configPath,
      options.configOverrides,
    );

    // Create and run linter
    const linter = new FeatureBoundariesLinter(config);
    const lintResult = await linter.lint();

    // Filter violations
    const filteredViolations = this.violationFilter.filterViolations(
      lintResult.violations,
      config,
      options.filterOptions,
    );

    let allFeatures: string[] | undefined;
    let featureStats: FeatureStats[] | undefined;

    // Calculate feature statistics if needed
    if (
      options.includeFeatureStats !== false &&
      !options.filterOptions?.feature
    ) {
      const allFiles = await discoverFiles(config);
      allFeatures = await this.statisticsCalculator.discoverAllFeatures(
        allFiles,
        config,
      );
      featureStats = await this.statisticsCalculator.calculateFeatureStats(
        allFiles,
        config,
        lintResult,
      );
    }

    return {
      violations: filteredViolations,
      allFeatures,
      featureStats,
      analysisTimeMs: lintResult.analysisTimeMs,
      fileCount: lintResult.fileCount,
      hasViolations: filteredViolations.length > 0,
    };
  }

  formatResults(
    result: LintExecutionResult,
    config: FeatureBoundariesConfig,
    reporterOptions: ReporterOptions = {},
    filterOptions: ViolationFilterOptions = {},
  ): {
    violationOutput: string[];
    summaryOutput: string;
    domainSummaryOutput?: string;
    cycleAnalysisOutput?: string;
  } {
    const reporter = new ColoredReporter(reporterOptions);

    // Format individual violations
    const violationOutput = result.violations.map((violation) =>
      reporter.formatViolation(violation, config.rootDir),
    );

    // Format summary
    const summaryContext = filterOptions.feature
      ? `feature "${filterOptions.feature}"`
      : undefined;
    const summaryOutput = reporter.formatSummary(
      result.violations,
      summaryContext,
    );

    // Format domain summary
    const domainSummaryOutput = reporter.formatDomainSummary(
      result.violations,
      config,
      result.allFeatures,
      result.featureStats,
    );

    // Format cycle analysis
    const cycleAnalysisOutput = reporter.formatCycleAnalysis(result.violations);

    return {
      violationOutput,
      summaryOutput,
      domainSummaryOutput: domainSummaryOutput || undefined,
      cycleAnalysisOutput: cycleAnalysisOutput || undefined,
    };
  }

  /**
   * Convenience method for simple linting with minimal configuration
   */
  async quickLint(
    projectPath: string,
    configPath?: string,
  ): Promise<LintExecutionResult> {
    return this.executeLinting({
      projectPath,
      configPath,
      includeFeatureStats: true,
    });
  }

  /**
   * Get analysis summary without running the full linting process
   */
  analyzeExistingViolations(violations: Array<any>) {
    return this.violationFilter.analyzeViolations(violations);
  }
}
