import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePosix, replaceRootDir, toPosix } from './path-utils.js';

describe('toPosix', () => {
  it('converts the given separator to "/"', () => {
    expect(toPosix('packages\\core\\src', '\\')).toBe('packages/core/src');
    expect(
      toPosix(win32.relative('C:\\ws', 'C:\\ws\\packages\\core'), '\\'),
    ).toBe('packages/core');
  });

  it('leaves POSIX paths untouched', () => {
    expect(toPosix('packages/core', '/')).toBe('packages/core');
    expect(toPosix('a\\b', '/')).toBe('a\\b');
  });
});

describe('relativePosix', () => {
  it('returns a "/"-separated relative path on every platform', () => {
    expect(relativePosix('/ws', '/ws/packages/core')).toBe('packages/core');
  });
});

describe('replaceRootDir', () => {
  it('replaces the root and normalises Windows separators in cycle messages', () => {
    const msg =
      'Import cycle detected: C:\\proj\\src\\a.ts -> C:\\proj\\src\\b.ts -> C:\\proj\\src\\a.ts';
    expect(replaceRootDir(msg, 'C:\\proj', '\\')).toBe(
      'Import cycle detected: ./src/a.ts -> ./src/b.ts -> ./src/a.ts',
    );
  });

  it('handles quoted paths and POSIX roots', () => {
    expect(
      replaceRootDir('Import "../b" resolves to "/p/src/b.ts" but', '/p', '/'),
    ).toBe('Import "../b" resolves to "./src/b.ts" but');
  });
});
