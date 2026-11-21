// Publish-time step: adds the per-platform addon packages (`npm/<platform>/`) to this
// package's `optionalDependencies`, pinned to the same version.
//
// They are deliberately NOT committed in package.json: the platform packages only exist on
// npm after a release has published them, so a committed `optionalDependencies` entry would make
// `pnpm install --frozen-lockfile` fail (lockfile mismatch / 404) on every branch, including the
// release-please PR that bumps the version. The release workflow runs this right before
// `pnpm publish`, and only modifies the working tree (never committed).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const optionalDependencies = {};
for (const dir of readdirSync(join(root, 'npm'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const platform = JSON.parse(
    readFileSync(join(root, 'npm', dir.name, 'package.json'), 'utf8'),
  );
  if (platform.version !== pkg.version) {
    console.error(
      `${platform.name} is at ${platform.version}, expected ${pkg.version}`,
    );
    process.exit(1);
  }
  optionalDependencies[platform.name] = platform.version;
}

pkg.optionalDependencies = Object.fromEntries(
  Object.entries(optionalDependencies).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `optionalDependencies: ${Object.keys(pkg.optionalDependencies).join(', ')}`,
);
