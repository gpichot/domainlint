import { parseSync } from 'oxc-parser';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type { ImportInfo, ParseResult } from './types.js';

/**
 * Convert a 0-based byte offset into a 1-based line and column.
 */
function offsetToLineCol(
  content: string,
  offset: number,
): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export async function parseFile(
  filePath: string,
  config: FeatureBoundariesConfig,
  fs: FileSystem = nodeFileSystem,
): Promise<ParseResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const imports: ImportInfo[] = [];

  try {
    const result = parseSync(filePath, content, {
      sourceType: 'module',
    });

    if (result.errors.length > 0) {
      // Only throw on fatal parse errors (not recoverable warnings)
      const fatalErrors = result.errors.filter(
        (e) => e.severity === 'Error' || !('severity' in e),
      );
      if (fatalErrors.length > 0) {
        throw new Error(fatalErrors[0].message);
      }
    }

    const mod = result.module;

    // Static imports
    for (const imp of mod.staticImports) {
      const isTypeOnly =
        imp.entries.length > 0 && imp.entries.every((e) => e.isType);
      const { line, col } = offsetToLineCol(content, imp.start);
      imports.push({
        specifier: imp.moduleRequest.value,
        line,
        col,
        isDynamic: false,
        isTypeOnly,
      });
    }

    // Re-exports (export * from '...' and export { x } from '...')
    // In oxc-parser, moduleRequest is on each entry, not on the export itself.
    // We group by export statement and emit one import per re-export statement.
    for (const exp of mod.staticExports) {
      // Check if any entry has a moduleRequest (re-export vs local export)
      const reExportEntries = exp.entries.filter((e) => e.moduleRequest);
      if (reExportEntries.length > 0) {
        const specifier = reExportEntries[0].moduleRequest!.value;
        const isTypeOnly = reExportEntries.every((e) => e.isType);
        const { line, col } = offsetToLineCol(content, exp.start);
        imports.push({
          specifier,
          line,
          col,
          isDynamic: false,
          isTypeOnly,
        });
      }
    }

    // Dynamic imports
    if (config.includeDynamicImports) {
      for (const dyn of mod.dynamicImports) {
        if (dyn.moduleRequest) {
          // moduleRequest span includes quotes, strip them
          const raw = content.slice(
            dyn.moduleRequest.start,
            dyn.moduleRequest.end,
          );
          const specifier = stripQuotes(raw);
          if (specifier) {
            const { line, col } = offsetToLineCol(content, dyn.start);
            imports.push({
              specifier,
              line,
              col,
              isDynamic: true,
              isTypeOnly: false,
            });
          }
        }
      }
    }

    return { filePath, imports };
  } catch (error) {
    throw new Error(
      `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Strip surrounding quotes from a string literal span.
 */
function stripQuotes(raw: string): string | null {
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }
  // Template literal or expression — not a static specifier
  return null;
}
