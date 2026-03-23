import { parseSync } from '@swc/core';
import type {
  CallExpression,
  Declaration,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ModuleExportName,
  Pattern,
  Program,
  VariableDeclarator,
} from '@swc/types';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { type FileSystem, nodeFileSystem } from '../fs.js';
import type {
  ExportedSymbol,
  ImportedSymbol,
  ImportInfo,
  ParseResult,
} from './types.js';

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

function getModuleExportName(node: ModuleExportName): string {
  return node.type === 'Identifier' ? node.value : node.value;
}

function extractBindingNames(pattern: Pattern): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.value];
    case 'ArrayPattern':
      return pattern.elements.flatMap((el) =>
        el ? extractBindingNames(el) : [],
      );
    case 'ObjectPattern':
      return pattern.properties.flatMap((prop) => {
        if (prop.type === 'RestElement') {
          return extractBindingNames(prop.argument);
        }
        if (prop.type === 'KeyValuePatternProperty') {
          return extractBindingNames(prop.value);
        }
        // AssignmentPatternProperty: { key } or { key = value }
        return [prop.key.value];
      });
    case 'RestElement':
      return extractBindingNames(pattern.argument);
    case 'AssignmentPattern':
      return extractBindingNames(pattern.left);
    default:
      return [];
  }
}

export async function parseFile(
  filePath: string,
  config: FeatureBoundariesConfig,
  fs: FileSystem = nodeFileSystem,
): Promise<ParseResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const imports: ImportInfo[] = [];
  const exports: ExportedSymbol[] = [];

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
    extractImportsAndExports(
      ast,
      imports,
      exports,
      config,
      content,
      baseOffset,
    );

    return {
      filePath,
      imports,
      exports,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractImportsAndExports(
  ast: Program,
  imports: ImportInfo[],
  exports: ExportedSymbol[],
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
        handleExportAllDeclaration(item, imports, exports, content, baseOffset);
        break;

      case 'ExportNamedDeclaration':
        handleExportNamedDeclaration(
          item,
          imports,
          exports,
          content,
          baseOffset,
        );
        break;

      case 'ExportDefaultDeclaration':
      case 'ExportDefaultExpression': {
        const { line, col } = offsetToLineCol(
          content,
          item.span.start,
          baseOffset,
        );
        exports.push({
          name: 'default',
          line,
          col,
          isTypeOnly: false,
        });
        break;
      }

      case 'ExportDeclaration':
        handleExportDeclaration(
          item.declaration,
          exports,
          content,
          baseOffset,
          item.span.start,
        );
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
    const importedNames: ImportedSymbol[] = [];

    for (const specifier of node.specifiers) {
      switch (specifier.type) {
        case 'ImportDefaultSpecifier':
          importedNames.push({ name: 'default', isNamespace: false });
          break;
        case 'ImportNamespaceSpecifier':
          importedNames.push({ name: '*', isNamespace: true });
          break;
        case 'ImportSpecifier': {
          const importedName = specifier.imported
            ? getModuleExportName(specifier.imported)
            : specifier.local.value;
          importedNames.push({ name: importedName, isNamespace: false });
          break;
        }
      }
    }

    imports.push({
      specifier: node.source.value,
      line,
      col,
      isDynamic: false,
      isTypeOnly: node.typeOnly || false,
      importedNames: importedNames.length > 0 ? importedNames : undefined,
    });
  }
}

function handleExportAllDeclaration(
  node: ExportAllDeclaration,
  imports: ImportInfo[],
  exports: ExportedSymbol[],
  content: string,
  baseOffset: number,
): void {
  const { line, col } = offsetToLineCol(content, node.span.start, baseOffset);
  // `export * from 'source'` — re-exports everything
  if (node.source?.type === 'StringLiteral') {
    imports.push({
      specifier: node.source.value,
      line,
      col,
      isDynamic: false,
      isTypeOnly: false,
      importedNames: [{ name: '*', isNamespace: true }],
    });
    // The file re-exports all symbols from the source — we mark this as a wildcard re-export
    exports.push({
      name: '*',
      line,
      col,
      isTypeOnly: false,
    });
  }
}

