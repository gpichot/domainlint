import { relative } from 'node:path';
import chalk from 'chalk';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { getFeature } from '../files/file-discovery.js';
import type { Violation } from '../graph/types.js';

export interface ReporterOptions {
  colors?: boolean;
  verbose?: boolean;
}

export interface FeatureStats {
  feature: string;
  fileCount: number;
  linesOfCode: number;
  dependencies: string[]; // List of other features this feature depends on
}

interface ColumnWidths {
  violations: number;
  files: number;
  lines: number;
}

function formatFileStats(fileCount: number, linesOfCode: number): string {
  const fileText = fileCount === 1 ? 'file' : 'files';
  const locText = linesOfCode === 1 ? 'line' : 'lines';
  return `${fileCount} ${fileText}, ${linesOfCode} ${locText}`;
}

function formatAlignedMetrics(
  violationCount: number | null,
  fileCount: number | null,
  linesOfCode: number | null,
  columnWidths: ColumnWidths | undefined,
  includeEmptyViolationColumn: boolean = false,
): string {
  const parts: string[] = [];

  if (violationCount !== null && violationCount > 0) {
    const violationText = `${violationCount} violation${violationCount > 1 ? 's' : ''}`;
    const padding = columnWidths
      ? ' '.repeat(Math.max(0, columnWidths.violations - violationText.length))
      : '';
    parts.push(padding + violationText);
  } else if (includeEmptyViolationColumn && columnWidths) {
    parts.push(' '.repeat(columnWidths.violations + 1)); // +1 for space that would follow "violations"
  }

  if (fileCount !== null) {
    const fileText = `${fileCount} file${fileCount > 1 ? 's' : ''}`;
    const padding = columnWidths
      ? ' '.repeat(Math.max(0, columnWidths.files - fileText.length))
      : '';
    parts.push(padding + fileText);
  }

  if (linesOfCode !== null) {
    const lineText = `${linesOfCode} line${linesOfCode > 1 ? 's' : ''}`;
    const padding = columnWidths
      ? ' '.repeat(Math.max(0, columnWidths.lines - lineText.length))
      : '';
    parts.push(padding + lineText);
  }

  return parts.filter(Boolean).join(' ');
}

function formatDependencies(
  dependencies: string[],
  maxLength: number = 50,
  includeArrow: boolean = true,
  currentFeature?: string,
  allFeatureStats?: FeatureStats[],
): string {
  if (dependencies.length === 0) return '';

  // Detect circular dependencies
  const circularDeps = new Set<string>();
  if (currentFeature && allFeatureStats) {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function detectCycle(feature: string): boolean {
      if (recursionStack.has(feature)) {
        return true; // Found a cycle
      }
      if (visited.has(feature)) {
        return false;
      }

      visited.add(feature);
      recursionStack.add(feature);

      const featureStats = allFeatureStats?.find((f) => f.feature === feature);
      if (featureStats) {
        for (const dep of featureStats.dependencies) {
          if (detectCycle(dep)) {
            circularDeps.add(dep);
            return true;
          }
        }
      }

      recursionStack.delete(feature);
      return false;
    }

    detectCycle(currentFeature);
  }

  // Format dependencies with circular indicators
  const formattedDeps = dependencies.map((dep) => {
    if (circularDeps.has(dep)) {
      return `${dep}⚠️`;
    }
    return dep;
  });

  const depStr = formattedDeps.join(', ');
  const prefix = includeArrow ? ' → ' : ' ';

  if (depStr.length + prefix.length <= maxLength) {
    return `${prefix}${depStr}`;
  }

  // Truncate with ellipsis
  let result = '';
  let length = 0;
  for (let i = 0; i < formattedDeps.length; i++) {
    const dep = formattedDeps[i];
    const addition = i === 0 ? `${prefix}${dep}` : `, ${dep}`;
    if (length + addition.length > maxLength - 3) {
      // -3 for "..."
      result += '...';
      break;
    }
    result += addition;
    length += addition.length;
  }

  return result;
}

export class ColoredReporter {
  constructor(private options: ReporterOptions = {}) {
    // Default to colored output unless explicitly disabled
    this.options.colors = this.options.colors ?? true;
  }

