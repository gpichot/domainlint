import { relative } from 'node:path';
import { minimatch } from 'minimatch';
import type {
  CustomRuleConfig,
  FeatureBoundariesConfig,
} from '../config/types.js';
import type { DependencyGraph, Violation } from '../graph/types.js';

export function validateCustomRules(
  graph: DependencyGraph,
  config: FeatureBoundariesConfig,
): Violation[] {
  const { customRules } = config;
  if (!customRules || customRules.length === 0) {
    return [];
  }

  const violations: Violation[] = [];

  for (const rule of customRules) {
    const ruleViolations = evaluateCustomRule(rule, graph, config);
    violations.push(...ruleViolations);
  }

  return violations;
}

function evaluateCustomRule(
  rule: CustomRuleConfig,
  graph: DependencyGraph,
  config: FeatureBoundariesConfig,
): Violation[] {
  const violations: Violation[] = [];

  for (const edge of graph.edges) {
    const originalFrom =
      graph.normalizedToOriginalPath?.get(edge.from) || edge.from;
    const originalTo = graph.normalizedToOriginalPath?.get(edge.to) || edge.to;

    const relFrom = relative(config.rootDir, originalFrom);
    const relTo = relative(config.rootDir, originalTo);

    // Check if the source file matches the "from" pattern
    if (!minimatch(relFrom, rule.from)) {
      continue;
    }

    // If "allow" is specified, only these targets are permitted
    if (rule.allow) {
      const isAllowed = rule.allow.some((pattern) => minimatch(relTo, pattern));
      if (isAllowed) {
        continue;
      }
      // Not in the allow list — violation
      violations.push(
        createCustomRuleViolation(rule, edge, originalFrom, originalTo, relTo),
      );
      continue;
    }

    // If "deny" is specified, these targets are forbidden
    if (rule.deny) {
      const isDenied = rule.deny.some((pattern) => minimatch(relTo, pattern));
      if (!isDenied) {
        continue;
      }
      violations.push(
        createCustomRuleViolation(rule, edge, originalFrom, originalTo, relTo),
      );
    }
  }

  return violations;
}

function createCustomRuleViolation(
  rule: CustomRuleConfig,
  edge: import('../graph/types.js').DependencyEdge,
  fromPath: string,
  _toPath: string,
  relToPath: string,
): Violation {
  const message =
    rule.message ??
    `Import "${edge.importInfo.specifier}" resolves to "${relToPath}" which is not allowed by custom rule`;

  return {
    code: 'ARCH_CUSTOM_RULE',
    file: fromPath,
    line: edge.importInfo.line,
    col: edge.importInfo.col,
    message,
    level: rule.level ?? 'error',
  };
}
