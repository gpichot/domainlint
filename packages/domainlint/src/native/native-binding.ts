import { createRequire } from 'node:module';

/**
 * Typed view of the addon built from `crates/domainlint-graph-napi`
 * (the generated, authoritative declarations are in `native/binding.d.ts`,
 * produced by `pnpm build:native`; they live outside `src/` so `tsc` does not
 * need Rust, hence this hand-written mirror).
 */
export interface NativeLintOptions {
  rootDir: string;
  srcDir: string;
  featuresDir: string;
  barrelFiles: string[];
  extensions: string[];
  exclude: string[];
  includeDynamicImports: boolean;
  tsconfigPath: string;
  computeCycles: boolean;
  computeCrossFeature: boolean;
  computeNonDomain: boolean;
}

export interface NativeViolation {
  code: string;
  file: string;
  line: number;
  col: number;
  message: string;
}

export interface NativeTimings {
  walk: number;
  readParse: number;
  resolve: number;
  graphBuild: number;
  cycles: number;
  boundaries: number;
  total: number;
}

export interface NativeLintResult {
  files: string[];
  nodeKeys: string[];
  features: string[];
  fileFeature: Int32Array;
  fileIsBarrel: Uint8Array;
  importOffsets: Uint32Array;
  importSpecifier: Uint32Array;
  importLine: Uint32Array;
  importCol: Uint32Array;
  /** bit 0 = type-only, bit 1 = dynamic */
  importFlags: Uint8Array;
  specifiers: string[];
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  edgeImport: Uint32Array;
  violations: NativeViolation[];
  timingsMs: NativeTimings;
}

export interface NativeImport {
  specifier: string;
  line: number;
  col: number;
  isTypeOnly: boolean;
  isDynamic: boolean;
}

export interface NativeBinding {
  lint(options: NativeLintOptions): NativeLintResult;
  parseImports(options: NativeLintOptions, filePath: string): NativeImport[];
  resolveImports(
    options: NativeLintOptions,
    fromFile: string,
    specifiers: string[],
  ): Array<string | null>;
}

function detectLibc(): 'gnu' | 'musl' | null {
  if (process.platform !== 'linux') return null;
  try {
    const report = process.report?.getReport() as unknown as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
  } catch {
    return null;
  }
}

/** The platform package that should provide the addon, e.g. `domainlint-binding-linux-x64-gnu`. */
export function expectedBindingPackage(): string {
  const { platform, arch } = process;
  const libc = detectLibc();
  switch (platform) {
    case 'linux':
      return `domainlint-binding-linux-${arch}-${libc ?? 'gnu'}`;
    case 'win32':
      return `domainlint-binding-win32-${arch}-msvc`;
    default:
      return `domainlint-binding-${platform}-${arch}`;
  }
}

let cached: NativeBinding | undefined;

/**
 * Loads the native addon (lazily, once). Looks for a locally built
 * `native/domainlint.<platform>.node` first, then for the platform package
 * (`domainlint-binding-<platform>`, installed as an optional dependency).
 */
export function loadNativeBinding(): NativeBinding {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  try {
    cached = require('../../native/binding.cjs') as NativeBinding;
    return cached;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const libc = detectLibc();
    throw new Error(
      [
        'Failed to load the domainlint native addon.',
        `Platform: ${process.platform}-${process.arch}${libc ? `-${libc}` : ''} (Node ${process.version}).`,
        `Expected the optional dependency "${expectedBindingPackage()}" to be installed` +
          ' (reinstall without --no-optional / --omit=optional, or check that your platform is supported).',
        'To build from source: install Rust (https://rustup.rs), then run' +
          ' `pnpm --filter domainlint build:native` in the domainlint repository.',
        `Underlying error: ${reason.split('\n')[0]}`,
      ].join('\n'),
    );
  }
}
