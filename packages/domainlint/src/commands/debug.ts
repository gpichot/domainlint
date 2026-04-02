import { relative } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { loadConfig } from '../config/config-loader.js';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { getFeature } from '../files/file-discovery.js';
import {
  FeatureBoundariesLinter,
  type LintResult,
} from '../linter/feature-boundaries-linter.js';
import { parseFile } from '../parser/oxc-parser.js';
import { ColoredReporter } from '../reporter/colored-reporter.js';
import { ModuleResolver } from '../resolution/module-resolver.js';
import { loadTsConfig } from '../tsconfig/tsconfig-loader.js';

interface FileDebugInfo {
  filePath: string;
  feature: string | null;
  outgoingImports: Array<{
    specifier: string;
    resolvedPath: string | null;
    line: number;
    col: number;
    isDynamic: boolean;
    isTypeOnly: boolean;
    targetFeature: string | null;
    violations: string[];
  }>;
  incomingImports: Array<{
    fromFile: string;
    fromFeature: string | null;
    specifier: string;
    line: number;
    col: number;
    isDynamic: boolean;
    isTypeOnly: boolean;
    violations: string[];
  }>;
}

export default class Debug extends Command {
  static override args = {
    file: Args.string({
      description: 'Path to the file to debug',
      required: true,
    }),
    path: Args.string({
      description: 'Path to the project (default: .)',
      default: '.',
    }),
  };

  static override description =
    'Debug imports and rule violations for a specific file';

  static override examples = [
    '<%= config.bin %> <%= command.id %> src/features/user/components/UserProfile.tsx',
    '<%= config.bin %> <%= command.id %> src/shared/utils/api.ts ./my-project',
  ];

