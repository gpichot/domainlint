import type { FeatureBoundariesConfig } from '../config/types.js';
import { getFeature } from '../files/file-discovery.js';
import type { Violation } from '../graph/types.js';

export interface ViolationFilterOptions {
  feature?: string;
  shortestCycles?: boolean;
  maxCycleLength?: number;
}

export interface CycleViolation extends Violation {
  cycleLength: number;
}

export class ViolationFilterService {
  filterViolations(
    violations: Violation[],
    config: FeatureBoundariesConfig,
    options: ViolationFilterOptions = {},
  ): Violation[] {
    let filtered = [...violations];

    // Filter violations by feature if specified
    if (options.feature) {
      filtered = this.filterByFeature(filtered, config, options.feature);
    }

    // Separate cycle violations for special processing
    const cycleViolations = filtered.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );
    const otherViolations = filtered.filter(
      (v) => v.code !== 'ARCH_IMPORT_CYCLE',
    );

    let filteredCycleViolations = cycleViolations;

    // Apply cycle-specific filters
    if (
      options.shortestCycles ||
      (options.maxCycleLength && options.maxCycleLength < 50)
    ) {
      filteredCycleViolations = this.filterCycles(cycleViolations, options);
    }

    return [...filteredCycleViolations, ...otherViolations];
  }

  private filterByFeature(
    violations: Violation[],
    config: FeatureBoundariesConfig,
    featureName: string,
  ): Violation[] {
    return violations.filter((violation) => {
      const feature = getFeature(violation.file, config);
      return feature === featureName;
    });
  }

  private filterCycles(
    cycleViolations: Violation[],
    options: ViolationFilterOptions,
  ): Violation[] {
    // Extract cycle length from violation messages
    const cyclesWithLength: CycleViolation[] = cycleViolations.map(
      (violation) => {
        const cycleLength = this.extractCycleLength(violation.message);
        return { ...violation, cycleLength };
      },
    );

    // Apply filters
    let filtered = cyclesWithLength;

    // Filter by max cycle length
    if (options.maxCycleLength) {
      filtered = filtered.filter(
        (v) => v.cycleLength <= options.maxCycleLength!,
      );
    }

    // If shortest-cycles flag is set, show only the shortest unique cycles
    if (options.shortestCycles) {
      filtered = this.selectShortestCycles(filtered);
    }

    return filtered;
  }

  private extractCycleLength(message: string): number {
    // Try to extract from total cycle length indicator
    const lengthMatch = message.match(/\(Total cycle length: (\d+) files\)/);
    if (lengthMatch) {
      return parseInt(lengthMatch[1]);
    }

    // Try to extract from truncated cycle indicator
    const truncatedMatch = message.match(
      /\[\.\.\.(\d+) more imports in cycle\]/,
    );
    if (truncatedMatch) {
      // Estimate length from truncated display
      const hiddenCount = parseInt(truncatedMatch[1]);
      const visibleParts = message.split(' -> ').length - 1;
      return hiddenCount + visibleParts;
    }

    // Count visible parts for short cycles
    return message.split(' -> ').length - 1;
  }

  private selectShortestCycles(
    cyclesWithLength: CycleViolation[],
  ): CycleViolation[] {
    // Group by starting file and keep only the shortest cycle for each
    const shortestCycles = new Map<string, CycleViolation>();

    cyclesWithLength.forEach((violation) => {
      const startFile = violation.file;
      if (
        !shortestCycles.has(startFile) ||
        shortestCycles.get(startFile)!.cycleLength > violation.cycleLength
      ) {
        shortestCycles.set(startFile, violation);
      }
    });

    return Array.from(shortestCycles.values());
  }

  /**
   * Analyzes violations and returns summary information
   */
  analyzeViolations(violations: Violation[]): {
    cycleCount: number;
    boundaryViolationCount: number;
    totalCount: number;
    violationsByType: Record<string, number>;
  } {
    const violationsByType: Record<string, number> = {};

    violations.forEach((violation) => {
      violationsByType[violation.code] =
        (violationsByType[violation.code] || 0) + 1;
    });

    return {
      cycleCount: violationsByType['ARCH_IMPORT_CYCLE'] || 0,
      boundaryViolationCount:
        (violationsByType['ARCH_NO_CROSS_FEATURE_DEEP_IMPORT'] || 0) +
        (violationsByType['ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN'] || 0),
      totalCount: violations.length,
      violationsByType,
    };
  }
}
