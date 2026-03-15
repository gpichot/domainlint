import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FeatureBoundariesConfig } from '../config/types.js';
import type { GraphQuery } from '../graph/graph-query.js';
import type { DependencyGraph, Violation } from '../graph/types.js';

export interface CustomRuleResult {
  code?: string;
  file: string;
  line: number;
  col: number;
  message: string;
}

export type EmitViolation = (result: CustomRuleResult) => void;

export interface CustomRuleContext {
  graph: DependencyGraph;
  query: GraphQuery;
  config: FeatureBoundariesConfig;
  emitViolation: EmitViolation;
}

export interface CustomRule {
  name: string;
  check(context: CustomRuleContext): void | Promise<void>;
}

export interface CustomRulesModule {
  rules: CustomRule[];
}

const DEFAULT_RULES_FILES = ['domainlint.rules.ts', 'domainlint.rules.js'];

export async function findRulesFile(
  rootDir: string,
  configRulesFile?: string,
): Promise<string | null> {
  if (configRulesFile) {
    const fullPath = resolve(rootDir, configRulesFile);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      throw new Error(`Custom rules file not found: ${fullPath}`);
    }
  }

  for (const filename of DEFAULT_RULES_FILES) {
    const fullPath = resolve(rootDir, filename);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // Continue to next
    }
  }

  return null;
}

export async function loadCustomRules(
  rulesFilePath: string,
): Promise<CustomRule[]> {
  const fileUrl = pathToFileURL(rulesFilePath).href;

  let mod: unknown;
  try {
    mod = await import(fileUrl);
  } catch (error) {
    throw new Error(
      `Failed to load custom rules from ${rulesFilePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const module = mod as Record<string, unknown>;

  if (!module.rules || !Array.isArray(module.rules)) {
    throw new Error(
      `Custom rules file ${rulesFilePath} must export a "rules" array`,
    );
  }

  const rules = module.rules as unknown[];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>;
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Custom rule at index ${i} must be an object`);
    }
    if (typeof rule.name !== 'string' || rule.name.length === 0) {
      throw new Error(
        `Custom rule at index ${i} must have a non-empty "name" string`,
      );
    }
    if (typeof rule.check !== 'function') {
      throw new Error(
        `Custom rule "${rule.name}" must have a "check" function`,
      );
    }
  }

  return module.rules as CustomRule[];
}

export async function runCustomRules(
  rules: CustomRule[],
  context: Omit<CustomRuleContext, 'emitViolation'>,
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const rule of rules) {
    const defaultCode = `CUSTOM_${rule.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

    const emitViolation: EmitViolation = (result) => {
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
        `Custom rule "${rule.name}" threw an error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return violations;
}
