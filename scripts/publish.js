#!/usr/bin/env node
// publish.js — create GitHub release with VSIX attachments
//
// Usage: npm run publish
//
// Full release process:
//   1. npm run release              (bump version, update changelog, commit, tag)
//   2. git push --follow-tags origin
//   3. npm run publish              (build VSIXs, create GitHub release)
//
// Requires: gh CLI authenticated (gh auth login)

'use strict';

const { spawnSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const ROOT = join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const RED = process.stderr.isTTY ? '\x1b[31m' : '';
const RESET = process.stderr.isTTY ? '\x1b[0m' : '';

if (DRY_RUN) {
  console.log('[dry-run] No changes will be published.\n');
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args = []) {
  const label = args.length ? `${cmd} ${args.join(' ')}` : cmd;
  if (DRY_RUN) {
    console.log(`[dry-run] skipping: ${label}`);
    return;
  }
  console.log(`> ${label}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: args.length === 0 });
  const code = result.status ?? 1;
  if (code !== 0) {
    process.stderr.write(`${RED}ERROR: command exited with code ${code}: ${label}${RESET}\n`);
    process.exit(code);
  }
}

// ── Read version from root package.json ───────────────────────────────────────
const pkg = require(join(ROOT, 'package.json'));
const version = pkg.version;
const tag = `v${version}`;

console.log(`\nPublishing ${tag} to GitHub\n`);

// ── Step 1: Build VSIXs ───────────────────────────────────────────────────────
run('npm run package');

// ── Step 2: Extract release notes from CHANGELOG.md ──────────────────────────
// Grab everything from the first ## [ heading to the line before the second one.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
let start = -1;
let end = lines.length;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('## [')) {
    if (start === -1) {
      start = i;
    } else {
      end = i;
      break;
    }
  }
}
if (start === -1) {
  console.error('ERROR: no release section found in CHANGELOG.md');
  process.exit(1);
}
const notes = lines.slice(start, end).join('\n').trimEnd();
const notesFile = join(tmpdir(), `gpg-bridge-${version}-notes.md`);
writeFileSync(notesFile, notes, 'utf8');
// Clean up temp file on any exit, including process.exit() and uncaught throws.
process.on('exit', () => {
  try {
    unlinkSync(notesFile);
  } catch {
    /* already gone */
  }
});

// ── Step 3: Verify VSIX files exist ───────────────────────────────────────────
const vsixFiles = [
  join(ROOT, 'gpg-bridge-agent', `gpg-bridge-agent-${version}.vsix`),
  join(ROOT, 'gpg-bridge-request', `gpg-bridge-request-${version}.vsix`),
];
for (const p of vsixFiles) {
  if (!existsSync(p)) {
    console.error(`ERROR: VSIX not found: ${p}`);
    process.exit(1);
  }
}

// ── Step 4: Create GitHub release ─────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n[dry-run] release notes:');
  console.log('────────────────────────────────────────');
  console.log(notes);
  console.log('────────────────────────────────────────');
}
run('gh', [
  'release',
  'create',
  tag,
  '--verify-tag',
  '--title',
  tag,
  '--notes-file',
  notesFile,
  ...vsixFiles,
]);
console.log(
  DRY_RUN ? `\n[dry-run] ${tag} — no release created.` : `\nPublished ${tag} successfully.`,
);
