import { relative, sep } from 'node:path';
import type { FeatureBoundariesConfig, RuleName } from '../config/types.js';
import type { FileInfo } from '../files/file-discovery.js';
import type {
  DependencyEdge,
  DependencyGraph,
  Violation,
} from '../graph/types.js';
import type { ImportInfo, ParseResult } from '../parser/types.js';
import {
  loadNativeBinding,
  type NativeLintOptions,
  type NativeTimings,
} from './native-binding.js';

export interface NativePipelineResult {
  files: FileInfo[];
  graph: DependencyGraph;
  parseResults: ParseResult[];
  /** Built-in rule violations, not yet filtered by overrides. */
  violations: Violation[];
  timingsMs: NativeTimings;
}

/**
 * A built-in rule is computed unless it is `off` globally and no feature
 * override turns it back on (the override levels themselves are applied in JS
 * afterwards by `filterViolationsByOverrides`).
 */
function isRuleComputed(
  config: FeatureBoundariesConfig,
  rule: RuleName,
): boolean {
  const defaultLevel = rule === 'no-external-feature-imports' ? 'off' : 'error';
  const global = config.overrides?.global?.rules?.[rule] ?? defaultLevel;
  if (global !== 'off') return true;
  return Object.values(config.overrides?.features ?? {}).some((feature) => {
    const level = feature.rules?.[rule];
    return level !== undefined && level !== 'off';
  });
}

export function toNativeOptions(
  config: FeatureBoundariesConfig,
): NativeLintOptions {
  return {
    rootDir: config.rootDir,
    srcDir: config.srcDir,
    featuresDir: config.featuresDir,
    barrelFiles: config.barrelFiles,
    extensions: config.extensions,
    exclude: config.exclude,
    includeDynamicImports: config.includeDynamicImports,
    tsconfigPath: config.tsconfigPath,
    computeCycles: isRuleComputed(config, 'import-cycles'),
    computeCrossFeature: isRuleComputed(config, 'cross-feature-imports'),
    computeNonDomain: isRuleComputed(config, 'no-external-feature-imports'),
  };
}

/**
 * Runs the native pipeline (discovery, parsing, resolution, graph, built-in
 * rules) and rebuilds the JS data structures the rest of domainlint (custom
 * rules, `GraphQuery`, workspace rules, reporter) works with.
 */
export function runNativePipeline(
  config: FeatureBoundariesConfig,
): NativePipelineResult {
  const r = loadNativeBinding().lint(toNativeOptions(config));
  const count = r.files.length;

  // Files
  const rootPrefix = `${config.rootDir}${sep}`;
  const files: FileInfo[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const path = r.files[i];
    const feature = r.fileFeature[i];
    files[i] = {
      path,
      relativePath: path.startsWith(rootPrefix)
        ? path.slice(rootPrefix.length)
        : relative(config.rootDir, path),
      feature: feature >= 0 ? r.features[feature] : null,
      isBarrel: r.fileIsBarrel[i] === 1,
    };
  }

  // Parsed imports (all of them, including external and unresolved ones)
  const total = r.importSpecifier.length;
  const importInfos: ImportInfo[] = new Array(total);
  const parseResults: ParseResult[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = r.importOffsets[i];
    const end = r.importOffsets[i + 1];
    const imports: ImportInfo[] = new Array(end - start);
    for (let k = start; k < end; k++) {
      const flags = r.importFlags[k];
      const info: ImportInfo = {
        specifier: r.specifiers[r.importSpecifier[k]],
        line: r.importLine[k],
        col: r.importCol[k],
        isDynamic: (flags & 2) !== 0,
        isTypeOnly: (flags & 1) !== 0,
      };
      importInfos[k] = info;
      imports[k - start] = info;
    }
    parseResults[i] = { filePath: r.files[i], imports };
  }

  // Graph
  const nodes = new Set<string>();
  const adjacencyList = new Map<string, Set<string>>();
  const normalizedToOriginalPath = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const key = r.nodeKeys[i];
    nodes.add(key);
    adjacencyList.set(key, new Set());
    normalizedToOriginalPath.set(key, r.files[i]);
  }
  const edgeCount = r.edgeFrom.length;
  const edges: DependencyEdge[] = new Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const from = r.nodeKeys[r.edgeFrom[e]];
    const to = r.nodeKeys[r.edgeTo[e]];
    edges[e] = { from, to, importInfo: importInfos[r.edgeImport[e]] };
    adjacencyList.get(from)?.add(to);
  }

  const violations: Violation[] = r.violations.map((v) => ({
    code: v.code,
    file: v.file,
    line: v.line,
    col: v.col,
    message: v.message,
  }));

  return {
    files,
    graph: { nodes, edges, adjacencyList, normalizedToOriginalPath },
    parseResults,
    violations,
    timingsMs: r.timingsMs,
  };
}
