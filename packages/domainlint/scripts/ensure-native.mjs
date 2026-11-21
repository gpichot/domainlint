// Makes sure the native addon exists before the tests run: builds it with
// `pnpm build:native` when no locally built `native/domainlint.*.node` is present
// (needs a Rust toolchain). A no-op when the addon is already built.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = join(root, 'native');
const built =
  existsSync(join(nativeDir, 'binding.cjs')) &&
  readdirSync(nativeDir).some((f) => /^domainlint\..*\.node$/.test(f));

if (!built) {
  console.log('native addon not built; running `pnpm build:native`...');
  const r = spawnSync('pnpm', ['run', 'build:native'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(
      'Could not build the native addon. Install Rust (https://rustup.rs) and run `pnpm --filter domainlint build:native`.',
    );
    process.exit(r.status ?? 1);
  }
}
