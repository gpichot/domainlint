import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { glob } from 'glob';
import { parse as parseJsonc } from 'jsonc-parser';

export interface WorkspacePackage {
  /** Absolute path to the package root */
  path: string;
  /** Package name from package.json */
  name: string;
}

export interface WorkspaceInfo {
  /** Absolute path to the workspace root */
  root: string;
  /** Detected workspace type */
  type: 'pnpm' | 'npm' | 'yarn';
  /** Discovered packages */
  packages: WorkspacePackage[];
}

/**
 * Detects workspace configuration from a project root.
 * Checks pnpm-workspace.yaml, then package.json "workspaces" field.
 * Returns null if no workspace is detected.
 */
export async function detectWorkspace(
  projectPath: string,
): Promise<WorkspaceInfo | null> {
  const root = resolve(projectPath);

  // 1. Try pnpm-workspace.yaml
  const pnpmResult = await detectPnpmWorkspace(root);
  if (pnpmResult) return pnpmResult;

  // 2. Try package.json "workspaces" field (npm & yarn)
  const npmResult = await detectNpmWorkspace(root);
  if (npmResult) return npmResult;

  return null;
}

async function detectPnpmWorkspace(
  root: string,
): Promise<WorkspaceInfo | null> {
  try {
    const content = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf-8');
    const patterns = parsePnpmWorkspaceYaml(content);
    if (patterns.length === 0) return null;

    const packages = await resolvePackages(root, patterns);
    return { root, type: 'pnpm', packages };
  } catch {
    return null;
  }
}

async function detectNpmWorkspace(root: string): Promise<WorkspaceInfo | null> {
  try {
    const content = await readFile(join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);

    let patterns: string[];
    if (Array.isArray(pkg.workspaces)) {
      patterns = pkg.workspaces;
    } else if (
      pkg.workspaces?.packages &&
      Array.isArray(pkg.workspaces.packages)
    ) {
      // Yarn classic format: { "workspaces": { "packages": ["packages/*"] } }
      patterns = pkg.workspaces.packages;
    } else {
      return null;
    }

    if (patterns.length === 0) return null;

    const packages = await resolvePackages(root, patterns);

    // Determine if it's yarn or npm based on lock file
    const type = await detectYarnOrNpm(root);
    return { root, type, packages };
  } catch {
    return null;
  }
}

async function detectYarnOrNpm(root: string): Promise<'npm' | 'yarn'> {
  try {
    await readFile(join(root, 'yarn.lock'), 'utf-8');
    return 'yarn';
  } catch {
    return 'npm';
  }
}

/**
 * Parses pnpm-workspace.yaml to extract package glob patterns.
 * Handles the simple "packages:" list format without a full YAML parser.
 */
export function parsePnpmWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split('\n');
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }

    // Stop if we hit another top-level key
    if (
      inPackages &&
      !trimmed.startsWith('-') &&
      trimmed.length > 0 &&
      !trimmed.startsWith('#')
    ) {
      break;
    }

    if (inPackages && trimmed.startsWith('-')) {
      // Extract the pattern, removing quotes if present
      let pattern = trimmed.slice(1).trim();
      pattern = pattern.replace(/^['"]|['"]$/g, '');
      if (pattern) {
        patterns.push(pattern);
      }
    }
  }

  return patterns;
}

/**
 * Resolves glob patterns to actual package directories.
 * Only includes directories that contain a package.json with a "name" field.
 */
async function resolvePackages(
  root: string,
  patterns: string[],
): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Skip negation patterns
    if (pattern.startsWith('!')) continue;

    const matches = await glob(pattern, {
      cwd: root,
      absolute: true,
      nodir: false,
    });

    for (const match of matches) {
      const absPath = resolve(match);
      if (seen.has(absPath)) continue;
      seen.add(absPath);

      try {
        const pkgContent = await readFile(
          join(absPath, 'package.json'),
          'utf-8',
        );
        const pkg = JSON.parse(pkgContent);
        if (pkg.name) {
          packages.push({ path: absPath, name: pkg.name });
        }
      } catch {
        // Not a package directory — skip
      }
    }
  }

  // Sort by name for deterministic output
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}
