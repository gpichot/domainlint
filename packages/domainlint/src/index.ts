export { run } from '@oclif/core';
export { loadConfig } from './config/config-loader.js';
// Re-export main types for external usage
export type { FeatureBoundariesConfig } from './config/types.js';
export { GraphQuery } from './graph/graph-query.js';
export type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from './graph/types.js';
export { FeatureBoundariesLinter } from './linter/feature-boundaries-linter.js';
export type { ReporterOptions } from './reporter/colored-reporter.js';
export { ColoredReporter } from './reporter/colored-reporter.js';
// Custom rules API
export type {
  CustomRule,
  CustomRuleContext,
  CustomRuleResult,
  EmitViolation,
} from './rules/custom-rules.js';
