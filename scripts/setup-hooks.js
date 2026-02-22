// scripts/setup-hooks.js
//
// Installs prek git hooks if running inside a git working tree.
// Called from npm postinstall so hooks are wired up after `npm install`.
// Silently skips when .git is absent (CI environments, package installs outside a repo).

'use strict';

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

const repoRoot = join(__dirname, '..');
const gitDir = join(repoRoot, '.git');

if (existsSync(gitDir)) {
    try {
        execSync('prek install', { stdio: 'inherit', cwd: repoRoot });
    } catch (e) {
        // Non-fatal: hooks are a convenience, not a hard requirement for npm install.
        console.warn('Warning: prek install failed:', e.message);
        console.warn('Run `prek install` manually to set up git hooks.');
    }
} else {
    console.log('Skipping prek install: not running inside a git repository.');
}
