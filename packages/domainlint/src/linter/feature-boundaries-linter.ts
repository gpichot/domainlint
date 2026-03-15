import { filterViolationsByOverrides } from '../config/rule-overrides.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { discoverFiles } from '../files/file-discovery.js';
import { DependencyGraphBuilder } from '../graph/dependency-graph.js';
import type { DependencyGraph, Violation } from '../graph/types.js';
import { parseFile } from '../parser/swc-parser.js';
import { validateCustomRules } from '../rules/custom-rule-validator.js';
import { detectCycles } from '../rules/cycle-detector.js';
import { validateFeatureBoundaries } from '../rules/feature-boundary-validator.js';
import { loadTsConfig } from '../tsconfig/tsconfig-loader.js';

export type CustomRuleFunction = (graph: DependencyGraph) => Violation[];

export interface LintResult {
  violations: Violation[];
  fileCount: number;
  analysisTimeMs: number;
  dependencyGraph: DependencyGraph;
}

export class FeatureBoundariesLinter {
  private customRuleFunctions: CustomRuleFunction[] = [];

  constructor(private config: FeatureBoundariesConfig) {}

  addRule(rule: CustomRuleFunction): this {
    this.customRuleFunctions.push(rule);
    return this;
  }

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

      // Run config-based custom rules
      const customRuleViolations = validateCustomRules(graph, this.config);
      violations.push(...customRuleViolations);

      // Run programmatic custom rules
      for (const ruleFn of this.customRuleFunctions) {
        const ruleViolations = ruleFn(graph);
        violations.push(...ruleViolations);
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
}
