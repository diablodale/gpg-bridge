#!/usr/bin/env node
// check-devcontainer.js — Pulls the dev container base image and removes any
// existing container so the test runner's `devcontainer up` always starts fresh.
//
// Steps:
//   1. Read the "image" field from the devcontainer.json config file.
//   2. docker pull <image> — idempotent; no-op when already current. Ensures
//      the image is available on CI where no local images exist yet.
//   3. removeExistingContainer() — removes any container the devcontainer CLI
//      previously created for this workspace+config pair, so `devcontainer up`
//      always creates a clean container.
//
// Why no build step or hash sentinel:
//   Both devcontainer.json files use "image" (not "build": {dockerfile}). When
//   devcontainer up runs on a pure "image" config it synthesizes the container
//   directly from the MCR base image — it never uses a pre-built named image
//   (e.g. gpg-bridge-phase2:latest) as an ancestor. A devcontainer build step
//   produces a separate tagged image that is never the container's ancestor, so
//   any hash label on that image has no effect on container freshness.
//
//   More critically, devcontainer up has no staleness detection of its own.
//   Source-confirmed in devContainersSpecCLI.js (uG function): when it finds an
//   existing container it calls vV(), which only starts the container if stopped.
//   No config comparison, no hash check — blind reuse. The only reliable
//   mechanism to force a fresh container is to remove the existing one first.
//
// devcontainer CLI label invariant (source-confirmed in devContainersSpecCLI.js,
// constants mI and yI):
//   devcontainer.local_folder = workspace folder path (= repoRoot here)
//   devcontainer.config_file  = devcontainer.json path (= resolvedConfig here)
// These match the values embedded in REMOTE_CONTAINER_URI in the test runners
// (hostPath → local_folder, URI.revive(configFile).fsPath → config_file).
// Filtering on both labels targets only the container for this specific phase,
// not a sibling phase container that shares the same workspace folder.
//
// Usage:
//   node scripts/check-devcontainer.js --config <path>

'use strict';

const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

// --- constants ---------------------------------------------------------------

// Docker image names follow the OCI Distribution Spec — no spaces or shell
// metacharacters. Validates the value extracted from devcontainer.json to
// catch malformed configs early.
const SAFE_IMAGE_NAME = /^[a-z0-9]([a-z0-9._\-/:]*[a-z0-9])?$/;

// --- argument parsing --------------------------------------------------------

/**
 * Returns the value following `flag` in `args`, or exits with an error if absent.
 * @param {string[]} args
 * @param {string} flag
 * @returns {string}
 */
function requireArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || !args[idx + 1]) {
    console.error(`Missing required argument: ${flag}`);
    console.error('Usage: node scripts/check-devcontainer.js --config <path>');
    process.exit(1);
  }
  return args[idx + 1];
}

const args = process.argv.slice(2);
const configFile = requireArg(args, '--config');

// Prevent path traversal: resolve configFile relative to the repo root and
// confirm the result is still inside the repo root. This is the relevant
// security check now that shell: true is not used (spawnSync passes args
// directly to the OS, so shell metacharacters are not a concern).
const repoRoot = path.resolve(__dirname, '..');
const resolvedConfig = path.resolve(repoRoot, configFile);
if (!resolvedConfig.startsWith(repoRoot + path.sep)) {
  console.error(`--config resolves outside the repository root: ${resolvedConfig}`);
  process.exit(1);
}

// --- helpers -----------------------------------------------------------------

/** @param {string} msg */
function log(msg) {
  console.log(`[check-devcontainer] ${msg}`);
}

/**
 * Read the "image" field value from the devcontainer.json config file.
 * devcontainer.json is JSONC (permits // comments); the field is extracted via
 * regex rather than a JSONC parser to avoid an extra dependency.
 * @returns {string}
 */
function readImageFromConfig() {
  const raw = readFileSync(resolvedConfig, 'utf8');
  const match = raw.match(/"image"\s*:\s*"([^"]+)"/);
  if (!match) {
    console.error(`No "image" field found in ${configFile}`);
    process.exit(1);
  }
  const image = match[1];
  if (!SAFE_IMAGE_NAME.test(image)) {
    console.error(`Invalid image name in ${configFile}: ${image}`);
    process.exit(1);
  }
  return image;
}

/**
 * Pull the dev container base image.
 * docker pull is idempotent: a no-op when the local digest already matches
 * the registry, so this is safe to run on every test invocation.
 * @param {string} imageName
 */
function pullImage(imageName) {
  log(`Pulling: ${imageName}`);
  const result = spawnSync('docker', ['pull', imageName], {
    stdio: 'inherit',
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    log(`Pull failed to launch: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    log('Pull failed');
    process.exit(result.status ?? 1);
  }
  log('Pull complete');
}

/**
 * Remove any container (running or stopped) that was created for this
 * workspace+config pair. The devcontainer CLI stamps two Docker labels on
 * every container it creates:
 *   devcontainer.local_folder = workspace folder  (= repoRoot = hostPath in URI)
 *   devcontainer.config_file  = devcontainer.json (= resolvedConfig = configFile.fsPath in URI)
 * Filtering on both ensures we only touch the container for this specific phase
 * and not any sibling phase container that shares the same workspace folder.
 * Removing it before every test run ensures `devcontainer up` always creates a
 * fresh container — preventing stale mounts, stale remoteEnv values, and
 * leftover state from prior runs.
 *
 * Drive letter case: on Windows, VS Code's URI.revive().fsPath lowercases drive
 * letters (e.g. 'C:\...' → 'c:\...'). The devcontainer CLI stores the fsPath as
 * the devcontainer.config_file label value, so the label always has a lowercase
 * drive letter. path.resolve() in Node.js produces uppercase ('C:\...').
 * We normalize to lowercase before filtering so the values match.
 * devcontainer.local_folder is derived from hostPath (not fsPath) and keeps the
 * uppercase drive letter that path.resolve() produces, so no normalization needed.
 */
function removeExistingContainer() {
  // Normalize drive letter to lowercase to match VS Code URI.fsPath behavior.
  const configFileLabel = resolvedConfig.replace(/^([A-Za-z]):/, (m) => m.toLowerCase());
  const listResult = spawnSync(
    'docker',
    [
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=devcontainer.local_folder=${repoRoot}`,
      '--filter',
      `label=devcontainer.config_file=${configFileLabel}`,
    ],
    { encoding: 'utf8', shell: false },
  );
  if (listResult.error || listResult.status !== 0) {
    log('Warning: could not list containers for cleanup — skipping');
    return;
  }
  const ids = listResult.stdout.trim().split('\n').filter(Boolean);
  if (ids.length === 0) {
    log('No existing container to remove');
    return;
  }
  log(`Removing ${ids.length} existing container(s): ${ids.join(', ')}`);
  const rmResult = spawnSync('docker', ['rm', '--force', ...ids], {
    encoding: 'utf8',
    shell: false,
  });
  if (rmResult.error || rmResult.status !== 0) {
    log(
      `Warning: failed to remove container(s): ${rmResult.stderr?.trim() ?? rmResult.error?.message}`,
    );
  }
}

// --- main --------------------------------------------------------------------

(function main() {
  const imageName = readImageFromConfig();
  log(`Config: ${configFile}`);
  log(`Image:  ${imageName}`);
  pullImage(imageName);
  removeExistingContainer();
})();
