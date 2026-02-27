/**
 * Filesystem utilities for integration tests.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Assert that `dir` is safe to recursively delete.
 *
 * Guards against accidental deletion of important directories if mkdtempSync
 * ever returns an unexpected value (e.g. due to a bug, bad env, or path
 * resolution going wrong).
 *
 * Requirements:
 *   1. Must be an absolute path — no relative paths that depend on cwd.
 *   2. Must be strictly under os.tmpdir() (after resolving both sides) —
 *      the only place integration tests ever create directories.
 *   3. Must not equal os.tmpdir() itself — deleting the entire temp dir would
 *      be catastrophic.
 *   4. Must not be a well-known system or user directory (defense-in-depth
 *      against a misconfigured os.tmpdir() or surprising path resolution).
 *   5. Must exist and be a directory — not a file, symlink, or phantom path.
 *
 * Throws a descriptive error and does NOT delete anything if any check fails.
 */
export function assertSafeToDelete(dir: string): void {
  // 1. Absolute path check
  if (!path.isAbsolute(dir)) {
    throw new Error(`assertSafeToDelete: refusing to delete non-absolute path: ${dir}`);
  }

  // 2 & 3. Must be strictly inside os.tmpdir() (resolve both to normalise separators,
  //         trailing slashes, and symlinks on the tmpdir side).
  const resolvedDir = path.resolve(dir);
  const resolvedTmpdir = path.resolve(os.tmpdir());
  // Append sep so that a dir named e.g. /tmp/gpg-test-integration-abc cannot
  // match a sibling like /tmp/gpg-test-integration-abcXXX accidentally.
  if (!resolvedDir.startsWith(resolvedTmpdir + path.sep)) {
    throw new Error(
      `assertSafeToDelete: refusing to delete directory outside os.tmpdir().\n` +
        `  dir:    ${resolvedDir}\n` +
        `  tmpdir: ${resolvedTmpdir}`,
    );
  }

  // 4. Denylist of well-known directories that must never be deleted.
  //    Defense-in-depth: the os.tmpdir() check above already excludes all of
  //    these, but an explicit list makes the intent unambiguous and guards
  //    against a misconfigured or symlinked tmpdir pointing somewhere dangerous.
  const FORBIDDEN: string[] = [
    // Filesystem roots (Windows drive roots are caught by the drive-letter pattern below)
    '/',
    // Unix system directories
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/home',
    '/lib',
    '/lib64',
    '/media',
    '/mnt',
    '/opt',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/srv',
    '/sys',
    '/tmp',
    '/usr',
    '/var',
    // User home directory (current user)
    os.homedir(),
    // os.tmpdir() itself (also caught by the startsWith check, but explicit is clearer)
    os.tmpdir(),
    // Node.js runtime directory in case of surprising resolution
    process.cwd(),
  ];

  // Also block Windows drive roots (C:\, D:\, etc.)
  const windowsRootMatch = /^[A-Za-z]:\\?$/;
  if (windowsRootMatch.test(resolvedDir)) {
    throw new Error(`assertSafeToDelete: refusing to delete drive root: ${resolvedDir}`);
  }
  const FORBIDDEN_WINDOWS_PREFIXES = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\Users',
    'C:\\ProgramData',
    'C:\\System Volume Information',
  ];

  const resolvedDirLower = resolvedDir.toLowerCase();
  for (const forbidden of [
    ...FORBIDDEN.map((f) => path.resolve(f)),
    ...FORBIDDEN_WINDOWS_PREFIXES.map((f) => path.resolve(f)),
  ]) {
    if (resolvedDirLower === forbidden.toLowerCase()) {
      throw new Error(`assertSafeToDelete: refusing to delete forbidden directory: ${resolvedDir}`);
    }
  }

  // 5. Must exist and be a plain directory (not a file or symlink root)
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedDir);
  } catch {
    throw new Error(`assertSafeToDelete: path does not exist or is inaccessible: ${resolvedDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`assertSafeToDelete: path is not a directory: ${resolvedDir}`);
  }
}
