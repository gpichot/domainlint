#!/usr/bin/env node
// Benchmarks domainlint against other dependency-analysis tools on generated
// fixtures, per scenario:
//
//   cycles      import cycle detection only
//   boundaries  "domain" rule only: cross-feature imports must use the barrel
//   full        both in one run (what you would put in CI)
//
// Usage:
//   node benchmarks/run.mjs [--scenarios cycles,boundaries,full]
//                           [--sizes 20x25,100x100] [--runs 5]
//                           [--tools domainlint,oxlint,...] [--json out.json]
//
// Requires the CLI to be built first: `pnpm --filter domainlint build`.
// Competitor tools are installed once into benchmarks/.tools (gitignored).
// Fixtures are generated under the OS temp dir: oxlint always honours
// .gitignore files, so they must live outside this repository.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const toolsDir = path.join(here, '.tools');
const configs = path.join(here, 'configs');
const bin = (name) => path.join(toolsDir, 'node_modules', '.bin', name);
const domainlintBin = path.join(repoRoot, 'packages/domainlint/bin/run.js');

const { values } = parseArgs({
  options: {
    scenarios: { type: 'string', default: 'cycles,boundaries,full' },
    sizes: { type: 'string', default: '20x25,100x100' },
    runs: { type: 'string', default: '5' },
    tools: { type: 'string' },
    out: { type: 'string', default: path.join(os.tmpdir(), 'domainlint-bench') },
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
  'eslint-plugin-boundaries': '7.4.2',
  'typescript-eslint': '8.73.0',
  'eslint-import-resolver-typescript': '4.4.5',
  oxlint: '1.92.0',
};

const domainlint = (config) => [
  process.execPath,
  [domainlintBin, 'check', '.', '--no-color', ...(config ? ['-c', path.join(configs, config)] : [])],
];
const depcruise = (config) => [bin('depcruise'), ['src', '-c', path.join(configs, config)]];
// ESLint and oxlint resolve plugins relative to the config file, so configs are copied
// into the fixture (next to its node_modules symlink) and referenced by name.
const eslint = (config) => [bin('eslint'), ['src', '-c', config]];
// oxlint runs eslint-plugin-boundaries through its ESLint-compatible JS plugin support.
const oxlintBoundaries = (...extra) => [
  bin('oxlint'),
  ['-c', 'oxlint-boundaries.json', '-A', 'all', '-D', 'boundaries/entry-point', ...extra, 'src'],
];

// Each entry: label, command, and a parser that extracts the number of
// findings from the output (sanity check that the tool actually did the work).
const count = (re) => (out) => {
  const m = out.match(re);
  return m ? Number(m[1]) : 0;
};
const lines = (re) => (out) => out.split('\n').filter((l) => re.test(l)).length;

const SCENARIOS = {
  cycles: {
    domainlint: { label: 'domainlint', cmd: domainlint('domainlint-cycles.json'), findings: lines(/ ERROR /) },
    oxlint: {
      label: 'oxlint import/no-cycle',
      cmd: [bin('oxlint'), ['--import-plugin', '-A', 'all', '-D', 'import/no-cycle', 'src']],
      findings: lines(/import\(no-cycle\)/),
    },
    madge: {
      label: 'madge --circular',
      cmd: [bin('madge'), ['--circular', '--extensions', 'ts', '--ts-config', 'tsconfig.json', 'src']],
      findings: lines(/^\d+\)/),
    },
    depcruise: { label: 'dependency-cruiser', cmd: depcruise('depcruise-cycles.cjs'), findings: count(/(\d+) dependency violations/) },
    eslint: { label: 'ESLint import-x/no-cycle', cmd: eslint('eslint-cycles.mjs'), findings: count(/(\d+) problems?/) },
  },
  boundaries: {
    domainlint: { label: 'domainlint', cmd: domainlint('domainlint-boundaries.json'), findings: lines(/ ERROR /) },
    depcruise: { label: 'dependency-cruiser', cmd: depcruise('depcruise-boundaries.cjs'), findings: count(/(\d+) dependency violations/) },
    oxlint: {
      label: 'oxlint + boundaries (JS plugin)',
      cmd: oxlintBoundaries(),
      findings: lines(/boundaries\(entry-point\)/),
    },
    eslint: { label: 'ESLint boundaries/entry-point', cmd: eslint('eslint-boundaries.mjs'), findings: count(/(\d+) problems?/) },
  },
  full: {
    domainlint: { label: 'domainlint', cmd: domainlint(), findings: lines(/ ERROR /) },
    depcruise: { label: 'dependency-cruiser', cmd: depcruise('depcruise-full.cjs'), findings: count(/(\d+) dependency violations/) },
    oxlint: {
      label: 'oxlint no-cycle + boundaries',
      cmd: oxlintBoundaries('--import-plugin', '-D', 'import/no-cycle'),
      findings: lines(/boundaries\(entry-point\)|import\(no-cycle\)/),
    },
    eslint: { label: 'ESLint import-x + boundaries', cmd: eslint('eslint-full.mjs'), findings: count(/(\d+) problems?/) },
  },
};

function ensureTools() {
  const pkgPath = path.join(toolsDir, 'package.json');
  const wanted = JSON.stringify({ private: true, dependencies: TOOL_DEPS }, null, 2);
  const upToDate =
    fs.existsSync(pkgPath) &&
    fs.readFileSync(pkgPath, 'utf8') === wanted &&
    fs.existsSync(path.join(toolsDir, 'node_modules'));
  if (upToDate) return;
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(pkgPath, wanted);
  console.log('Installing competitor tools into benchmarks/.tools …');
  execFileSync('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
    cwd: toolsDir,
    stdio: 'inherit',
  });
}

