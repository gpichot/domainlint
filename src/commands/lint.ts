import { readFile } from 'node:fs/promises';
import { Args, Command, Flags } from '@oclif/core';
import { loadConfig } from '../config/config-loader.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import {
  discoverFiles,
  type FileInfo,
  getFeature,
} from '../files/file-discovery.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
import {
  ColoredReporter,
  type FeatureStats,
} from '../reporter/colored-reporter.js';

async function calculateFeatureStats(
  allFiles: FileInfo[],
  config: FeatureBoundariesConfig,
  lintResult: LintResult,
): Promise<FeatureStats[]> {
  const featureStatsMap = new Map<
    string,
    { fileCount: number; totalLines: number; dependencies: Set<string> }
  >();

  // Initialize stats for all features
  for (const file of allFiles) {
    const feature = getFeature(file.path, config);
    if (!feature) continue; // Skip non-feature files

    if (!featureStatsMap.has(feature)) {
      featureStatsMap.set(feature, {
        fileCount: 0,
        totalLines: 0,
        dependencies: new Set(),
      });
    }

    const stats = featureStatsMap.get(feature)!;
    stats.fileCount++;

    try {
      const content = await readFile(file.path, 'utf-8');
      // Count non-empty lines (simple LOC metric)
      const lines = content
        .split('\n')
        .filter((line) => line.trim().length > 0);
      stats.totalLines += lines.length;
    } catch {
      // If we can't read the file, skip it
    }
  }

  // Calculate dependencies by analyzing the dependency graph
  for (const edge of lintResult.dependencyGraph.edges) {
    const fromOriginalPath =
      lintResult.dependencyGraph.normalizedToOriginalPath?.get(edge.from) ||
      edge.from;
    const toOriginalPath =
      lintResult.dependencyGraph.normalizedToOriginalPath?.get(edge.to) ||
      edge.to;

    const fromFeature = getFeature(fromOriginalPath, config);
    const toFeature = getFeature(toOriginalPath, config);

    // Only track cross-feature dependencies
    if (fromFeature && toFeature && fromFeature !== toFeature) {
      const fromStats = featureStatsMap.get(fromFeature);
      if (fromStats) {
        fromStats.dependencies.add(toFeature);
      }
    }
  }

  return Array.from(featureStatsMap.entries()).map(([feature, stats]) => ({
    feature,
    fileCount: stats.fileCount,
    linesOfCode: stats.totalLines,
    dependencies: Array.from(stats.dependencies).sort(),
  }));
}

export default class Lint extends Command {
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
      // Load configuration
      const config = await loadConfig(args.path, flags.config, {
        srcDir: flags['src-dir'],
        featuresDir: flags['features-dir'],
        tsconfigPath: flags['tsconfig-path'],
        includeDynamicImports: flags['include-dynamic-imports'],
      });

      // Create and run linter
      const linter = new FeatureBoundariesLinter(config);
      const lintResult = await linter.lint();

      // Display analysis information
      this.log(
        `Analyzed ${lintResult.fileCount} files in ${lintResult.analysisTimeMs}ms`,
      );
      this.log('');

      let violations = lintResult.violations;

      // Filter violations by feature if specified
      if (flags.feature) {
        violations = violations.filter((violation) => {
          const feature = getFeature(violation.file, config);
          return feature === flags.feature;
        });
      }

      // Filter and analyze cycles
      const cycleViolations = violations.filter(
        (v) => v.code === 'ARCH_IMPORT_CYCLE',
      );
      const otherViolations = violations.filter(
        (v) => v.code !== 'ARCH_IMPORT_CYCLE',
      );

      let filteredCycleViolations = cycleViolations;

      // Apply cycle-specific filters
      if (flags['shortest-cycles'] || flags['max-cycle-length'] < 50) {
        filteredCycleViolations = this.filterCycles(cycleViolations, flags);
      }

      violations = [...filteredCycleViolations, ...otherViolations];

      // Create reporter with options
      const reporter = new ColoredReporter({
        colors: !flags['no-color'],
        verbose: flags.verbose,
      });

      // Output violations with improved formatting
      for (const violation of violations) {
        this.log(reporter.formatViolation(violation, config.rootDir));
      }

      // Output summary
      this.log('');
      if (flags.feature) {
        this.log(
          reporter.formatSummary(violations, `feature "${flags.feature}"`),
        );
      } else {
        this.log(reporter.formatSummary(violations));
      }

      // Discover all features for comprehensive status (only when not filtering by specific feature)
      let allFeatures: string[] | undefined;
      let featureStats: FeatureStats[] | undefined;

      if (!flags.feature) {
        const allFiles = await discoverFiles(config);
        allFeatures = [
          ...new Set(
            allFiles
              .map((file) => getFeature(file.path, config))
              .filter((feature) => feature !== null),
          ),
        ] as string[];

        // Calculate feature statistics
        featureStats = await calculateFeatureStats(
          allFiles,
          config,
          lintResult,
        );
      }

      // Output domain-based summary
      const domainSummary = reporter.formatDomainSummary(
        violations,
        config,
        allFeatures,
        featureStats,
      );
      if (domainSummary) {
        this.log(domainSummary);
      }

      // Output cycle analysis if there are cycles
      const cycleAnalysis = reporter.formatCycleAnalysis(violations);
      if (cycleAnalysis) {
        this.log(cycleAnalysis);
      }

      // Exit with appropriate code
      if (violations.length > 0) {
        this.exit(1);
      }
    } catch (error) {
      this.error(
        `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        { exit: 2 },
      );
    }
  }

  private filterCycles(cycleViolations: any[], flags: any): any[] {
    // Extract cycle length from violation messages
    const cyclesWithLength = cycleViolations.map((violation) => {
      const lengthMatch = violation.message.match(
        /\(Total cycle length: (\d+) files\)/,
      );
      const truncatedMatch = violation.message.match(
        /\[\.\.\.(\d+) more imports in cycle\]/,
      );

      let cycleLength: number;
      if (lengthMatch) {
        cycleLength = parseInt(lengthMatch[1]);
      } else if (truncatedMatch) {
        // Estimate length from truncated display
        const hiddenCount = parseInt(truncatedMatch[1]);
        const visibleParts = violation.message.split(' -> ').length - 1;
        cycleLength = hiddenCount + visibleParts;
      } else {
        // Count visible parts for short cycles
        cycleLength = violation.message.split(' -> ').length - 1;
      }

      return { ...violation, cycleLength };
    });

    // Apply filters
    let filtered = cyclesWithLength;

    // Filter by max cycle length
    if (flags['max-cycle-length']) {
      filtered = filtered.filter(
        (v) => v.cycleLength <= flags['max-cycle-length'],
      );
    }

    // If shortest-cycles flag is set, show only the shortest unique cycles
    if (flags['shortest-cycles']) {
      // Group by starting file and keep only the shortest cycle for each
      const shortestCycles = new Map();

      filtered.forEach((violation) => {
        const startFile = violation.file;
        if (
          !shortestCycles.has(startFile) ||
          shortestCycles.get(startFile).cycleLength > violation.cycleLength
        ) {
          shortestCycles.set(startFile, violation);
        }
      });

      filtered = Array.from(shortestCycles.values());
    }

    return filtered;
  }
}