  formatViolation(violation: Violation, rootDir?: string): string {
    const { file, line, col, code, message, level = 'error' } = violation;

    // Use relative path if rootDir is provided
    const displayFile = rootDir ? relative(rootDir, file) : file;

    if (!this.options.colors) {
      return this.formatViolationPlain(
        displayFile,
        line,
        col,
        code,
        message,
        level,
        rootDir,
      );
    }

    return this.formatViolationColored(
      displayFile,
      line,
      col,
      code,
      message,
      level,
      rootDir,
    );
  }

  private formatViolationPlain(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
    rootDir?: string,
  ): string {
    const processedMessage = this.stripPaths(message, rootDir);
    const levelLabel = level.toUpperCase();

    if (code === 'ARCH_IMPORT_CYCLE') {
      return this.formatCyclePlain(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    if (code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT') {
      return this.formatBoundaryViolationPlain(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    if (code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN') {
      return this.formatNonDomainViolationPlain(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    return `${file}:${line}:${col} ${levelLabel} ${code}\n  ${processedMessage}`;
  }

  private formatViolationColored(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
    rootDir?: string,
  ): string {
    const processedMessage = this.stripPaths(message, rootDir);
    const levelColor = level === 'warn' ? chalk.yellow : chalk.red;
    const levelLabel = levelColor(level.toUpperCase());

    if (code === 'ARCH_IMPORT_CYCLE') {
      return this.formatCycleColored(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    if (code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT') {
      return this.formatBoundaryViolationColored(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    if (code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN') {
      return this.formatNonDomainViolationColored(
        file,
        line,
        col,
        code,
        processedMessage,
        level,
      );
    }

    const location = chalk.cyan(`${file}:${line}:${col}`);
    const coloredCode = this.getColoredCode(code);
    return `${location} ${coloredCode}\n  ${processedMessage}`;
  }

  formatSummary(violations: Violation[], filter?: string): string {
    if (violations.length === 0) {
      const message = filter
        ? `✓ No violations found in ${filter}`
        : '✓ No violations found';
      return this.options.colors ? chalk.green(message) : message;
    }

    const cycleCount = violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    ).length;
    const boundaryCount = violations.filter(
      (v) =>
        v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT' ||
        v.code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
    ).length;

    const parts: string[] = [];

    if (cycleCount > 0) {
      const text = `${cycleCount} import cycle${cycleCount > 1 ? 's' : ''}`;
      parts.push(this.options.colors ? chalk.red(text) : text);
    }

    if (boundaryCount > 0) {
      const text = `${boundaryCount} boundary violation${boundaryCount > 1 ? 's' : ''}`;
      parts.push(this.options.colors ? chalk.yellow(text) : text);
    }

    const summary = parts.join(' and ');
    const total = `${violations.length} total violation${violations.length > 1 ? 's' : ''}`;
    const filterText = filter ? ` in ${filter}` : '';

    return this.options.colors
      ? `${chalk.red('✗')} Found ${summary}${filterText} (${chalk.bold(total)})`
      : `✗ Found ${summary}${filterText} (${total})`;
  }

  formatDomainSummary(
    violations: Violation[],
    config: FeatureBoundariesConfig,
    allFeatures?: string[],
    featureStats?: FeatureStats[],
  ): string {
    // If no violations and no comprehensive feature list, don't show anything
    if (violations.length === 0 && !allFeatures) {
      return '';
    }

    // Group violations by domain/feature
    const domainViolations = new Map<string, Violation[]>();

    for (const violation of violations) {
      const feature = getFeature(violation.file, config);
      const domain = feature || 'global';

      if (!domainViolations.has(domain)) {
        domainViolations.set(domain, []);
      }
      domainViolations.get(domain)!.push(violation);
    }

    // Determine all domains (features + global)
    const allDomains = new Set<string>();

    // Add features with violations
    for (const domain of domainViolations.keys()) {
      allDomains.add(domain);
    }

    // Add clean features if provided
    if (allFeatures) {
      for (const feature of allFeatures) {
        allDomains.add(feature);
      }
    }

    // Sort domains (clean features first, then features with violations, global last)
    const cleanFeatures: string[] = [];
    const violationFeatures: string[] = [];
    let hasGlobal = false;

    for (const domain of allDomains) {
      if (domain === 'global') {
        hasGlobal = domainViolations.has('global');
      } else if (domainViolations.has(domain)) {
        violationFeatures.push(domain);
      } else {
        cleanFeatures.push(domain);
      }
    }

    cleanFeatures.sort();
    violationFeatures.sort();

    // Calculate maximum feature name length for alignment
    const allFeatureNames = [...cleanFeatures, ...violationFeatures];
    if (hasGlobal) {
      allFeatureNames.push('Global (non-feature files)');
    }
    const maxFeatureNameLength = Math.max(
      ...allFeatureNames.map((name) =>
        name === 'global'
          ? 'Global (non-feature files)'.length
          : `Feature: ${name}`.length,
      ),
    );

    // Calculate maximum column widths for alignment
    const allEntries = [...cleanFeatures, ...violationFeatures];
    if (hasGlobal) {
      allEntries.push('global');
    }

    let maxViolationsWidth = 0;
    let maxFilesWidth = 0;
    let maxLinesWidth = 0;

    for (const domain of allEntries) {
      if (domain === 'global') {
        const globalViols = domainViolations.get('global');
        if (globalViols) {
          const violationText = `${globalViols.length} violation${globalViols.length > 1 ? 's' : ''}`;
          maxViolationsWidth = Math.max(
            maxViolationsWidth,
            violationText.length,
          );
        }
        continue;
      }

      const stats = featureStats?.find((s) => s.feature === domain);
      const violations = domainViolations.get(domain);

      if (violations && violations.length > 0) {
        const violationText = `${violations.length} violation${violations.length > 1 ? 's' : ''}`;
        maxViolationsWidth = Math.max(maxViolationsWidth, violationText.length);
      }

      if (stats) {
        const fileText = `${stats.fileCount} file${stats.fileCount > 1 ? 's' : ''}`;
        const lineText = `${stats.linesOfCode} line${stats.linesOfCode > 1 ? 's' : ''}`;
        maxFilesWidth = Math.max(maxFilesWidth, fileText.length);
        maxLinesWidth = Math.max(maxLinesWidth, lineText.length);
      }
    }

    const columnWidths = {
      violations: maxViolationsWidth,
      files: maxFilesWidth,
      lines: maxLinesWidth,
    };

    const sections: string[] = [];

    // Show clean features first
    if (cleanFeatures.length > 0) {
      const cleanSection = this.formatCleanFeaturesSection(
        cleanFeatures,
        featureStats,
        maxFeatureNameLength,
        columnWidths,
      );
      sections.push(cleanSection);
    }

    // Show features with violations
    for (const domain of violationFeatures) {
      const domainViols = domainViolations.get(domain)!;
      const stats = featureStats?.find((s) => s.feature === domain);
      const section = this.formatDomainSection(
        domain,
        domainViols,
        stats,
        maxFeatureNameLength,
        columnWidths,
        featureStats,
      );
      sections.push(section);
    }

    // Show global violations last
    if (hasGlobal) {
      const globalViols = domainViolations.get('global')!;
      // Global doesn't have specific feature stats, but we could calculate them if needed
      const section = this.formatDomainSection(
        'global',
        globalViols,
        undefined,
        maxFeatureNameLength,
        columnWidths,
        featureStats,
      );
      sections.push(section);
    }

    const title = this.options.colors
      ? chalk.bold.underline('\nFeature Status:')
      : '\nFeature Status:';

    return `${title}\n${sections.join('\n')}`;
  }

  formatCycleAnalysis(violations: Violation[]): string {
    const cycleViolations = violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    );

    if (cycleViolations.length === 0) {
      return '';
    }

    // Analyze cycle lengths
    const cycleLengths = cycleViolations.map((violation) => {
      const lengthMatch = violation.message.match(
        /\(Total cycle length: (\d+) files\)/,
      );
      if (lengthMatch) {
        return parseInt(lengthMatch[1]);
      }
      return violation.message.split(' -> ').length - 1;
    });

    const shortestCycle = Math.min(...cycleLengths);
    const longestCycle = Math.max(...cycleLengths);
    const avgCycle = Math.round(
      cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length,
    );

    // Group by cycle length ranges
    const shortCycles = cycleLengths.filter((len) => len <= 5).length;
    const mediumCycles = cycleLengths.filter(
      (len) => len > 5 && len <= 20,
    ).length;
    const longCycles = cycleLengths.filter(
      (len) => len > 20 && len <= 100,
    ).length;
    const massiveCycles = cycleLengths.filter((len) => len > 100).length;

    const title = this.options.colors
      ? chalk.bold.yellow('\n📊 Cycle Analysis:')
      : '\n📊 Cycle Analysis:';

    const lines = [
      title,
      `   Total cycles found: ${cycleViolations.length}`,
      `   Cycle length range: ${shortestCycle} - ${longestCycle} files (avg: ${avgCycle})`,
      '',
      `   📏 Cycle Length Distribution:`,
      `      🟢 Short (≤5):     ${shortCycles} cycles ${shortCycles > 0 ? '← Start here!' : ''}`,
      `      🟡 Medium (6-20):  ${mediumCycles} cycles`,
      `      🟠 Long (21-100):  ${longCycles} cycles`,
      `      🔴 Massive (>100): ${massiveCycles} cycles`,
    ];

    if (shortCycles > 0) {
      lines.push(
        '',
        "   💡 Tip: Fix short cycles first - they're easier and often break longer cycles!",
      );
      lines.push('   Use: --shortest-cycles to see only the shortest cycles');
    } else if (mediumCycles > 0) {
      lines.push(
        '',
        '   💡 Tip: Use --max-cycle-length 20 to focus on medium cycles first',
      );
    }

    return lines.join('\n');
  }

  private formatCleanFeaturesSection(
    cleanFeatures: string[],
    featureStats?: FeatureStats[],
    maxFeatureNameLength?: number,
    columnWidths?: ColumnWidths,
  ): string {
    const header = this.options.colors
      ? `  ${chalk.green('✅ Clean Features')} ${chalk.dim('(no violations)')}`
      : '  ✅ Clean Features (no violations)';

    if (!featureStats || cleanFeatures.length === 0) {
      const featureList = cleanFeatures
        .map((feature) => {
          return this.options.colors
            ? chalk.green(`    • ${feature}`)
            : `    • ${feature}`;
        })
        .join('\n');
      return `${header}\n${featureList}`;
    }

    const statsEntries = cleanFeatures.map((feature) => {
      const stats = featureStats?.find((s) => s.feature === feature);
      return {
        feature,
        fileCount: stats?.fileCount || 0,
        linesOfCode: stats?.linesOfCode || 0,
        dependencies: stats?.dependencies || [],
      };
    });

    const featureList = statsEntries
      .map((entry) => {
        const { feature, fileCount, linesOfCode, dependencies } = entry;
        // Include empty violations column for alignment with violating features
        const statsText = formatAlignedMetrics(
          null,
          fileCount,
          linesOfCode,
          columnWidths,
          true,
        );
        const depsText = formatDependencies(
          dependencies,
          50,
          true,
          feature,
          featureStats,
        );

        // Calculate padding to align with violating features (clean features don't have "Feature:" prefix)
        const cleanFeatureName = feature;
        const alignmentTarget = maxFeatureNameLength
          ? maxFeatureNameLength - 9
          : 0; // 9 is length of "Feature: "
        const featurePadding =
          alignmentTarget > 0
            ? ' '.repeat(Math.max(0, alignmentTarget - cleanFeatureName.length))
            : '';

        if (this.options.colors) {
          return `    • ${chalk.green(feature)}${featurePadding} ${chalk.dim(statsText)}${chalk.blue(depsText)}`;
        } else {
          return `    • ${feature}${featurePadding} ${statsText}${depsText}`;
        }
      })
      .join('\n');

    return `${header}\n${featureList}`;
  }

  private formatDomainSection(
    domain: string,
    violations: Violation[],
    stats?: FeatureStats,
    maxFeatureNameLength?: number,
    columnWidths?: ColumnWidths,
    allFeatureStats?: FeatureStats[],
  ): string {
    const cycleCount = violations.filter(
      (v) => v.code === 'ARCH_IMPORT_CYCLE',
    ).length;
    const boundaryCount = violations.filter(
      (v) =>
        v.code === 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT' ||
        v.code === 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN',
    ).length;

    const domainName =
      domain === 'global' ? 'Global (non-feature files)' : `Feature: ${domain}`;
    const total = violations.length;

    // Calculate padding for alignment
    const padding = maxFeatureNameLength
      ? ' '.repeat(Math.max(0, maxFeatureNameLength - domainName.length))
      : '';

    let header: string;
    if (this.options.colors) {
      const alignedMetrics = formatAlignedMetrics(
        total > 0 ? total : null,
        stats?.fileCount || null,
        stats?.linesOfCode || null,
        columnWidths,
      );
      const depsText =
        stats && stats.dependencies.length > 0
          ? formatDependencies(
              stats.dependencies,
              50,
              true,
              domain,
              allFeatureStats,
            )
          : '';
      const headerContent = alignedMetrics ? chalk.dim(alignedMetrics) : '';
      const depsDisplay = depsText ? chalk.blue(depsText) : '';
      header = `  ${chalk.cyan(domainName)}${padding} ${headerContent}${depsDisplay}`;
    } else {
      const alignedMetrics = formatAlignedMetrics(
        total > 0 ? total : null,
        stats?.fileCount || null,
        stats?.linesOfCode || null,
        columnWidths,
      );
      const depsText =
        stats && stats.dependencies.length > 0
          ? formatDependencies(
              stats.dependencies,
              50,
              true,
              domain,
              allFeatureStats,
            )
          : '';
      const headerContent = alignedMetrics ? alignedMetrics : '';
      header = `  ${domainName}${padding} ${headerContent}${depsText}`;
    }

    const details: string[] = [];

    if (cycleCount > 0) {
      const text = `${cycleCount} import cycle${cycleCount > 1 ? 's' : ''}`;
      details.push(
        this.options.colors ? chalk.red(`    • ${text}`) : `    • ${text}`,
      );
    }

    if (boundaryCount > 0) {
      const text = `${boundaryCount} boundary violation${boundaryCount > 1 ? 's' : ''}`;
      details.push(
        this.options.colors ? chalk.yellow(`    • ${text}`) : `    • ${text}`,
      );
    }

    return `${header}\n${details.join('\n')}`;
  }

  private getColoredCode(code: string): string {
    if (!this.options.colors) {
      return code;
    }

    switch (code) {
      case 'ARCH_IMPORT_CYCLE':
        return chalk.red.bold(code);
      case 'ARCH_NO_CROSS_FEATURE_DEEP_IMPORT':
        return chalk.yellow.bold(code);
      case 'ARCH_NO_FEATURE_IMPORT_FROM_NON_DOMAIN':
        return chalk.cyan.bold(code);
      default:
        return chalk.magenta.bold(code);
    }
  }

  private formatCyclePlain(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const cyclePath = this.extractCyclePath(message);
    const { displayPath, summary } = this.truncateCyclePath(cyclePath);

    const cycleDisplay = displayPath.join(' ->\n    ');
    const levelLabel = level.toUpperCase();
    const result = `${file}:${line}:${col} ${levelLabel} ${code}\n  Import cycle detected:\n    ${cycleDisplay} ->`;

    return summary ? `${result}\n  ${summary}` : result;
  }

  private formatCycleColored(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const cyclePath = this.extractCyclePath(message);
    const { displayPath, summary } = this.truncateCyclePath(cyclePath);

    const location = chalk.cyan(`${file}:${line}:${col}`);
    const levelColor = level === 'warn' ? chalk.yellow : chalk.red;
    const levelLabel = levelColor.bold(level.toUpperCase());
    const coloredCode = levelColor.bold(code);
    const formattedPath = displayPath
      .map((path) => chalk.yellow(path))
      .join(chalk.red(' ->\n    '));

    let result = `${location} ${levelLabel} ${coloredCode}\n  ${levelColor('Import cycle detected:')}\n    ${formattedPath}${levelColor(' ->')}`;

    if (summary) {
      result += `\n  ${chalk.dim(summary)}`;
    }

    return result;
  }

  private formatBoundaryViolationPlain(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const details = this.extractBoundaryDetails(message);
    return [
      `${file}:${line}:${col} ${level.toUpperCase()} ${code}`,
      `  Cross-feature deep import not allowed`,
      `    Import:        "${details.import}"`,
      `    Resolves to:   "${details.resolvedTo}"`,
      `    Should use:    "${details.shouldUse}"`,
    ].join('\n');
  }

  private formatNonDomainViolationPlain(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const details = this.extractNonDomainDetails(message);
    return [
      `${file}:${line}:${col} ${level.toUpperCase()} ${code}`,
      `  Feature import from non-domain directory not allowed`,
      `    Import:        "${details.import}"`,
      `    Resolves to:   "${details.resolvedTo}"`,
      `    Suggestion:    Create or move to an existing feature/domain for this import`,
    ].join('\n');
  }

  private formatBoundaryViolationColored(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const details = this.extractBoundaryDetails(message);
    const location = chalk.cyan(`${file}:${line}:${col}`);
    const levelColor = level === 'warn' ? chalk.yellow : chalk.red;
    const levelLabel = levelColor.bold(level.toUpperCase());
    const coloredCode = levelColor.bold(code);

    return [
      `${location} ${levelLabel} ${coloredCode}`,
      `  ${levelColor('Cross-feature deep import not allowed')}`,
      `    ${chalk.dim('Import:')}        ${chalk.cyan(`"${details.import}"`)}`,
      `    ${chalk.dim('Resolves to:')}   ${chalk.red(`"${details.resolvedTo}"`)}`,
      `    ${chalk.dim('Should use:')}    ${chalk.green(`"${details.shouldUse}"`)}`,
    ].join('\n');
  }

  private formatNonDomainViolationColored(
    file: string,
    line: number,
    col: number,
    code: string,
    message: string,
    level: 'warn' | 'error',
  ): string {
    const details = this.extractNonDomainDetails(message);
    const location = chalk.cyan(`${file}:${line}:${col}`);
    const coloredCode = this.getColoredCode(code);

    return [
      `${location} ${coloredCode}`,
      `  ${chalk.cyan('Feature import from non-domain directory not allowed')}`,
      `    ${chalk.dim('Import:')}        ${chalk.blue(`"${details.import}"`)}`,
      `    ${chalk.dim('Resolves to:')}   ${chalk.red(`"${details.resolvedTo}"`)}`,
      `    ${chalk.dim('Suggestion:')}    ${chalk.green('Create or move to an existing feature/domain for this import')}`,
    ].join('\n');
  }

  private extractCyclePath(message: string): string[] {
    const match = message.match(/Import cycle detected: (.+)/);
    if (!match) return [];

    return match[1].split(' -> ').filter((path) => path.trim());
  }

  private truncateCyclePath(
    cyclePath: string[],
    maxVisible: number = 8,
  ): { displayPath: string[]; summary: string | null } {
    if (cyclePath.length <= maxVisible) {
      return { displayPath: cyclePath, summary: null };
    }

    // Show 3 imports before and 3 after the truncation
    const showFirst = 3;
    const showLast = 3;
    const hidden = cyclePath.length - showFirst - showLast;

    const displayPath = [
      ...cyclePath.slice(0, showFirst),
      `[... ${hidden} more imports in cycle]`,
      ...cyclePath.slice(-showLast),
    ];

    const summary = `(Total cycle length: ${cyclePath.length} files)`;

    return { displayPath, summary };
  }

  private extractBoundaryDetails(message: string): {
    import: string;
    resolvedTo: string;
    shouldUse: string;
  } {
    const importMatch = message.match(/Import "([^"]+)"/);
    const resolvedMatch = message.match(/resolves to "([^"]+)"/);
    const shouldUseMatch = message.match(
      /should import from feature barrel "([^"]+)"/,
    );

    return {
      import: importMatch?.[1] || '',
      resolvedTo: resolvedMatch?.[1] || '',
      shouldUse: shouldUseMatch?.[1] || '',
    };
  }

  private extractNonDomainDetails(message: string): {
    import: string;
    resolvedTo: string;
  } {
    const importMatch = message.match(/Import "([^"]+)"/);
    const resolvedMatch = message.match(/resolves to "([^"]+)"/);

    return {
      import: importMatch?.[1] || '',
      resolvedTo: resolvedMatch?.[1] || '',
    };
  }

  private stripPaths(message: string, rootDir?: string): string {
    if (!rootDir) {
      return message;
    }

    // Replace absolute paths with relative paths in the message
    // This handles paths in quoted strings within error messages
    return message.replace(
      new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      '.',
    );
  }
}
