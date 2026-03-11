#!/usr/bin/env node
'use strict';

/**
 * package-dev.js
 *
 * Packages all extensions using a version derived from `git describe`, so
 * dev builds are distinguishable from release builds without modifying any
 * package.json file.
 *
 * Version mapping examples:
 *   v0.4.0-6-ge2ff25c       -> 0.4.1-dev.6+e2ff25c
 *   v0.4.0-6-ge2ff25c-dirty -> 0.4.1-dev.6+e2ff25c.dirty
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// toSemver
// ---------------------------------------------------------------------------

/**
 * Convert `git describe --long` output to a valid semver string.
 *
 * --long always emits <tag>-<count>-g<hash>, even on a tagged commit (count=0),
 * so parsing is unambiguous.
 *
 * Semver structure:
 *   <major>.<minor>.<patch+1>[-dev.<count>][+<hash>[.dirty]]
 *
 * Patch is incremented by 1 when count > 0 or dirty, so dev builds sort
 * above the last release tag and below the next release.
 *
 * Transformation examples:
 *   v0.4.0-0-ge2ff25c       -> error (clean tag)
 *   v0.4.0-0-ge2ff25c-dirty -> 0.4.1-dev.0+dirty
 *   v0.4.0-6-ge2ff25c       -> 0.4.1-dev.6+e2ff25c
 *   v0.4.0-6-ge2ff25c-dirty -> 0.4.1-dev.6+e2ff25c.dirty
 *   anything-unrecognized   -> error
 */
/** @param {string} describe */
function toSemver(describe) {
  const match = describe.match(/^v?(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]+)(-dirty)?$/);
  if (!match) {
    console.error(`ERROR: Unrecognized git describe format: ${describe}`);
    process.exit(1);
  }

  const [, base, count, hash, dirty] = match;
  const isDev = count !== '0' || !!dirty;

  if (!isDev) {
    console.error(
      'ERROR: Workspace is clean and exactly on a release tag. Use `npm run package` for release builds.',
    );
    process.exit(1);
  }

  // Increment patch so dev builds sort above the last release tag
  const [major, minor, patch] = base.split('.').map(Number);
  const resolvedBase = `${major}.${minor}.${patch + 1}`;

  const preRelease = `-dev.${count}`;
  const buildMeta = count !== '0' ? `+${hash}${dirty ? '.dirty' : ''}` : '+dirty';

  return `${resolvedBase}${preRelease}${buildMeta}`;
}

// ---------------------------------------------------------------------------
// --tosemver mode: test toSemver() without calling git or vsce
// ---------------------------------------------------------------------------

const toSemverArg = process.argv.indexOf('--tosemver');
if (toSemverArg !== -1) {
  const inline = process.argv[toSemverArg + 1];
  if (inline) {
    // Value provided directly as argument
    console.log(toSemver(inline));
    process.exit(0);
  } else {
    // No inline value — read from stdin
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      input = input.trim();
      if (!input) {
        console.error('ERROR: --tosemver requires a value via argument or stdin');
        process.exit(1);
      }
      console.log(toSemver(input));
      process.exit(0);
    });
  }
}

// ---------------------------------------------------------------------------
// Resolve git describe version
// ---------------------------------------------------------------------------

if (toSemverArg === -1) {
  let gitDescribe;
  try {
    gitDescribe = execSync('git describe --tags --always --long --dirty', {
      encoding: 'utf8',
      cwd: ROOT,
    }).trim();
  } catch (err) {
    if (err instanceof Error && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      // git binary not found
      console.error('ERROR: git not found. Ensure git is installed and on PATH.');
      process.exit(1);
    }
    // git found but no commits or no tags — treat as untagged dev root
    gitDescribe = '0.0.0-0-g0000000-dirty';
  }

  const version = toSemver(gitDescribe);
  console.log(`git describe : ${gitDescribe}`);
  console.log(`semver       : ${version}`);

  // ---------------------------------------------------------------------------
  // Prepackage
  // ---------------------------------------------------------------------------
  execSync('npm run prepackage', { cwd: ROOT, stdio: 'inherit' });

  // ---------------------------------------------------------------------------
  // Package each extension
  // ---------------------------------------------------------------------------

  const extensions = ['gpg-bridge-agent', 'gpg-bridge-request', 'pack'];

  for (const ext of extensions) {
    const extDir = path.join(ROOT, ext);
    console.log(`\nPackaging ${ext}...`);
    execSync(`npx vsce package ${version} --no-update-package-json --no-git-tag-version`, {
      cwd: extDir,
      stdio: 'inherit',
    });
  }

  console.log('\nDone.');
}
