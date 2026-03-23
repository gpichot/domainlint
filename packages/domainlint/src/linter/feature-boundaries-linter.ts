import { filterViolationsByOverrides } from '../config/rule-overrides.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { discoverFiles } from '../files/file-discovery.js';
import { DependencyGraphBuilder } from '../graph/dependency-graph.js';
import { GraphQuery } from '../graph/graph-query.js';
import type { Violation } from '../graph/types.js';
import { parseFile } from '../parser/swc-parser.js';
import { cycleRule } from '../rules/cycle-detector.js';
import { featureBoundaryRule } from '../rules/feature-boundary-validator.js';
import {
  findRulesFile,
  loadRules,
  type Rule,
  runRules,
} from '../rules/rules.js';
import { unusedExportRule } from '../rules/unused-export-detector.js';
import { unusedFileRule } from '../rules/unused-file-detector.js';
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
      const query = new GraphQuery(graph, this.config);
      const ruleContext = { graph, query, config: this.config };

      const builtInRules: Rule[] = [
        cycleRule,
        featureBoundaryRule,
        unusedFileRule,
        unusedExportRule,
      ];
      const builtInViolations = await runRules(builtInRules, ruleContext);
      violations.push(...builtInViolations);

      // Run user-defined rules
      const userRules = await this.loadRulesIfPresent();
      if (userRules.length > 0) {
        const userViolations = await runRules(userRules, ruleContext);
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
