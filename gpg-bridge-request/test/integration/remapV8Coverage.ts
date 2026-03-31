/**
 * V8 Coverage Remap Script
 *
 * Post-processing step for gpg-bridge-request integration tests.
 * Run after gpgCliRunTest.js (Phase 3) so the combined Phase 2 + Phase 3 V8 JSON
 * data from coverage/v8-integration/ is present on disk.
 *
 * Responsibilities:
 *   1. Remap container-relative file:// URLs (Linux devcontainer paths) to host paths
 *      so c8 can locate compiled JS files and follow source maps back to TypeScript.
 *   2. Filter out V8 entries that could not be remapped (VS Code server internals,
 *      Node.js built-ins) to avoid ERR_INVALID_FILE_URL_PATH on Windows.
 *   3. Strip source-map-cache from each JSON file so c8 does not attempt to resolve
 *      Linux-only paths on the Windows host.
 *   4. Run c8 report on the filtered directory and write lcov / json / text output.
 *   5. Clean up both temp directories so stale data cannot pollute a future run.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { pathToFileURL } from 'url';

/**
 * Walk up from `startDir` until we find a directory containing `AGENTS.md`
 * (which exists only at the monorepo root). More robust than counting `../`
 * levels, which silently breaks if tsconfig outDir depth ever changes.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate workspace root: AGENTS.md not found in any ancestor of ${startDir}`,
      );
    }
    dir = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(__dirname);
const containerWorkspaceFolder = `/workspaces/${path.basename(workspaceRoot)}`;

// V8 coverage JSON files accumulate here
const v8CovDir = path.resolve(__dirname, '../../../coverage/v8-integration');
// Filtered JSON files with remapped URLs and source-map-cache removed are written here for c8 to consume.
const v8FilteredDir = path.resolve(__dirname, '../../../coverage/v8-filtered');

const v8JsonFiles = fs.existsSync(v8CovDir)
  ? fs.readdirSync(v8CovDir).filter((f) => f.endsWith('.json'))
  : [];

process.stdout.write(`\n[coverage] v8CovDir: ${v8CovDir}\n`);
process.stdout.write(`[coverage] JSON files found: ${v8JsonFiles.length}\n`);

if (v8JsonFiles.length === 0) {
  process.exit(0);
}

const containerPrefix = `file://${containerWorkspaceFolder}/`;
// pathToFileURL produces a correct file:// URL on any host OS (Windows or Linux).
const hostPrefix = pathToFileURL(workspaceRoot).href.replace(/\/?$/, '/');
process.stdout.write(`[coverage] containerPrefix: ${containerPrefix}\n`);
process.stdout.write(`[coverage] hostPrefix:      ${hostPrefix}\n`);

// Write filtered copies to a separate directory so that late-exiting container
// processes (e.g. ESLint server) cannot write new files into v8CovDir after
// the filter loop finishes but before c8 reads the directory.
fs.rmSync(v8FilteredDir, { recursive: true, force: true });
fs.mkdirSync(v8FilteredDir, { recursive: true });

for (const f of v8JsonFiles) {
  const raw = fs.readFileSync(path.join(v8CovDir, f), 'utf8');
  // Remap container workspace paths to host paths, then drop every script
  // entry whose URL was NOT remapped (VS Code server internals, Node.js
  // built-ins, etc.). If left in, c8 calls fileURLToPath() on Linux-style
  // file:// URLs (e.g. file:///home/node/.vscode-server/...) which throws
  // ERR_INVALID_FILE_URL_PATH on Windows because those paths have no drive letter.
  const remapped = raw.split(containerPrefix).join(hostPrefix);
  const data = JSON.parse(remapped) as {
    result: Array<{ url: string }>;
    'source-map-cache'?: unknown;
  };
  data.result = data.result.filter((entry) => entry.url.startsWith(hostPrefix));
  process.stdout.write(`[coverage] ${f}: ${data.result.length} entries after filter\n`);
  // Remove source-map-cache entirely.
  //
  // source-map-cache is a perf shortcut: it carries inline source-map data so c8
  // does not need to re-read each .map file from disk. Its keys are file:// URLs for
  // every script the container process loaded — including vscode-server internals
  // (e.g. file:///vscode/vscode-server/.../bootstrap-fork.js) that are
  // NOT remapped by the containerPrefix→hostPrefix substitution above.
  //
  // On Windows: fileURLToPath() rejects any file:// URL whose path does not start
  // with a drive letter. A Linux absolute path like /vscode/... has no drive letter,
  // so c8's _normalizeSourceMapCache throws ERR_INVALID_FILE_URL_PATH.
  //
  // On Linux/macOS: fileURLToPath() accepts those paths without crashing (they are
  // valid Unix absolute paths), but the files do not exist on the host machine, so
  // c8 would silently skip them. Deleting source-map-cache is therefore harmless on
  // every platform.
  //
  // Coverage mapping is unaffected: after deletion c8 falls back to reading the
  // `# sourceMappingURL=` comment from each compiled JS file in result[] and loads
  // the corresponding .map file from disk, which tsc already wrote to out/.
  // tsc emits only relative paths: sourceMappingURL is a bare filename
  // (e.g. `requestProxy.js.map`, same directory as the .js file) and the
  // `sources` array inside the .map is also relative (e.g. `../../src/services/requestProxy.ts`).
  // No absolute paths appear anywhere in the source-map chain, so c8 resolves
  // them correctly on Windows, Linux, and macOS without drive-letter or
  // Unix-only-path issues.
  delete data['source-map-cache'];
  fs.writeFileSync(path.join(v8FilteredDir, f), JSON.stringify(data));
}

// Double-quote the glob so the host shell (sh on Linux, cmd on Windows) does not
// expand it before c8 receives it.
// Use spawnSync (not execSync) to capture both stdout AND stderr independently.
// execSync(stdio:'pipe') silently discards stderr when the process exits 0 — so
// any c8 warnings (e.g. unresolvable source maps, ENOENT) would be swallowed on
// CI Linux, hiding the true cause of "All files 0%".
// Pass the full command as a single string with shell:true so the double-quoted
// glob (**/test/**) is not expanded by the shell before c8 receives it.
// FORCE_COLOR restores chalk's ANSI color output: piped stdio is not a TTY,
// so chalk auto-disables color; FORCE_COLOR overrides that detection.
const c8Proc = cp.spawnSync(
  'npx c8 report --reporter=text --reporter=lcov --reporter=json --exclude "**/test/**" --allowExternal --temp-directory coverage/v8-filtered --reports-dir coverage/integration',
  [],
  {
    cwd: path.resolve(__dirname, '../../../'),
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '2' },
  },
);
if (c8Proc.stdout) process.stdout.write('\n' + c8Proc.stdout);
if (c8Proc.stderr) process.stdout.write('[c8 stderr]\n' + c8Proc.stderr + '\n');
if (c8Proc.status !== 0) {
  process.exit(c8Proc.status ?? 1);
}

// Raw V8 JSON has been consumed; remove both temp dirs so stale data cannot
// pollute a future run
fs.rmSync(v8CovDir, { recursive: true, force: true });
fs.rmSync(v8FilteredDir, { recursive: true, force: true });
