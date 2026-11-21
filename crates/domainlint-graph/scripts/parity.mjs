#!/usr/bin/env node
// Parity check: runs the Node CLI and the Rust binary on the same project(s) and diffs the
// violation sets (each violation = first line + indented body lines; compared as sorted lists).
//
// Two comparisons are reported per run:
//   exact     - identical sets of blocks (every violation byte-for-byte).
//   start-agnostic - cycle blocks are reduced to their member-file set, ignoring which file is the
//                    reported cycle start. Both pipelines sort files now, so this normally
//                    equals the exact comparison; it stays as a safety net.
// The process exits non-zero only if the start-agnostic comparison fails.
//
// Usage:
//   node crates/domainlint-graph/scripts/parity.mjs <fixtureDir>... [--config <file>]... [--ordered]
// Defaults: configs = (none), benchmarks/configs/domainlint-*.json.
// Build first:  pnpm --filter domainlint build && cargo build --release -p domainlint-graph
//
// --ordered additionally compares the violations in emitted order (not just as sets).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const nodeCli = path.join(repo, 'packages/domainlint/bin/run.js');
const rsBin = process.env.DOMAINLINT_RS ?? path.resolve(here, '../../../target/release/domainlint-rs');

const args = process.argv.slice(2);
const dirs = [];
const configs = [];
let ordered = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config') configs.push(path.resolve(args[++i]));
  else if (args[i] === '--ordered') ordered = true;
  else dirs.push(path.resolve(args[i]));
}
if (dirs.length === 0) {
  console.error('usage: parity.mjs <fixtureDir>... [--config file]... [--ordered]');
  process.exit(2);
}
if (configs.length === 0) {
  const cdir = path.join(repo, 'benchmarks/configs');
  configs.push(null, ...fs.readdirSync(cdir).filter((f) => /^domainlint-.*\.json$/.test(f)).sort().map((f) => path.join(cdir, f)));
}

// Split stdout into violation blocks: a header line `<file>:<l>:<c> (ERROR|WARN) <code>` plus
// the following indented lines.
function parse(stdout) {
  const blocks = [];
  let cur = null;
  let summary = null;
  for (const line of stdout.split('\n')) {
    if (/^\S+:\d+:\d+ (ERROR|WARN) /.test(line)) {
      cur = [line];
      blocks.push(cur);
    } else if (/^ +\S/.test(line) && cur) {
      cur.push(line);
    } else {
      cur = null;
      if (/^(✓ No violations|✗ Found )/.test(line)) summary ??= line;
    }
  }
  return { blocks: blocks.map((b) => b.join('\n')), summary };
}

function runTool(cmd, argv, cwd) {
  const t = process.hrtime.bigint();
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    // Compare the Rust binary against the pure-JS pipeline, not the native addon.
    env: { ...process.env, DOMAINLINT_NATIVE: '0' },
  });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { ...r, ms };
}

function canon(block) {
  if (!block.includes(' noImportCycle')) return block;
  const files = block
    .split('\n')
    .slice(1)
    .map((l) => l.trim().replace(/ ->$/, ''))
    .filter((l) => l.startsWith('.') || l.startsWith('/') || l.startsWith('['));
  return 'CYCLE ' + [...new Set(files)].sort().join(' | ');
}

let failures = 0;
for (const dir of dirs) {
  for (const cfg of configs) {
    const extra = cfg ? ['-c', cfg] : [];
    const node = runTool('node', [nodeCli, 'check', '.', '--no-color', ...extra], dir);
    const rs = runTool(rsBin, ['.', '--no-color', ...extra], dir);
    const a = parse(node.stdout);
    const b = parse(rs.stdout);
    const sa = [...a.blocks].sort();
    const sb = [...b.blocks].sort();
    const setA = new Set(sa);
    const setB = new Set(sb);
    const onlyNode = sa.filter((x) => !setB.has(x));
    const onlyRs = sb.filter((x) => !setA.has(x));
    const sameCount = sa.length === sb.length;
    const sameOrder = a.blocks.length === b.blocks.length && a.blocks.every((x, i) => x === b.blocks[i]);
    const exact = onlyNode.length === 0 && onlyRs.length === 0 && sameCount && a.summary === b.summary;
    const ca = a.blocks.map(canon).sort();
    const cb = b.blocks.map(canon).sort();
    const agnostic = ca.length === cb.length && ca.every((x, i) => x === cb[i]) && a.summary === b.summary;
    const ok = agnostic && (!ordered || sameOrder);
    if (!ok) failures++;
    const cycles = (s) => s.filter((x) => x.includes(' noImportCycle')).length;
    console.log(
      `${ok ? 'OK  ' : 'DIFF'} exact=${exact} ${path.basename(dir)} cfg=${cfg ? path.basename(cfg) : '(none)'} ` +
        `node: ${sa.length} (${cycles(sa)} cycles) exit=${node.status} ${node.ms.toFixed(0)}ms | ` +
        `rs: ${sb.length} (${cycles(sb)} cycles) exit=${rs.status} ${rs.ms.toFixed(0)}ms | ` +
        `same order: ${sameOrder} | summary equal: ${a.summary === b.summary}`,
    );
    if (!agnostic) {
      if (node.status === 2 && sa.length === 0) console.log('  node stderr:', node.stderr.slice(0, 400));
      for (const x of onlyNode.slice(0, 5)) console.log('  only in node:\n' + x.replace(/^/gm, '    '));
      for (const x of onlyRs.slice(0, 5)) console.log('  only in rust:\n' + x.replace(/^/gm, '    '));
      if (onlyNode.length > 5 || onlyRs.length > 5) console.log(`  ... (${onlyNode.length} only-node, ${onlyRs.length} only-rust total)`);
    }
  }
}
process.exit(failures ? 1 : 0);
