import { access } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PackageImportRestriction } from '../config/types.js';
import type { Violation } from '../graph/types.js';
import type { ImportInfo } from '../parser/types.js';
import type { WorkspacePackage } from '../workspace/workspace-detector.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface PackageImportEdge {
  /** Relative path of the importing package (from workspace root) */
  fromPackage: string;
  /** Relative path of the imported package (from workspace root) */
  toPackage: string;
  /** Absolute file path containing the import */
  file: string;
  /** Original import specifier */
  specifier: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  col: number;
}

export interface WorkspacePackageInfo {
  /** Package name from package.json */
  name: string;
  /** Absolute path to the package root */
  path: string;
  /** Path relative to workspace root */
  relPath: string;
}

export interface WorkspaceRuleContext {
  /** All workspace packages */
  packages: WorkspacePackageInfo[];
  /** Cross-package import edges */
  edges: PackageImportEdge[];
  /** Package import restrictions from config */
  packageRules: PackageImportRestriction[];
  /** Report a violation */
  emitViolation: (result: WorkspaceRuleResult) => void;
}

export interface WorkspaceRuleResult {
  code?: string;
  file: string;
  line: number;
  col: number;
  message: string;
}

export interface WorkspaceRule {
  name: string;
  check(context: WorkspaceRuleContext): void | Promise<void>;
}

// ── Graph building ─────────────────────────────────────────────────────

/**
 * Builds cross-package import edges from parsed file imports.
 */
export function buildPackageImportEdges(
  workspaceRoot: string,
  packages: WorkspacePackage[],
  fileImports: Map<string, ImportInfo[]>,
): PackageImportEdge[] {
  const edges: PackageImportEdge[] = [];

  // Build maps
  const packageNameToRelPath = new Map<string, string>();
  for (const pkg of packages) {
    packageNameToRelPath.set(pkg.name, relative(workspaceRoot, pkg.path));
  }

  // Map files → package rel paths (use trailing / to avoid prefix collisions)
  const fileToPackageRelPath = new Map<string, string>();
  for (const pkg of packages) {
    const relPath = relative(workspaceRoot, pkg.path);
    const prefix = `${pkg.path}/`;
    for (const filePath of fileImports.keys()) {
      if (filePath.startsWith(prefix)) {
        fileToPackageRelPath.set(filePath, relPath);
      }
    }
  }

  for (const [filePath, imports] of fileImports) {
    const fromPackage = fileToPackageRelPath.get(filePath);
    if (!fromPackage) continue;

    for (const imp of imports) {
      const targetPkgName = findMatchingPackageName(imp.specifier, packages);
      if (!targetPkgName) continue;

      const toPackage = packageNameToRelPath.get(targetPkgName);
      if (!toPackage || toPackage === fromPackage) continue;

      edges.push({
        fromPackage,
        toPackage,
        file: filePath,
        specifier: imp.specifier,
        line: imp.line,
        col: imp.col,
      });
    }
  }

  return edges;
}

// ── Rule execution ─────────────────────────────────────────────────────

export async function runWorkspaceRules(
  rules: WorkspaceRule[],
  context: Omit<WorkspaceRuleContext, 'emitViolation'>,
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const rule of rules) {
    const defaultCode = `CUSTOM_${rule.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

    const emitViolation = (result: WorkspaceRuleResult) => {
      violations.push({
        code: result.code || defaultCode,
        file: result.file,
        line: result.line,
        col: result.col,
        message: result.message,
      });
    };

    try {
      await rule.check({ ...context, emitViolation });
    } catch (error) {
      throw new Error(
        `Workspace rule "${rule.name}" threw an error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return violations;
}

// ── Custom workspace rule loading ──────────────────────────────────────

const DEFAULT_RULES_FILES = ['domainlint.rules.ts', 'domainlint.rules.js'];

export async function loadWorkspaceRules(
  rootDir: string,
  configRulesFile?: string,
): Promise<WorkspaceRule[]> {
  const filePath = await findWorkspaceRulesFile(rootDir, configRulesFile);
  if (!filePath) return [];

  const fileUrl = pathToFileURL(filePath).href;

  let mod: unknown;
  try {
    mod = await import(fileUrl);
  } catch (error) {
    throw new Error(
      `Failed to load workspace rules from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const module = mod as Record<string, unknown>;

  // Workspace rules are exported as `workspaceRules`
  if (!module.workspaceRules || !Array.isArray(module.workspaceRules)) {
    return [];
  }

  const rules = module.workspaceRules as unknown[];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>;
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Workspace rule at index ${i} must be an object`);
    }
    if (typeof rule.name !== 'string' || rule.name.length === 0) {
      throw new Error(
        `Workspace rule at index ${i} must have a non-empty "name" string`,
      );
    }
    if (typeof rule.check !== 'function') {
      throw new Error(
        `Workspace rule "${rule.name}" must have a "check" function`,
      );
    }
  }

  return module.workspaceRules as WorkspaceRule[];
}

async function findWorkspaceRulesFile(
  rootDir: string,
  configRulesFile?: string,
): Promise<string | null> {
  if (configRulesFile) {
    const fullPath = resolve(rootDir, configRulesFile);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      throw new Error(`Package rules file not found: ${fullPath}`);
    }
  }

  for (const filename of DEFAULT_RULES_FILES) {
    const fullPath = resolve(rootDir, filename);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // Continue
    }
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function findMatchingPackageName(
  specifier: string,
  packages: WorkspacePackage[],
): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) {
    return null;
  }

  for (const pkg of packages) {
    if (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) {
      return pkg.name;
    }
  }

  return null;
}
