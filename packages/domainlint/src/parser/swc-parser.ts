import { parseSync } from '@swc/core';
import type {
  CallExpression,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  Program,
} from '@swc/types';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type { ImportInfo, ParseResult } from './types.js';

/**
 * Convert a byte offset from SWC's span into a 1-based line and column.
 * SWC byte positions are cumulative across parseSync calls and 1-based,
 * so we subtract the program's span.start to get a 0-based file offset.
 */
function offsetToLineCol(
  content: string,
  offset: number,
  baseOffset: number,
): { line: number; col: number } {
  const zeroBasedOffset = offset - baseOffset;
  let line = 1;
  let col = 1;
  for (let i = 0; i < zeroBasedOffset && i < content.length; i++) {
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
    const ast = parseSync(content, {
      syntax:
        filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
          ? 'typescript'
          : 'typescript',
      tsx: filePath.endsWith('.tsx') || filePath.endsWith('.jsx'),
      decorators: true,
    });

    // Extract imports from AST
    // SWC byte positions are cumulative across parseSync calls.
    // ast.span covers [firstToken, lastToken), so we compute the file's
    // first-byte position as end - content.length.
    const baseOffset = ast.span.end - content.length;
    extractImports(ast, imports, config, content, baseOffset);

    return {
      filePath,
      imports,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractImports(
  ast: Program,
  imports: ImportInfo[],
  config: FeatureBoundariesConfig,
  content: string,
  baseOffset: number,
): void {
  for (const item of ast.body) {
    switch (item.type) {
      case 'ImportDeclaration':
        handleImportDeclaration(item, imports, content, baseOffset);
        break;

      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        handleExportDeclaration(item, imports, content, baseOffset);
        break;

      case 'ExpressionStatement':
        // Check for dynamic imports in expression statements
        if (config.includeDynamicImports) {
          extractDynamicImports(item.expression, imports, content, baseOffset);
        }
        break;

      case 'VariableDeclaration':
        // Check for dynamic imports in variable declarations
        if (config.includeDynamicImports) {
          for (const decl of item.declarations) {
            if (decl.init) {
              extractDynamicImports(decl.init, imports, content, baseOffset);
            }
          }
        }
        break;
    }
  }
}

function handleImportDeclaration(
  node: ImportDeclaration,
  imports: ImportInfo[],
  content: string,
  baseOffset: number,
): void {
  if (node.source.type === 'StringLiteral') {
    const { line, col } = offsetToLineCol(content, node.span.start, baseOffset);
    imports.push({
      specifier: node.source.value,
      line,
      col,
      isDynamic: false,
      isTypeOnly: node.typeOnly || false,
    });
  }
}

function handleExportDeclaration(
  node: ExportAllDeclaration | ExportNamedDeclaration,
  imports: ImportInfo[],
  content: string,
  baseOffset: number,
): void {
  if (node.source?.type === 'StringLiteral') {
    const { line, col } = offsetToLineCol(content, node.span.start, baseOffset);
    imports.push({
      specifier: node.source.value,
      line,
      col,
      isDynamic: false,
      isTypeOnly:
        (node.type === 'ExportNamedDeclaration' && node.typeOnly) || false,
    });
  }
}

function extractDynamicImports(
  node: any,
  imports: ImportInfo[],
  content: string,
  baseOffset: number,
): void {
  if (!node) return;

  // Check for import() calls
  if (node.type === 'CallExpression') {
    const callExpr = node as CallExpression;
    if (callExpr.callee.type === 'Import' && callExpr.arguments.length > 0) {
      const arg = callExpr.arguments[0];
      if (arg.expression?.type === 'StringLiteral') {
        const { line, col } = offsetToLineCol(
          content,
          node.span.start,
          baseOffset,
        );
        imports.push({
          specifier: arg.expression.value,
          line,
          col,
          isDynamic: true,
          isTypeOnly: false,
        });
      }
    }
  }

  // Recursively search in object properties, array elements, etc.
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          extractDynamicImports(item, imports, content, baseOffset);
        }
      }
    } else if (value && typeof value === 'object') {
      extractDynamicImports(value, imports, content, baseOffset);
    }
  }
}
