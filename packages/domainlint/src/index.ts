export { run } from '@oclif/core';
export { loadConfig } from './config/config-loader.js';
// Re-export main types for external usage
export type { FeatureBoundariesConfig, PackageRule } from './config/types.js';
export { GraphQuery } from './graph/graph-query.js';
export type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from './graph/types.js';
export { FeatureBoundariesLinter } from './linter/feature-boundaries-linter.js';
export type { ReporterOptions } from './reporter/colored-reporter.js';
export { ColoredReporter } from './reporter/colored-reporter.js';
// Rules API
export type {
  EmitViolation,
  Rule,
  RuleContext,
  RuleResult,
} from './rules/rules.js';
export type {
  WorkspaceInfo,
  WorkspacePackage,
} from './workspace/workspace-detector.js';
export { detectWorkspace } from './workspace/workspace-detector.js';
export type {
  WorkspaceLintResult,
  WorkspacePackageResult,
} from './workspace/workspace-runner.js';
export { runWorkspaceLint } from './workspace/workspace-runner.js';
