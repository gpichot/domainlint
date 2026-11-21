// Measures JS<->Rust boundary cost of the napi spike.
// Usage: node bench.mjs [--dirs /tmp/dl-fix/100x100,/tmp/dl-fix/200x100] [--runs 7]
// Needs: cargo build --release && cp target/release/libdomainlint_graph_napi.so index.node
//        pnpm --filter domainlint build   (for GraphQuery from packages/domainlint/dist)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const dirs = arg('dirs', '/tmp/dl-fix/100x100,/tmp/dl-fix/200x100').split(',');
const runs = Number(arg('runs', '7'));

const t0 = performance.now();
const addon = require('./index.node');
const loadMs = performance.now() - t0;
const { GraphQuery } = await import(pathToFileURL(path.join(here, '../../packages/domainlint/dist/index.js')).href);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (fn) => { const s = performance.now(); const r = fn(); return [performance.now() - s, r]; };
function bench(fn) {
  fn(); // warm-up
  const wall = [], extra = [];
  let last;
  for (let i = 0; i < runs; i++) { const [ms, r] = time(fn); wall.push(ms); last = r; }
  return { wall: median(wall), last };
}

// Rebuild the JS DependencyGraph shape (nodes Set, edges, adjacencyList, normalizedToOriginalPath).
function toGraphFromCompact(c) {
  const nodes = new Set(c.nodes);
  const normalizedToOriginalPath = new Map();
  for (let i = 0; i < c.nodes.length; i++) normalizedToOriginalPath.set(c.nodes[i], c.files[i]);
  const n = c.edgeFrom.length;
  const edges = new Array(n);
  const adjacencyList = new Map();
  for (const k of c.nodes) adjacencyList.set(k, new Set());
  for (let i = 0; i < n; i++) {
    const from = c.nodes[c.edgeFrom[i]], to = c.nodes[c.edgeTo[i]];
    edges[i] = { from, to, importInfo: { specifier: c.specifiers[i], line: c.line[i], col: c.col[i], isDynamic: (c.flags[i] & 2) !== 0, isTypeOnly: (c.flags[i] & 1) !== 0 } };
    adjacencyList.get(from).add(to);
  }
  return { nodes, edges, adjacencyList, normalizedToOriginalPath };
}
function toGraphFromObjects(g) {
  const nodes = new Set(g.nodes);
  const normalizedToOriginalPath = new Map();
  for (let i = 0; i < g.nodes.length; i++) normalizedToOriginalPath.set(g.nodes[i], g.files[i]);
  const edges = new Array(g.edges.length);
  const adjacencyList = new Map();
  for (const k of g.nodes) adjacencyList.set(k, new Set());
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    const from = g.nodes[e.from], to = g.nodes[e.to];
    edges[i] = { from, to, importInfo: { specifier: e.specifier, line: e.line, col: e.col, isDynamic: e.isDynamic, isTypeOnly: e.isTypeOnly } };
    adjacencyList.get(from).add(to);
  }
  return { nodes, edges, adjacencyList, normalizedToOriginalPath };
}

const out = { addonLoadMs: loadMs, nodeFileBytes: fs.statSync(path.join(here, 'index.node')).size, sizes: {} };
for (const dir of dirs) {
  const name = path.basename(dir);
  const r = {};
  const variants = {
    objects: () => addon.buildGraph(dir),
    compact: () => addon.buildGraphCompact(dir),
    json: () => JSON.parse(addon.buildGraphJson(dir)),
  };
  // Rust-only total from timings (median of the same runs)
  for (const [vname, fn] of Object.entries(variants)) {
    const totals = [];
    const wrapped = () => { const g = fn(); totals.push(g.timingsMs.total); return g; };
    const { wall, last } = bench(wrapped);
    totals.shift(); // drop warm-up
    r[vname] = { wallMs: wall, rustTotalMs: median(totals), boundaryMs: wall - median(totals), edges: last.edges?.length ?? last.edgeFrom.length, violations: last.violations.length };
  }
  // JS-side reconstruction cost (graph already in hand)
  const compact = addon.buildGraphCompact(dir);
  const objs = addon.buildGraph(dir);
  r.reconstructFromCompactMs = median(Array.from({ length: runs }, () => time(() => toGraphFromCompact(compact))[0]));
  r.reconstructFromObjectsMs = median(Array.from({ length: runs }, () => time(() => toGraphFromObjects(objs))[0]));
  // JSON string size
  r.jsonBytes = Buffer.byteLength(addon.buildGraphJson(dir));
  // GraphQuery smoke test
  const graph = toGraphFromCompact(compact);
  const config = { rootDir: dir, srcDir: path.join(dir, 'src'), featuresDir: path.join(dir, 'src/features'), barrelFiles: ['index.ts'], extensions: ['.ts', '.tsx'], tsconfigPath: path.join(dir, 'tsconfig.json'), exclude: [], includeDynamicImports: false };
  const q = new GraphQuery(graph, config);
  const [qMs, smoke] = time(() => {
    const f0 = q.filesMatching('src/features/f0/**');
    const cross = graph.edges.find((e) => q.featureOf(e.from) !== q.featureOf(e.to) && q.featureOf(e.from) && q.featureOf(e.to));
    const [fa, fb] = [q.featureOf(cross.from), q.featureOf(cross.to)];
    const between = q.edgesBetween(`src/features/${fa}/**`, `src/features/${fb}/**`).edges.length;
    const sample = cross.to; // node key (extension-stripped), as GraphQuery expects
    return { feature0Files: f0.length, crossPair: `${fa}->${fb}`, edgesBetweenPair: between, featureOf: q.featureOf(sample), fanIn: q.fanIn(sample), fanOut: q.fanOut(sample), importers: q.importersOf(sample).length, dependsOnTransitive: q.dependsOn(cross.from, cross.to) };
  });
  r.graphQuerySmoke = { ms: qMs, ...smoke, nodes: graph.nodes.size, edges: graph.edges.length };
  r.rustViolationCounts = Object.fromEntries(Object.entries(objs.violations.reduce((a, v) => (a[v.code] = (a[v.code] || 0) + 1, a), {})));
  r.rustPhasesMs = objs.timingsMs;
  out.sizes[name] = r;
}

// process start cost
const startMs = (args) => median(Array.from({ length: 9 }, () => { const s = performance.now(); spawnSync(process.execPath, args, { cwd: here }); return performance.now() - s; }));
out.processStartMs = {
  bareNode: startMs(['-e', '0']),
  requireAddon: startMs(['-e', "require('./index.node')"]),
};
console.log(JSON.stringify(out, null, 2));
