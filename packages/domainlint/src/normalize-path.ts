/**
 * Normalize a file path to always use forward slashes.
 * On Windows, node:path functions return backslash-separated paths,
 * but we normalize to forward slashes for consistent cross-platform behavior.
 */
export function normalizePath(p: string): string {
  return p.replaceAll('\\', '/');
}
