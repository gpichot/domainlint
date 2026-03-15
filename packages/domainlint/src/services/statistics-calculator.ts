import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { getFeature } from '../files/file-discovery.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type { LintResult } from '../linter/feature-boundaries-linter.js';
import type { FeatureStats } from '../reporter/colored-reporter.js';

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

      if (this.options.includeLineCount !== false) {
        try {
          const content = await this.fs.readFile(file.path, 'utf-8');
          // Count non-empty lines (simple LOC metric)
          const lines = content
            .split('\n')
            .filter((line) => line.trim().length > 0);
          stats.totalLines += lines.length;
        } catch {
          // If we can't read the file, skip it
        }
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
