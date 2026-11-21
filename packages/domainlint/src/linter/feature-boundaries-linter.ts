import { filterViolationsByOverrides } from '../config/rule-overrides.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import { GraphQuery } from '../graph/graph-query.js';
import type { Violation } from '../graph/types.js';
import { runNativePipeline } from '../native/native-pipeline.js';
import type { ParseResult } from '../parser/types.js';
import {
  findRulesFile,
  loadRules,
  type Rule,
  runRules,
} from '../rules/rules.js';

export interface LintResult {
  violations: Violation[];
  fileCount: number;
  analysisTimeMs: number;
  dependencyGraph: import('../graph/types.js').DependencyGraph;
  /** Raw parse results with all import specifiers (including external packages) */
  parseResults: ParseResult[];
  /** Discovered source files (sorted by path) with feature/barrel info */
  files: FileInfo[];
}

export class FeatureBoundariesLinter {
  constructor(private config: FeatureBoundariesConfig) {}

  async lint(): Promise<LintResult> {
    const startTime = Date.now();
    const violations: Violation[] = [];

    try {
      // Native: discovery, parsing, resolution, graph, built-in rules (cycles
      // and feature boundaries).
      const native = runNativePipeline(this.config);
      const { graph, parseResults, files } = native;
      violations.push(...native.violations);

      // Run user-defined rules (JS) against the rebuilt graph
      const userRules = await this.loadRulesIfPresent();
      if (userRules.length > 0) {
        const query = new GraphQuery(graph, this.config);
        const userViolations = await runRules(userRules, {
          graph,
          query,
          config: this.config,
        });
        violations.push(...userViolations);
      }

      // Apply rule overrides
      const filteredViolations = filterViolationsByOverrides(
        violations,
        this.config,
      );
      const endTime = Date.now();

      return {
        violations: filteredViolations,
        fileCount: files.length,
        analysisTimeMs: endTime - startTime,
        dependencyGraph: graph,
        parseResults,
        files,
      };
    } catch (error) {
      throw new Error(
        `Linting failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async loadRulesIfPresent(): Promise<Rule[]> {
    const rulesFilePath = await findRulesFile(
      this.config.rootDir,
      this.config.rulesFile,
    );
    if (!rulesFilePath) {
      return [];
    }
    return loadRules(rulesFilePath);
  }
}
