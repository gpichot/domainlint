#!/usr/bin/env node
// Generates a synthetic, deterministic feature-structured TypeScript project
// for benchmarking domainlint against other dependency-analysis tools.
//
// Usage: node benchmarks/generate.mjs <outDir> [--features 100] [--files 100] [--seed 42]
//
// Shape of the generated project:
//   src/features/f<N>/m<i>.ts   - modules importing up to 3 earlier siblings
//   src/features/f<N>/index.ts  - barrel
//   ~20% of modules import another feature through its barrel (allowed)
//   ~0.5% of modules deep-import another feature's internals (violation)
//   every 9th feature contains a 2-file import cycle (m1 <-> m2)
// Imports use a tsconfig path alias (`@/*`) so path resolution is exercised.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    features: { type: 'string', default: '100' },
    files: { type: 'string', default: '100' },
    seed: { type: 'string', default: '42' },
  },
});

const root = positionals[0];
if (!root) {
  console.error(
    'Usage: node benchmarks/generate.mjs <outDir> [--features N] [--files N] [--seed N]',
  );
  process.exit(1);
}

const featureCount = Number(values.features);
const filesPerFeature = Number(values.files);
let state = Number(values.seed);
const rand = (n) => {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state % n;
};

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

fs.rmSync(root, { recursive: true, force: true });

write(
  path.join(root, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
      },
      include: ['src'],
    },
    null,
    2,
  ),
);
write(
  path.join(root, 'package.json'),
  '{ "name": "domainlint-bench-fixture", "private": true, "type": "module" }\n',
);

let total = 0;
for (let f = 0; f < featureCount; f++) {
  const dir = path.join(root, 'src', 'features', `f${f}`);
  const hasCycle = f % 9 === 0 && filesPerFeature >= 3;

  for (let i = 0; i < filesPerFeature; i++) {
    const imports = new Set();
    for (let k = 0; k < 3; k++) {
      const j = rand(filesPerFeature);
      if (j < i) imports.add(`import { v${j} } from './m${j}';`);
    }
    if (rand(5) === 0) {
      const g = rand(featureCount);
      if (g !== f) imports.add(`import { api${g} } from '@/features/f${g}';`);
    }
    if (rand(200) === 0) {
      const g = rand(featureCount);
      if (g !== f) imports.add(`import { v1 } from '@/features/f${g}/m1';`);
    }
    if (hasCycle && i === 1) imports.add(`import { v2 } from './m2';`);
    if (hasCycle && i === 2) imports.add(`import { v1 } from './m1';`);

    write(
      path.join(dir, `m${i}.ts`),
      `${[...imports].join('\n')}

export const v${i} = ${i};

export function fn${i}(a: number): number {
  const x = a * 2;
  return x + ${i};
}
`,
    );
    total++;
  }
  write(path.join(dir, 'index.ts'), `export { v0 as api${f} } from './m0';\n`);
  total++;
}

console.log(`Generated ${total} files in ${root}`);