function handleExportNamedDeclaration(
  node: ExportNamedDeclaration,
  imports: ImportInfo[],
  exports: ExportedSymbol[],
  content: string,
  baseOffset: number,
): void {
  const { line, col } = offsetToLineCol(content, node.span.start, baseOffset);

  if (node.source?.type === 'StringLiteral') {
    // Re-export: `export { foo } from 'source'`
    const importedNames: ImportedSymbol[] = [];
    for (const specifier of node.specifiers) {
      switch (specifier.type) {
        case 'ExportSpecifier': {
          const origName = getModuleExportName(specifier.orig);
          const exportedName = specifier.exported
            ? getModuleExportName(specifier.exported)
            : origName;
          importedNames.push({ name: origName, isNamespace: false });
          exports.push({
            name: exportedName,
            line,
            col,
            isTypeOnly: node.typeOnly || specifier.isTypeOnly || false,
          });
          break;
        }
        case 'ExportNamespaceSpecifier': {
          const exportedName = getModuleExportName(specifier.name);
          importedNames.push({ name: '*', isNamespace: true });
          exports.push({
            name: exportedName,
            line,
            col,
            isTypeOnly: node.typeOnly || false,
          });
          break;
        }
        case 'ExportDefaultSpecifier':
          importedNames.push({ name: 'default', isNamespace: false });
          exports.push({
            name: specifier.exported.value,
            line,
            col,
            isTypeOnly: node.typeOnly || false,
          });
          break;
      }
    }

    imports.push({
      specifier: node.source.value,
      line,
      col,
      isDynamic: false,
      isTypeOnly: node.typeOnly || false,
      importedNames: importedNames.length > 0 ? importedNames : undefined,
    });
  } else {
    // Local export: `export { foo, bar }`
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ExportSpecifier') {
        const exportedName = specifier.exported
          ? getModuleExportName(specifier.exported)
          : getModuleExportName(specifier.orig);
        exports.push({
          name: exportedName,
          line,
          col,
          isTypeOnly: node.typeOnly || specifier.isTypeOnly || false,
        });
      }
    }
  }
}

function handleExportDeclaration(
  declaration: Declaration,
  exports: ExportedSymbol[],
  content: string,
  baseOffset: number,
  spanStart: number,
): void {
  const { line, col } = offsetToLineCol(content, spanStart, baseOffset);

  switch (declaration.type) {
    case 'FunctionDeclaration':
      exports.push({
        name: declaration.identifier.value,
        line,
        col,
        isTypeOnly: false,
      });
      break;

    case 'ClassDeclaration':
      exports.push({
        name: declaration.identifier.value,
        line,
        col,
        isTypeOnly: false,
      });
      break;

    case 'VariableDeclaration':
      for (const declarator of declaration.declarations) {
        const names = extractBindingNames(declarator.id);
        for (const name of names) {
          exports.push({ name, line, col, isTypeOnly: false });
        }
      }
      break;

    case 'TsInterfaceDeclaration':
      exports.push({
        name: declaration.id.value,
        line,
        col,
        isTypeOnly: true,
      });
      break;

    case 'TsTypeAliasDeclaration':
      exports.push({
        name: declaration.id.value,
        line,
        col,
        isTypeOnly: true,
      });
      break;

    case 'TsEnumDeclaration':
      exports.push({
        name: declaration.id.value,
        line,
        col,
        isTypeOnly: false,
      });
      break;

    case 'TsModuleDeclaration':
      if (declaration.id.type === 'Identifier') {
        exports.push({
          name: declaration.id.value,
          line,
          col,
          isTypeOnly: true,
        });
      }
      break;
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
