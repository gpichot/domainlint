import type { Rule } from './rules.js';

export const unusedFileRule: Rule = {
  name: 'unused-files',
  check({ graph, config, emitViolation }) {
    // Build reverse adjacency list to find files with no importers
    const importedFiles = new Set<string>();
    for (const edge of graph.edges) {
      importedFiles.add(edge.to);
    }

    for (const node of graph.nodes) {
      // Skip files that are imported by someone
      if (importedFiles.has(node)) continue;

      const originalPath = graph.normalizedToOriginalPath?.get(node) ?? node;

      // Skip barrel files — they are entry points by definition
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

      emitViolation({
        code: 'ARCH_UNUSED_FILE',
        file: originalPath,
        line: 1,
        col: 1,
        message: `File "${originalPath}" is not imported by any other file in the project.`,
      });
    }
  },
};