  static override flags = {
    config: Flags.string({ char: 'c', description: 'Path to config file' }),
    'src-dir': Flags.string({ description: 'Source directory (default: src)' }),
    'features-dir': Flags.string({
      description: 'Features directory (default: src/features)',
    }),
    'tsconfig-path': Flags.string({
      description: 'Path to tsconfig.json (default: ./tsconfig.json)',
    }),
    'include-dynamic-imports': Flags.boolean({
      description: 'Include dynamic imports in analysis',
    }),
    'no-color': Flags.boolean({
      description: 'Disable colored output',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Debug);

    try {
      // Load configuration
      const config = await loadConfig(args.path, flags.config, {
        srcDir: flags['src-dir'],
        featuresDir: flags['features-dir'],
        tsconfigPath: flags['tsconfig-path'],
        includeDynamicImports: flags['include-dynamic-imports'],
      });

      // Normalize the target file path
      const targetFile = this.resolveFilePath(args.file, config.rootDir);

      // Run full linting to get all violations and dependency graph
      const linter = new FeatureBoundariesLinter(config);
      const lintResult = await linter.lint();

      // Analyze the specific file
      const debugInfo = await this.analyzeFile(targetFile, config, lintResult);

      // Create reporter
      const reporter = new ColoredReporter({
        colors: !flags['no-color'],
        verbose: false,
      });

      // Output debug information
      this.displayDebugInfo(debugInfo, config, reporter);
    } catch (error) {
      this.error(
        `Debug failed: ${error instanceof Error ? error.message : String(error)}`,
        { exit: 2 },
      );
    }
  }

  private resolveFilePath(filePath: string, rootDir: string): string {
    // Convert relative path to absolute path if needed
    if (!filePath.startsWith('/')) {
      return `${rootDir}/${filePath}`;
    }
    return filePath;
  }

  private async analyzeFile(
    targetFile: string,
    config: FeatureBoundariesConfig,
    lintResult: LintResult,
  ): Promise<FileDebugInfo> {
    // Parse the target file to get its imports
    const parseResult = await parseFile(targetFile, config);
    const feature = getFeature(targetFile, config);

    // Load tsconfig and create resolver
    const tsconfig = await loadTsConfig(config.tsconfigPath);
    const resolver = new ModuleResolver(config, tsconfig);

    // Analyze outgoing imports
    const outgoingImports = await Promise.all(
      parseResult.imports.map(async (importInfo) => {
        const resolved = await resolver.resolveImport(
          importInfo.specifier,
          targetFile,
        );

        const targetFeature = resolved.resolvedPath
          ? getFeature(resolved.resolvedPath, config)
          : null;

        // Find violations for this import
        const violations = this.findViolationsForImport(
          targetFile,
          resolved.resolvedPath,
          importInfo.line,
          importInfo.col,
          lintResult,
        );

        return {
          specifier: importInfo.specifier,
          resolvedPath: resolved.resolvedPath,
          line: importInfo.line,
          col: importInfo.col,
          isDynamic: importInfo.isDynamic,
          isTypeOnly: importInfo.isTypeOnly,
          targetFeature,
          violations,
        };
      }),
    );

    // Analyze incoming imports
    const normalizedTargetFile = this.normalizeModulePath(targetFile, config);
    const incomingImports: FileDebugInfo['incomingImports'] = [];

    for (const edge of lintResult.dependencyGraph.edges) {
      if (edge.to === normalizedTargetFile) {
        const originalFromFile =
          lintResult.dependencyGraph.normalizedToOriginalPath?.get(edge.from) ||
          edge.from;

        const fromFeature = getFeature(originalFromFile, config);

        // Find violations for this incoming import
        const violations = this.findViolationsForImport(
          originalFromFile,
          targetFile,
          edge.importInfo.line,
          edge.importInfo.col,
          lintResult,
        );

        incomingImports.push({
          fromFile: originalFromFile,
          fromFeature,
          specifier: edge.importInfo.specifier,
          line: edge.importInfo.line,
          col: edge.importInfo.col,
          isDynamic: edge.importInfo.isDynamic,
          isTypeOnly: edge.importInfo.isTypeOnly,
          violations,
        });
      }
    }

    return {
      filePath: targetFile,
      feature,
      outgoingImports,
      incomingImports,
    };
  }

  private normalizeModulePath(
    filePath: string,
    config: FeatureBoundariesConfig,
  ): string {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (config.extensions.includes(ext)) {
      return filePath.slice(0, -ext.length);
    }
    return filePath;
  }

  private findViolationsForImport(
    fromFile: string,
    toFile: string | null,
    line: number,
    col: number,
    lintResult: LintResult,
  ): string[] {
    if (!toFile) return [];

    return lintResult.violations
      .filter((v) => v.file === fromFile && v.line === line && v.col === col)
      .map((v) => `${v.code}: ${v.message}`);
  }

  private displayDebugInfo(
    debugInfo: FileDebugInfo,
    config: FeatureBoundariesConfig,
    _reporter: ColoredReporter,
  ): void {
    const relativePath = relative(config.rootDir, debugInfo.filePath);

    this.log(`\n🔍 Debug analysis for: ${relativePath}`);
    this.log(`📁 Feature: ${debugInfo.feature || '(none)'}`);
    this.log('');

    // Outgoing imports section
    this.log(`📤 Outgoing imports (${debugInfo.outgoingImports.length}):`);
    if (debugInfo.outgoingImports.length === 0) {
      this.log('  (no imports)');
    } else {
      for (const imp of debugInfo.outgoingImports) {
        const targetPath = imp.resolvedPath
          ? relative(config.rootDir, imp.resolvedPath)
          : '(external)';
        const typeFlag = imp.isTypeOnly ? ' [type-only]' : '';
        const dynamicFlag = imp.isDynamic ? ' [dynamic]' : '';

        this.log(
          `  • ${imp.specifier} → ${targetPath}${typeFlag}${dynamicFlag}`,
        );
        this.log(`    Line ${imp.line}, Col ${imp.col}`);
        if (imp.targetFeature) {
          this.log(`    Target feature: ${imp.targetFeature}`);
        }

        if (imp.violations.length > 0) {
          this.log(`    ❌ Violations:`);
          for (const violation of imp.violations) {
            this.log(`      - ${violation}`);
          }
        } else {
          this.log(`    ✅ No violations`);
        }
        this.log('');
      }
    }

    // Incoming imports section
    this.log(`📥 Incoming imports (${debugInfo.incomingImports.length}):`);
    if (debugInfo.incomingImports.length === 0) {
      this.log('  (no incoming imports)');
    } else {
      for (const imp of debugInfo.incomingImports) {
        const fromPath = relative(config.rootDir, imp.fromFile);
        const typeFlag = imp.isTypeOnly ? ' [type-only]' : '';
        const dynamicFlag = imp.isDynamic ? ' [dynamic]' : '';

        this.log(
          `  • ${fromPath} imports "${imp.specifier}"${typeFlag}${dynamicFlag}`,
        );
        this.log(`    Line ${imp.line}, Col ${imp.col}`);
        if (imp.fromFeature) {
          this.log(`    From feature: ${imp.fromFeature}`);
        }

        if (imp.violations.length > 0) {
          this.log(`    ❌ Violations:`);
          for (const violation of imp.violations) {
            this.log(`      - ${violation}`);
          }
        } else {
          this.log(`    ✅ No violations`);
        }
        this.log('');
      }
    }

    // Summary
    const outgoingViolations = debugInfo.outgoingImports.reduce(
      (sum, imp) => sum + imp.violations.length,
      0,
    );
    const incomingViolations = debugInfo.incomingImports.reduce(
      (sum, imp) => sum + imp.violations.length,
      0,
    );
    const totalViolations = outgoingViolations + incomingViolations;

    this.log(`📊 Summary:`);
    this.log(
      `  Total imports: ${debugInfo.outgoingImports.length + debugInfo.incomingImports.length}`,
    );
    this.log(`  Total violations: ${totalViolations}`);
  }
}
