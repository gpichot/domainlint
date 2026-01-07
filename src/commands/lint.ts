import { Args, Command, Flags } from '@oclif/core';
import { loadConfig } from '../config/config-loader.js';
import { LintOrchestrator } from '../services/lint-orchestrator.js';

export default class Lint extends Command {
  private orchestrator = new LintOrchestrator();

  static override args = {
    path: Args.string({
      description: 'Path to the project to lint',
      default: '.',
    }),
  };

  static override description = 'Lint feature boundaries and import cycles';

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
    const { args, flags } = await this.parse(Lint);

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

      // Display analysis information
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
}
