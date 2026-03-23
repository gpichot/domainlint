import type { Violation } from '../graph/types.js';
import type { FeatureBoundariesConfig, RuleLevel, RuleName } from './types.js';

function codeToRuleName(code: string): RuleName {
  switch (code) {
    case 'ARCH_IMPORT_CYCLE':
      return 'import-cycles';
    case 'ARCH_UNUSED_FILE':
      return 'unused-files';
    case 'ARCH_UNUSED_EXPORT':
      return 'unused-exports';
    default:
      return 'cross-feature-imports';
  }
}

export interface RuleCheckResult {
  shouldRun: boolean;
  level: RuleLevel;
}

const DEFAULT_LEVELS: Record<RuleName, RuleLevel> = {
  'import-cycles': 'error',
  'cross-feature-imports': 'error',
  'unused-files': 'off',
  'unused-exports': 'off',
};

export function checkRuleOverride(
  config: FeatureBoundariesConfig,
  ruleName: RuleName,
  filePath: string,
): RuleCheckResult {
  const defaultLevel: RuleLevel = DEFAULT_LEVELS[ruleName];

  // Normalize file path
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check if file is in features directory
  const normalizedFeaturesDir = config.featuresDir.replace(/\\/g, '/');
  const isInFeatures = normalizedPath.startsWith(normalizedFeaturesDir);

  let effectiveLevel: RuleLevel = defaultLevel;

  if (isInFeatures) {
    // Extract feature name from path
    const relativePath = normalizedPath.slice(normalizedFeaturesDir.length);
    const featureName = relativePath.split('/')[1]; // Get first segment after features/

    // Check feature-specific overrides
    const featureOverride = config.overrides?.features?.[featureName];
    if (featureOverride?.rules?.[ruleName]) {
      effectiveLevel = featureOverride.rules[ruleName]!;
    }
  } else {
    // Check global overrides for non-feature files
    const globalOverride = config.overrides?.global;
    if (globalOverride?.rules?.[ruleName]) {
      effectiveLevel = globalOverride.rules[ruleName]!;
    }
  }

  return {
    shouldRun: effectiveLevel !== 'off',
    level: effectiveLevel,
  };
}

export function filterViolationsByOverrides(
  violations: Violation[],
  config: FeatureBoundariesConfig,
): Violation[] {
  return violations
    .map((violation) => {
      const ruleName: RuleName = codeToRuleName(violation.code);

      const ruleCheck = checkRuleOverride(config, ruleName, violation.file);

      if (!ruleCheck.shouldRun) {
        return null;
      }

      return {
        ...violation,
        level: ruleCheck.level as Exclude<RuleLevel, 'off'>,
      };
    })
    .filter(
      (violation): violation is NonNullable<typeof violation> =>
        violation !== null,
    );
}