function prepareFixture(features, files) {
  const dir = path.join(values.out, `${features}x${files}`);
  execFileSync(process.execPath, [
    path.join(here, 'generate.mjs'),
    dir,
    '--features',
    String(features),
    '--files',
    String(files),
  ]);
  fs.symlinkSync(path.join(toolsDir, 'node_modules'), path.join(dir, 'node_modules'));
  for (const f of fs.readdirSync(configs)) {
    if (/^(eslint|oxlint)-/.test(f)) fs.copyFileSync(path.join(configs, f), path.join(dir, f));
  }
  return dir;
}

function run(tool, cwd) {
  const [command, args] = tool.cmd;
  const start = process.hrtime.bigint();
  const res = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (res.error) throw res.error;
  return { ms, output: `${res.stdout}\n${res.stderr}` };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

if (!fs.existsSync(path.join(repoRoot, 'packages/domainlint/dist'))) {
  console.error('Build the CLI first: pnpm --filter domainlint build');
  process.exit(1);
}

const scenarios = values.scenarios.split(',');
for (const s of scenarios) if (!SCENARIOS[s]) throw new Error(`Unknown scenario: ${s}`);
const toolFilter = values.tools?.split(',');
const runs = Number(values.runs);
ensureTools();

const results = [];
for (const size of values.sizes.split(',')) {
  const [features, files] = size.split('x').map(Number);
  const dir = prepareFixture(features, files);
  const fileCount = features * (files + 1);

  for (const scenario of scenarios) {
    console.log(`\n[${scenario}] ${fileCount} files (${features} features × ${files + 1})`);
    for (const [key, tool] of Object.entries(SCENARIOS[scenario])) {
      if (toolFilter && !toolFilter.includes(key)) continue;
      const warm = run(tool, dir); // warm-up (fs cache, JIT) + findings check
      const findings = tool.findings(warm.output);
      const samples = Array.from({ length: runs }, () => run(tool, dir).ms);
      const ms = median(samples);
      results.push({ scenario, fileCount, tool: key, label: tool.label, medianMs: Math.round(ms), findings, samples });
      console.log(
        `  ${tool.label.padEnd(30)} ${(ms / 1000).toFixed(2).padStart(6)} s   ${String(findings).padStart(5)} findings`,
      );
      if (findings === 0) console.warn('    ⚠ no findings: the tool may be misconfigured');
    }
  }
}

if (values.json) {
  const meta = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpus: os.cpus().length,
    runs,
    toolVersions: TOOL_DEPS,
  };
  fs.writeFileSync(values.json, JSON.stringify({ meta, results }, null, 2));
  console.log(`\nWrote ${values.json}`);
}
