/**
 * Phase 3 Integration Test Runner
 *
 * Custom @vscode/test-electron runner for gpg-bridge-request Phase 3 integration tests.
 *
 * Phase 3 exercises the full proxy chain end-to-end with a real gpg binary on Linux:
 *   gpg (Linux) → Unix socket → gpg-bridge-request → VS Code command routing
 *   → gpg-bridge-agent (Windows) → gpg-agent (Windows)
 *
 * Responsibilities:
 *   1. Create an isolated gpg keyring (GNUPGHOME) unique to this test run.
 *   2. Generate a test key; export the public key to a path accessible from
 *      the container via the workspace bind mount.
 *   3. Launch a throwaway gpg-agent pointed at the isolated Windows keyring.
 *   4. Start VS Code via runTests() with --remote so each extension is routed to
 *      the correct host based on its extensionKind declaration:
 *        gpg-bridge-agent  (extensionKind: ui)        → Windows local extension host
 *        gpg-bridge-request (extensionKind: workspace) → remote (Linux dev container) host
 *   5. After tests complete, kill the agent, delete the key, and delete the keyring.
 *
 * Key differences from Phase 2 (requestProxyRunTest.ts):
 *   - Uses .devcontainer/phase3/devcontainer.json (includes gnupg2 install).
 *   - Exports the public key to a workspace-mounted path so the Phase 3 Mocha
 *     before() can import it into the container's GNUPGHOME via importPublicKey().
 *   - GNUPGHOME in extensionTestsEnv is the Windows path (for gpg-bridge-agent);
 *     the container's GNUPGHOME is a static Linux path set in devcontainer.json remoteEnv.
 *   - PUBKEY_ARMORED_KEY is the ASCII-armored public key string passed via env var.
 *   - extensionTestsPath points to suite/gpgCliIndex (not suite/requestProxyIndex).
 *
 * ⚠ ORDER DEPENDENCY: this runner MUST execute after requestProxyRunTest.ts (Phase 2).
 * Enforcement: the parent script `test:integration` chains them with &&:
 *   `npm run test:integration:request-proxy && npm run test:integration:gpg-cli`
 * Running `test:integration:gpg-cli` directly skips Phase 2 and will produce an
 * incomplete (Phase 3 only) coverage report, or skip the report entirely if no
 * JSON files are present.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { pathToFileURL } from 'url';
import {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import { GpgTestHelper } from '@gpg-bridge/shared/test/integration';

// GpgTestHelper creates and validates its own isolated keyring at construction time.
// process.env.GNUPGHOME is never mutated.
const gpgLocalHost = new GpgTestHelper();

/**
 * Walk up from `startDir` until we find a directory containing `AGENTS.md`
 * (which exists only at the monorepo root). This is more robust than counting
 * `../` levels, which silently breaks if tsconfig outDir depth ever changes.
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
        `Could not locate workspace root: AGENTS.md not found in any ` + `ancestor of ${startDir}`,
      );
    }
    dir = parent;
  }
}
const workspaceRoot = findWorkspaceRoot(__dirname);

// Container URI format: dev-container+<hex-encoded-JSON>, same as Phase 2.
// JSON payload: {hostPath, configFile} — same structure as requestProxyRunTest.ts.
//
// Container identity labels (set by devcontainer CLI on every container it creates):
//   devcontainer.local_folder ← hostPath  (OS-native path, e.g. C:\njs\gpg-windows-relay)
//   devcontainer.config_file  ← URI.revive(configFile).fsPath  (lowercase drive letter on Windows,
//                               e.g. c:\njs\gpg-windows-relay\.devcontainer\phase3\devcontainer.json)
// check-devcontainer.js removeExistingContainer() filters on these same label values.
// Note: devcontainer.config_file uses a lowercase drive letter (VS Code URI.fsPath behaviour)
// while path.resolve() produces uppercase. The script normalises to lowercase before filtering.
//
// configFile must be a serialized VS Code URI object (not a string) — the Dev Containers
// extension passes it through URI.revive(), which expects {$mid:1, scheme, authority,
// path, query, fragment}. A plain string or bare Windows path causes UriError.
// URI.revive(configFile).fsPath is the OS-native path stored as devcontainer.config_file.
const REMOTE_CONTAINER_URI = Buffer.from(
  JSON.stringify({
    // hostPath becomes the devcontainer.local_folder Docker label on the container.
    hostPath: workspaceRoot,
    configFile: {
      $mid: 1,
      scheme: 'file',
      authority: '',
      path: path
        .join(workspaceRoot, '.devcontainer', 'phase3', 'devcontainer.json')
        .replace(/\\/g, '/')
        .replace(/^([A-Za-z]):/, '/$1:'),
      query: '',
      fragment: '',
    },
  }),
).toString('hex');
const containerWorkspaceFolder = `/workspaces/${path.basename(workspaceRoot)}`;

// V8 coverage JSON files from Phase 2 and Phase 3 accumulate here (created/cleared by Phase 2).
// This runner (Phase 3) processes the combined data with c8 after cleanup.
const v8CovDir = path.resolve(__dirname, '../../../coverage/v8-integration');

async function main(): Promise<void> {
  // disable-scdaemon is the only confirmed-valid conf option in GPG 2.4.x.
  gpgLocalHost.writeAgentConf(['disable-scdaemon']);

  // Generate the test key on Windows before either extension host starts.
  await gpgLocalHost.generateKey('Integration Test User', 'integration-test@example.com');
  const fingerprint = await gpgLocalHost.getFingerprint('integration-test@example.com');

  // Export the public key as an ASCII-armored string and pass it directly via env var.
  // Ed25519 armored public keys are ~350 chars — well within the 32,767-char Win32 limit.
  // The Mocha before() reads PUBKEY_ARMORED_KEY and calls importPublicKey() directly,
  // with no intermediate file or workspace bind mount path required.
  const pubkeyArmored = await gpgLocalHost.exportPublicKey(fingerprint);

  // Launch the gpg-agent BEFORE the extension hosts start so that gpg-bridge-agent's
  // activate() → detectAgentSocket() (calls gpgconf) already sees a live socket.
  await gpgLocalHost.launchAgent();

  // Download (or reuse cached) VS Code binary, then pre-install the Dev Containers
  // extension into the test profile. resolveCliArgsFromVSCodeExecutablePath returns
  // the VS Code CLI path plus --extensions-dir pointing at the test-scoped extensions
  // folder so the install does not touch the user's own VS Code installation.
  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  cp.spawnSync(cliPath, [...cliArgs, '--install-extension', 'ms-vscode-remote.remote-containers'], {
    encoding: 'utf-8',
    stdio: 'inherit',
    shell: true,
  });

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: [
        path.join(workspaceRoot, 'gpg-bridge-agent'), // gpg-bridge-agent root (ui, local)
        `vscode-remote://dev-container+${REMOTE_CONTAINER_URI}${containerWorkspaceFolder}/gpg-bridge-request`, // gpg-bridge-request (workspace, remote)
      ],

      // Mocha entry point: suite/gpgCliIndex, not suite/requestProxyIndex.
      // gpgCliIndex loads gpgCliIntegration.test.js specifically.
      extensionTestsPath: `vscode-remote://dev-container+${REMOTE_CONTAINER_URI}${containerWorkspaceFolder}/gpg-bridge-request/out/test/integration/suite/gpgCliIndex`,

      launchArgs: [
        '--folder-uri',
        `vscode-remote://dev-container+${REMOTE_CONTAINER_URI}${containerWorkspaceFolder}`,
      ],

      // Inject GNUPGHOME and test key metadata into the local host VS Code process env.
      // GNUPGHOME for gpg-bridge-agent uses the isolated Windows keyring (same as Phase 2).
      // The container's GNUPGHOME is the static Linux path set in devcontainer.json remoteEnv;
      // it is NOT forwarded here to keep gpg-bridge-agent pointed at the Windows keyring.
      // PUBKEY_ARMORED_KEY → ASCII-armored public key string passed directly; no file needed.
      //   devcontainer.json remoteEnv uses ${localEnv:...} to forward it to the container.
      // TEST_KEY_FINGERPRINT → forwarded to container via devcontainer.json remoteEnv.
      extensionTestsEnv: {
        VSCODE_INTEGRATION_TEST: '1',
        GNUPGHOME: gpgLocalHost.gnupgHome,
        TEST_KEY_FINGERPRINT: fingerprint,
        PUBKEY_ARMORED_KEY: pubkeyArmored,
      },
    });
  } finally {
    // Kill agent and remove the isolated keyring whether tests passed or failed.
    await gpgLocalHost.cleanup();
    // Generate coverage report from accumulated Phase 2 + Phase 3 V8 JSON data.
    // V8 JSON from the container uses Linux paths; remap them to Windows paths
    // so c8 can locate the compiled JS files (and follow source maps to .ts).
    const v8JsonFiles = fs.existsSync(v8CovDir)
      ? fs.readdirSync(v8CovDir).filter((f) => f.endsWith('.json'))
      : [];
    process.stdout.write(`\n[coverage] v8CovDir: ${v8CovDir}\n`);
    process.stdout.write(`[coverage] JSON files found: ${v8JsonFiles.length}\n`);
    if (v8JsonFiles.length > 0) {
      const containerPrefix = `file://${containerWorkspaceFolder}/`;
      // pathToFileURL produces a correct file:// URL on any host OS (Windows or Linux).
      const hostPrefix = pathToFileURL(workspaceRoot).href.replace(/\/?$/, '/');
      process.stdout.write(`[coverage] containerPrefix: ${containerPrefix}\n`);
      process.stdout.write(`[coverage] hostPrefix:      ${hostPrefix}\n`);

      // Write filtered copies to a separate directory so that late-exiting container
      // processes (e.g. ESLint server) cannot write new files into v8CovDir after
      // the filter loop finishes but before c8 reads the directory.
      const v8FilteredDir = path.resolve(__dirname, '../../../coverage/v8-filtered');
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
        'npx c8 report --reporter=text --reporter=lcov --reporter=json --exclude "**/test/**" --temp-directory coverage/v8-filtered --reports-dir coverage/integration',
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
        throw new Error(`c8 exited with status ${c8Proc.status}`);
      }
      // Raw V8 JSON has been consumed; remove both temp dirs so stale data cannot
      // pollute a future run that skips Phase 2 (which would otherwise re-process it).
      fs.rmSync(v8CovDir, { recursive: true, force: true });
      fs.rmSync(v8FilteredDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('Integration test runner failed:', err);
  process.exit(1);
});
