import { relative, sep } from 'node:path';

/**
 * Converts a native path to use `/` separators (a no-op on POSIX). Used for
 * everything that is displayed or matched against `/`-based glob patterns.
 */
export function toPosix(p: string, pathSep: string = sep): string {
  return pathSep === '/' ? p : p.split(pathSep).join('/');
}

/** `path.relative(from, to)` with `/` separators. */
export function relativePosix(from: string, to: string): string {
  return toPosix(relative(from, to));
}

/**
 * Replaces `rootDir` with `.` in every absolute path of `message`, and shows
 * the rest of each path with `/` separators (they are `\` on Windows).
 */
export function replaceRootDir(
  message: string,
  rootDir: string,
  pathSep: string = sep,
): string {
  const escaped = rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(
    new RegExp(`${escaped}([^\\s"'<>|*?]*)`, 'g'),
    (_, rest: string) => `.${toPosix(rest, pathSep)}`,
  );
}
