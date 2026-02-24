#!/usr/bin/env node
// release-guard.js — pre-release validation for commit-and-tag-version
// Enforces two invariants that bumpStrict in conventional-changelog-conventionalcommits@9+
// would handle, but commit-and-tag-version@12 bundles @6.1.0 which lacks that feature.
//
// Guards:
//   1. Working tree must be clean
//   2. At least one visible-type commit must exist since the last semver tag
//
// Visible types are derived from commit-and-tag-version.types in root package.json:
// any entry without "hidden: true" is considered visible (produces a CHANGELOG entry).
// Breaking change commits (! suffix) are always visible regardless of type.
//
// To bypass guard 2 (rare), set env var RELEASE_FORCE=1:
//   RELEASE_FORCE=1 npm run release
// Optionally add --release-as <version> to override the semver bump level.

'use strict';

const { execSync } = require('child_process');
const path = require('path');

// Derive visible types from the single source of truth: commit-and-tag-version.types
// in root package.json. A type is visible when it lacks "hidden: true".
const rootPkg = require(path.join(__dirname, '..', 'package.json'));
const typeEntries = rootPkg?.['commit-and-tag-version']?.types;
if (!Array.isArray(typeEntries) || typeEntries.length === 0) {
  console.error('ERROR: commit-and-tag-version.types is missing or empty in root package.json');
  process.exit(1);
}
const VISIBLE_TYPES = new Set(
  typeEntries.filter((e) => !e.hidden).map((e) => e.type),
);

const CONVENTIONAL_RE = /^(\w+)(?:\([^)]*\))?(!)?:/;

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

// ── Guard 1: clean working tree ───────────────────────────────────────────────
const status = run('git status --porcelain');
if (status) {
  console.error(
    'ERROR: working tree is not clean. Commit or stash all changes before releasing:\n' + status,
  );
  process.exit(1);
}

// ── Guard 2: releasable commits since last tag ────────────────────────────────
// Skip guard 2 if caller explicitly wants a forced version (bootstrap / hotfix)
if (process.env.RELEASE_FORCE) {
  console.log('RELEASE_FORCE set — skipping releasable-commits check');
  process.exit(0);
}

// No tags yet → first release, nothing to check
let lastTag;
try {
  lastTag = run('git describe --tags --abbrev=0');
} catch {
  process.exit(0);
}

const logOutput = run(`git log ${lastTag}..HEAD --format=%s`);
if (!logOutput) {
  console.error(`ERROR: no commits since ${lastTag}. Nothing to release.`);
  process.exit(1);
}

const subjects = logOutput.split('\n').filter(Boolean);
const hasVisible = subjects.some((subject) => {
  const m = subject.match(CONVENTIONAL_RE);
  if (!m) return false;
  // Breaking change (! after type or scope) is always releasable
  if (m[2] === '!') return true;
  return VISIBLE_TYPES.has(m[1]);
});

if (!hasVisible) {
  const hiddenTypes = typeEntries.filter((e) => e.hidden).map((e) => e.type).join('/');
  console.error(
    `ERROR: no releasable commits since ${lastTag}.\n` +
      `All ${subjects.length} commit(s) use hidden types (${hiddenTypes}).\n` +
      `To force a release anyway: RELEASE_FORCE=1 npm run release`,
  );
  process.exit(1);
}
