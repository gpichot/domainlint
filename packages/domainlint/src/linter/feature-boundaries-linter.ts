import { filterViolationsByOverrides } from '../config/rule-overrides.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { discoverFiles } from '../files/file-discovery.js';
import { DependencyGraphBuilder } from '../graph/dependency-graph.js';
import type { Violation } from '../graph/types.js';
import { parseFile } from '../parser/swc-parser.js';
import {
  type CustomRule,
  findRulesFile,
  loadCustomRules,
  runCustomRules,
} from '../rules/custom-rules.js';
import { detectCycles } from '../rules/cycle-detector.js';
import { validateFeatureBoundaries } from '../rules/feature-boundary-validator.js';
import { loadTsConfig } from '../tsconfig/tsconfig-loader.js';

export interface LintResult {
  violations: Violation[];
  fileCount: number;
  analysisTimeMs: number;
  dependencyGraph: import('../graph/types.js').DependencyGraph;
}

export class FeatureBoundariesLinter {
  constructor(private config: FeatureBoundariesConfig) {}

  async lint(): Promise<LintResult> {
    const startTime = Date.now();
    const violations: Violation[] = [];

    try {
      // Load tsconfig
      const tsconfig = await loadTsConfig(this.config.tsconfigPath);

      // Discover files
      const files = await discoverFiles(this.config);

      // Parse all files
      const parseResults = await Promise.all(
        files.map((file) => parseFile(file.path, this.config)),
      );

      // Build dependency graph
      const graphBuilder = new DependencyGraphBuilder(this.config, tsconfig);
      const graph = await graphBuilder.buildGraph(files, parseResults);

      // Run built-in rules
      const cycleViolations = detectCycles(graph);
      violations.push(...cycleViolations);

      const boundaryViolations = validateFeatureBoundaries(
        graph,
        files,
        this.config,
      );
      violations.push(...boundaryViolations);

      // Run custom rules
      const customRules = await this.loadCustomRulesIfPresent();
      if (customRules.length > 0) {
        const customViolations = await runCustomRules(customRules, {
          graph,
          config: this.config,
        });
        violations.push(...customViolations);
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
      };
    } catch (error) {
      throw new Error(
        `Linting failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async loadCustomRulesIfPresent(): Promise<CustomRule[]> {
    const rulesFilePath = await findRulesFile(
      this.config.rootDir,
      this.config.rulesFile,
    );
    if (!rulesFilePath) {
      return [];
    }
    return loadCustomRules(rulesFilePath);
  }
}
