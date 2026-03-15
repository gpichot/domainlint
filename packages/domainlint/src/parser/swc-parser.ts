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
    extractImports(ast, imports, config);

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
): void {
  for (const item of ast.body) {
    switch (item.type) {
      case 'ImportDeclaration':
        handleImportDeclaration(item, imports);
        break;

      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        handleExportDeclaration(item, imports);
        break;

      case 'ExpressionStatement':
        // Check for dynamic imports in expression statements
        if (config.includeDynamicImports) {
          extractDynamicImports(item.expression, imports);
        }
        break;

      case 'VariableDeclaration':
        // Check for dynamic imports in variable declarations
        if (config.includeDynamicImports) {
          for (const decl of item.declarations) {
            if (decl.init) {
              extractDynamicImports(decl.init, imports);
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
): void {
  if (node.source.type === 'StringLiteral') {
    imports.push({
      specifier: node.source.value,
      line: (node.span.start as any)?.line || 1,
      col: (node.span.start as any)?.column || 1,
      isDynamic: false,
      isTypeOnly: node.typeOnly || false,
    });
  }
}

function handleExportDeclaration(
  node: ExportAllDeclaration | ExportNamedDeclaration,
  imports: ImportInfo[],
): void {
  if (node.source?.type === 'StringLiteral') {
    imports.push({
      specifier: node.source.value,
      line: (node.span.start as any)?.line || 1,
      col: (node.span.start as any)?.column || 1,
      isDynamic: false,
      isTypeOnly:
        (node.type === 'ExportNamedDeclaration' && node.typeOnly) || false,
    });
  }
}

function extractDynamicImports(node: any, imports: ImportInfo[]): void {
  if (!node) return;

  // Check for import() calls
  if (node.type === 'CallExpression') {
    const callExpr = node as CallExpression;
    if (callExpr.callee.type === 'Import' && callExpr.arguments.length > 0) {
      const arg = callExpr.arguments[0];
      if (arg.expression?.type === 'StringLiteral') {
        imports.push({
          specifier: arg.expression.value,
          line: node.span.start.line,
          col: node.span.start.column,
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
          extractDynamicImports(item, imports);
        }
      }
    } else if (value && typeof value === 'object') {
      extractDynamicImports(value, imports);
    }
  }
}
