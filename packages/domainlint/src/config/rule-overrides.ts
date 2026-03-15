import type { Violation } from '../graph/types.js';
import type { FeatureBoundariesConfig, RuleLevel, RuleName } from './types.js';

export interface RuleCheckResult {
  shouldRun: boolean;
  level: RuleLevel;
}

export function checkRuleOverride(
  config: FeatureBoundariesConfig,
  ruleName: RuleName,
  filePath: string,
): RuleCheckResult {
  const defaultLevel: RuleLevel = 'error';

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
      // Custom rule violations already carry their own level; pass through as-is
      if (
        violation.code === 'ARCH_CUSTOM_RULE' ||
        ![
          'ARCH_IMPORT_CYCLE',
          'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT',
          'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
        ].includes(violation.code)
      ) {
        return {
          ...violation,
          level: violation.level ?? 'error',
        } as Violation & { level: Exclude<RuleLevel, 'off'> };
      }

      const ruleName: RuleName =
        violation.code === 'ARCH_IMPORT_CYCLE'
          ? 'import-cycles'
          : 'cross-feature-imports';

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
