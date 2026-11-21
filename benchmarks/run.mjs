#!/usr/bin/env node
// Benchmarks domainlint against madge, dependency-cruiser and
// eslint-plugin-import-x on generated fixtures.
//
// Usage: node benchmarks/run.mjs [--sizes 20x25,100x100] [--runs 5] [--tools domainlint,madge,depcruise,eslint] [--json out.json]
//
// Requires the CLI to be built first: `pnpm --filter domainlint build`.
// Competitor tools are installed once into benchmarks/.tools (gitignored),
// fixtures are generated into benchmarks/.fixtures (gitignored).

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const toolsDir = path.join(here, '.tools');
const fixturesDir = path.join(here, '.fixtures');
const bin = (name) => path.join(toolsDir, 'node_modules', '.bin', name);
const domainlintBin = path.join(repoRoot, 'packages/domainlint/bin/run.js');

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '20x25,100x100' },
    runs: { type: 'string', default: '5' },
    tools: { type: 'string', default: 'domainlint,madge,depcruise,eslint' },
    json: { type: 'string' },
  },
});

// Pinned so results are reproducible. TypeScript is held at 6.x because
// dependency-cruiser and typescript-eslint do not support the TS 7 API yet.
const TOOL_DEPS = {
  madge: '8.0.0',
  'dependency-cruiser': '18.8.0',
  typescript: '6.0.3',
  eslint: '9.39.5',
  'eslint-plugin-import-x': '4.18.1',
  'typescript-eslint': '8.73.0',
  'eslint-import-resolver-typescript': '4.4.5',
};

const TOOLS = {
  domainlint: {
    label: 'domainlint',
    cmd: () => [process.execPath, [domainlintBin, 'check', '.']],
  },
  madge: {
    label: 'madge --circular',
    cmd: () => [
      bin('madge'),
      ['--circular', '--extensions', 'ts', '--ts-config', 'tsconfig.json', 'src'],
    ],
  },
  depcruise: {
    label: 'dependency-cruiser',
    cmd: () => [bin('depcruise'), ['src', '-c', '.dependency-cruiser.cjs']],
  },
  eslint: {
    label: 'eslint import-x/no-cycle',
    cmd: () => [bin('eslint'), ['src']],
  },
};

function ensureTools() {
  const pkgPath = path.join(toolsDir, 'package.json');
  const wanted = JSON.stringify({ private: true, dependencies: TOOL_DEPS }, null, 2);
  if (fs.existsSync(pkgPath) && fs.readFileSync(pkgPath, 'utf8') === wanted) {
    if (fs.existsSync(path.join(toolsDir, 'node_modules'))) return;
  }
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(pkgPath, wanted);
  console.log('Installing competitor tools into benchmarks/.tools …');
  execFileSync('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
    cwd: toolsDir,
    stdio: 'inherit',
  });
}

function prepareFixture(features, files) {
  const dir = path.join(fixturesDir, `${features}x${files}`);
  execFileSync(process.execPath, [
    path.join(here, 'generate.mjs'),
    dir,
    '--features',
    String(features),
    '--files',
    String(files),
  ]);
  fs.copyFileSync(
    path.join(here, 'configs/dependency-cruiser.cjs'),
    path.join(dir, '.dependency-cruiser.cjs'),
  );
  fs.copyFileSync(
    path.join(here, 'configs/eslint.config.mjs'),
    path.join(dir, 'eslint.config.mjs'),
  );
  fs.symlinkSync(path.join(toolsDir, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

function time(tool, cwd) {
  const [command, args] = tool.cmd();
  const start = process.hrtime.bigint();
  const res = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (res.error) throw res.error;
  return { ms, status: res.status };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

if (!fs.existsSync(domainlintBin) || !fs.existsSync(path.join(repoRoot, 'packages/domainlint/dist'))) {
  console.error('Build the CLI first: pnpm --filter domainlint build');
  process.exit(1);
}

const selected = values.tools.split(',').map((t) => {
  if (!TOOLS[t]) throw new Error(`Unknown tool: ${t}`);
  return [t, TOOLS[t]];
});
const runs = Number(values.runs);
if (selected.some(([t]) => t !== 'domainlint')) ensureTools();

const results = [];
for (const size of values.sizes.split(',')) {
  const [features, files] = size.split('x').map(Number);
  const dir = prepareFixture(features, files);
  const fileCount = features * (files + 1);
  console.log(`\n${fileCount} files (${features} features × ${files + 1})`);

  for (const [key, tool] of selected) {
    time(tool, dir); // warm-up (fs cache, JIT)
    const samples = Array.from({ length: runs }, () => time(tool, dir).ms);
    const ms = median(samples);
    results.push({ fileCount, tool: key, medianMs: Math.round(ms), samples });
    console.log(`  ${tool.label.padEnd(26)} ${(ms / 1000).toFixed(2).padStart(6)} s`);
  }
}

const meta = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpus: (await import('node:os')).cpus().length,
  runs,
  toolVersions: TOOL_DEPS,
};
if (values.json) {
  fs.writeFileSync(values.json, JSON.stringify({ meta, results }, null, 2));
  console.log(`\nWrote ${values.json}`);
}
