import { afterEach, describe, expect, it } from 'vitest';
import { expectedBindingPackage, loadNativeBinding } from './native-binding.js';

const original = {
  platform: process.platform,
  arch: process.arch,
};

function stubProcess(platform: string, arch: string) {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

describe('expectedBindingPackage', () => {
  afterEach(() => {
    stubProcess(original.platform, original.arch);
  });

  it('names the macOS package after platform and arch', () => {
    stubProcess('darwin', 'arm64');
    expect(expectedBindingPackage()).toBe('domainlint-binding-darwin-arm64');
  });

  it('uses the msvc package on Windows', () => {
    stubProcess('win32', 'x64');
    expect(expectedBindingPackage()).toBe('domainlint-binding-win32-x64-msvc');
  });

  it('includes the libc flavour on Linux', () => {
    stubProcess('linux', 'arm64');
    expect(expectedBindingPackage()).toMatch(
      /^domainlint-binding-linux-arm64-(gnu|musl)$/,
    );
  });
});

describe('loadNativeBinding', () => {
  it('loads the addon once and caches it', () => {
    const first = loadNativeBinding();
    expect(typeof first.lint).toBe('function');
    expect(loadNativeBinding()).toBe(first);
  });
});
