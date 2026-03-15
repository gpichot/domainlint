/**
 * Normalize a file path to always use forward (POSIX) slashes and strip
 * Windows drive-letter prefixes (e.g. "D:\project" → "/project").
 *
 * On Windows, `path.resolve('/project', '.')` returns `D:\project` because
 * the OS qualifies bare-root paths with the current drive letter. Stripping
 * it is safe because Node.js maps `/`-rooted paths to the current drive.
 */
export function normalizePath(p: string): string {
  return p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');
}
