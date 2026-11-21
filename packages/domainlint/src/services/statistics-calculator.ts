import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { getFeature } from '../files/file-discovery.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type { LintResult } from '../linter/feature-boundaries-linter.js';
import type { FeatureStats } from '../reporter/colored-reporter.js';

const READ_CONCURRENCY = 64;

export interface StatisticsCalculatorOptions {
  includeLineCount?: boolean;
}

export class StatisticsCalculator {
  constructor(
    private options: StatisticsCalculatorOptions = {},
    private fs: FileSystem = nodeFileSystem,
  ) {}

  async calculateFeatureStats(
    allFiles: FileInfo[],
    config: FeatureBoundariesConfig,
    lintResult: LintResult,
  ): Promise<FeatureStats[]> {
    const featureStatsMap = new Map<
      string,
      { fileCount: number; totalLines: number; dependencies: Set<string> }
    >();

    // Initialize stats for all features
    const featureFiles: Array<{ path: string; feature: string }> = [];
    for (const file of allFiles) {
      const feature = getFeature(file.path, config);
      if (!feature) continue; // Skip non-feature files

      let stats = featureStatsMap.get(feature);
      if (!stats) {
        stats = { fileCount: 0, totalLines: 0, dependencies: new Set() };
        featureStatsMap.set(feature, stats);
      }

      stats.fileCount++;
      if (file.lineCount !== undefined) {
        if (this.options.includeLineCount !== false) {
          stats.totalLines += file.lineCount;
        }
      } else {
        featureFiles.push({ path: file.path, feature });
      }
    }

    // Fallback for callers that pass FileInfo without a line count: read the files.
    if (this.options.includeLineCount !== false) {
      // Bounded concurrency: reading every file at once exhausts file descriptors (EMFILE).
      for (let i = 0; i < featureFiles.length; i += READ_CONCURRENCY) {
        const chunk = featureFiles.slice(i, i + READ_CONCURRENCY);
        const counts = await Promise.all(
          chunk.map(async ({ path }) => {
            try {
              const content = await this.fs.readFile(path, 'utf-8');
              // Count non-empty lines (simple LOC metric)
              return content
                .split('\n')
                .filter((line) => line.trim().length > 0).length;
            } catch {
              // If we can't read the file, skip it
              return 0;
            }
          }),
        );
        chunk.forEach(({ feature }, k) => {
          featureStatsMap.get(feature)!.totalLines += counts[k];
        });
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

  async discoverAllFeatures(
    allFiles: FileInfo[],
    config: FeatureBoundariesConfig,
  ): Promise<string[]> {
    return [
      ...new Set(
        allFiles
          .map((file) => getFeature(file.path, config))
          .filter((feature) => feature !== null),
      ),
    ] as string[];
  }
}
