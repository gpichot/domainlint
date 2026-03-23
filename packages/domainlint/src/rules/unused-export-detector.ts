import type { Rule } from './rules.js';

export const unusedExportRule: Rule = {
  name: 'unused-exports',
  check({ graph, config, emitViolation }) {
    const nodeExports = graph.nodeExports;
    if (!nodeExports) return;

    // Build a map: nodeKey -> set of export names that are consumed by importers
    const usedExports = new Map<string, Set<string>>();

    for (const edge of graph.edges) {
      const importedNames = edge.importInfo.importedNames;
      if (!importedNames) continue;

      if (!usedExports.has(edge.to)) {
        usedExports.set(edge.to, new Set());
      }
      const used = usedExports.get(edge.to)!;

      for (const sym of importedNames) {
        if (sym.isNamespace) {
          // `import * as ns` or `export * from` — all exports are considered used
          used.add('*');
        } else {
          used.add(sym.name);
        }
      }
    }

    for (const [nodeKey, exportedSymbols] of nodeExports) {
      const originalPath =
        graph.normalizedToOriginalPath?.get(nodeKey) ?? nodeKey;

      // Skip barrel files — they re-export and are public API entry points
      const relativeToPkg = originalPath.startsWith(config.featuresDir)
        ? originalPath.slice(config.featuresDir.length + 1)
        : null;

      if (relativeToPkg) {
        const parts = relativeToPkg.split('/');
        if (parts.length >= 2) {
          const fileName = parts.slice(1).join('/');
          if (config.barrelFiles.includes(fileName)) {
            continue;
          }
        }
      }

      const used = usedExports.get(nodeKey);

      // If the file has a namespace import (import * as), all exports are used
      if (used?.has('*')) continue;

      // If the file has wildcard re-exports, we can't know what's unused
      const hasWildcardExport = exportedSymbols.some((s) => s.name === '*');
      if (hasWildcardExport) continue;

      for (const exported of exportedSymbols) {
        if (exported.name === '*') continue;

        if (!used || !used.has(exported.name)) {
          emitViolation({
            code: 'ARCH_UNUSED_EXPORT',
            file: originalPath,
            line: exported.line,
            col: exported.col,
            message: `Export "${exported.name}" in "${originalPath}" is not imported by any other file in the project.`,
          });
        }
      }
    }
  },
};
