export { run } from '@oclif/core';
export { loadConfig } from './config/config-loader.js';
// Re-export main types for external usage
export type {
  CustomRuleConfig,
  FeatureBoundariesConfig,
} from './config/types.js';
export type { DependencyGraph, Violation } from './graph/types.js';
export type { CustomRuleFunction } from './linter/feature-boundaries-linter.js';
export { FeatureBoundariesLinter } from './linter/feature-boundaries-linter.js';
export type { ReporterOptions } from './reporter/colored-reporter.js';
export { ColoredReporter } from './reporter/colored-reporter.js';
