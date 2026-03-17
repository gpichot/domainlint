import { relative } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { loadConfig } from '../config/config-loader.js';
import { ColoredReporter } from '../reporter/colored-reporter.js';
import { LintOrchestrator } from '../services/lint-orchestrator.js';
import type { WorkspaceLintResult } from '../workspace/workspace-runner.js';

export default class Check extends Command {
  private orchestrator = new LintOrchestrator();

  static override args = {
    path: Args.string({
      description: 'Path to the project to check',
      default: '.',
    }),
  };

  static override description = 'Check feature boundaries and import cycles';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ./my-project',
  ];

  static override flags = {
    config: Flags.string({ char: 'c', description: 'Path to config file' }),
    'src-dir': Flags.string({ description: 'Source directory (default: src)' }),
    'features-dir': Flags.string({
      description: 'Features directory (default: src/features)',
    }),
    'tsconfig-path': Flags.string({
      description: 'Path to tsconfig.json (default: ./tsconfig.json)',
    }),
    'include-dynamic-imports': Flags.boolean({
      description: 'Include dynamic imports in analysis',
    }),
    'no-color': Flags.boolean({
      description: 'Disable colored output',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Verbose output',
      default: false,
    }),
    feature: Flags.string({
      description: 'Filter violations by feature name',
    }),
    'shortest-cycles': Flags.boolean({
      description: 'Show only the shortest cycles (easier to fix)',
      default: false,
    }),
    'max-cycle-length': Flags.integer({
      description: 'Hide cycles longer than this length',
      default: 50,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Check);

    try {
      // Execute linting using orchestrator
      const result = await this.orchestrator.executeLinting({
        projectPath: args.path,
        configPath: flags.config,
        configOverrides: {
          srcDir: flags['src-dir'],
          featuresDir: flags['features-dir'],
          tsconfigPath: flags['tsconfig-path'],
          includeDynamicImports: flags['include-dynamic-imports'],
        },
        filterOptions: {
          feature: flags.feature,
          shortestCycles: flags['shortest-cycles'],
          maxCycleLength: flags['max-cycle-length'],
        },
        reporterOptions: {
          colors: !flags['no-color'],
          verbose: flags.verbose,
        },
        includeFeatureStats: !flags.feature,
      });

      // Workspace mode — display per-package results
      if (result.workspaceResult) {
        this.displayWorkspaceResults(result.workspaceResult, {
          colors: !flags['no-color'],
          verbose: flags.verbose,
        });

        if (result.hasViolations) {
          this.exit(1);
        }
        return;
      }

      // Single-project mode (existing behavior)
      this.log(
        `Analyzed ${result.fileCount} files in ${result.analysisTimeMs}ms`,
      );
      this.log('');

      // Load config for formatting (we need this for the rootDir)
      const config = await loadConfig(args.path, flags.config, {
        srcDir: flags['src-dir'],
        featuresDir: flags['features-dir'],
        tsconfigPath: flags['tsconfig-path'],
        includeDynamicImports: flags['include-dynamic-imports'],
      });

      // Format and display results
      const formatted = this.orchestrator.formatResults(
        result,
        config,
        {
          colors: !flags['no-color'],
          verbose: flags.verbose,
        },
        {
          feature: flags.feature,
        },
      );

      // Output violations
      for (const violation of formatted.violationOutput) {
        this.log(violation);
      }

      // Output summary
      this.log('');
      this.log(formatted.summaryOutput);

      // Output domain summary
      if (formatted.domainSummaryOutput) {
        this.log(formatted.domainSummaryOutput);
      }

      // Output cycle analysis
      if (formatted.cycleAnalysisOutput) {
        this.log(formatted.cycleAnalysisOutput);
      }

      // Exit with appropriate code
      if (result.hasViolations) {
        this.exit(1);
      }
    } catch (error) {
      this.error(
        `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        { exit: 2 },
      );
    }
  }

  private displayWorkspaceResults(
    workspaceResult: WorkspaceLintResult,
    options: { colors: boolean; verbose: boolean },
  ): void {
    const useColor = options.colors;
    const reporter = new ColoredReporter({ colors: useColor });

    const title = useColor
      ? chalk.bold(`Workspace (${workspaceResult.type})`)
      : `Workspace (${workspaceResult.type})`;
    this.log(title);
    this.log('');

    for (const pkgResult of workspaceResult.packageResults) {
      const relPath = relative(workspaceResult.root, pkgResult.path);
      const pkgHeader = useColor
        ? chalk.bold.cyan(`${pkgResult.name}`)
        : pkgResult.name;
      const pkgPath = useColor ? chalk.dim(` (${relPath})`) : ` (${relPath})`;

      if (pkgResult.skipped) {
        const skipMsg = useColor
          ? chalk.dim(` - skipped: ${pkgResult.skipReason}`)
          : ` - skipped: ${pkgResult.skipReason}`;
        this.log(`  ${pkgHeader}${pkgPath}${skipMsg}`);
        continue;
      }

      const violationCount = pkgResult.result.violations.length;
      const fileCount = pkgResult.result.fileCount;
      const timeMs = pkgResult.result.analysisTimeMs;

      let statusIcon: string;
      if (violationCount === 0) {
        statusIcon = useColor ? chalk.green('✓') : '✓';
      } else {
        statusIcon = useColor ? chalk.red('✗') : '✗';
      }

      const stats = useColor
        ? chalk.dim(` ${fileCount} files, ${timeMs}ms`)
        : ` ${fileCount} files, ${timeMs}ms`;

      this.log(`  ${statusIcon} ${pkgHeader}${pkgPath}${stats}`);

      // Show violations for this package
      if (violationCount > 0) {
        const violationSummary = useColor
          ? chalk.red(
              `    ${violationCount} violation${violationCount > 1 ? 's' : ''}`,
            )
          : `    ${violationCount} violation${violationCount > 1 ? 's' : ''}`;
        this.log(violationSummary);

        if (options.verbose) {
          for (const violation of pkgResult.result.violations) {
            const formatted = reporter.formatViolation(
              violation,
              pkgResult.path,
            );
            // Indent each line of the formatted violation
            for (const line of formatted.split('\n')) {
              this.log(`      ${line}`);
            }
          }
        }
      }
    }

    // Package boundary violations
    const pkgBoundaryViolations =
      workspaceResult.packageBoundaryViolations ?? [];
    if (pkgBoundaryViolations.length > 0) {
      this.log('');
      const pkgTitle = useColor
        ? chalk.bold.red('Package boundary violations')
        : 'Package boundary violations';
      this.log(`  ${pkgTitle}`);
      for (const violation of pkgBoundaryViolations) {
        const formatted = reporter.formatViolation(
          violation,
          workspaceResult.root,
        );
        for (const line of formatted.split('\n')) {
          this.log(`    ${line}`);
        }
      }
    }

    this.log('');

    // Total summary
    const totalViolations =
      workspaceResult.packageResults
        .filter((r) => !r.skipped)
        .reduce((sum, r) => sum + r.result.violations.length, 0) +
      pkgBoundaryViolations.length;
    const analyzedPackages = workspaceResult.packageResults.filter(
      (r) => !r.skipped,
    ).length;
    const skippedPackages = workspaceResult.packageResults.filter(
      (r) => r.skipped,
    ).length;

    this.log(
      `Analyzed ${workspaceResult.totalFileCount} files across ${analyzedPackages} package${analyzedPackages > 1 ? 's' : ''} in ${workspaceResult.totalTimeMs}ms`,
    );
    if (skippedPackages > 0) {
      this.log(
        `${skippedPackages} package${skippedPackages > 1 ? 's' : ''} skipped (no src directory)`,
      );
    }

    if (totalViolations === 0) {
      const msg = useColor
        ? chalk.green('✓ No violations found')
        : '✓ No violations found';
      this.log(msg);
    } else {
      const msg = useColor
        ? chalk.red(
            `✗ ${totalViolations} total violation${totalViolations > 1 ? 's' : ''} found`,
          )
        : `✗ ${totalViolations} total violation${totalViolations > 1 ? 's' : ''} found`;
      this.log(msg);
    }
  }
}
