/**
 * Unit Tests: checkVersionHandler
 *
 * Pure function — no VS Code host required.
 */

import { expect } from 'chai';
import type { VersionCheckResult } from '@gpg-bridge/shared';
import { checkVersionHandler } from '../extension';

describe('checkVersionHandler', () => {
  it('clean exact match returns { match: true }', () => {
    const result: VersionCheckResult = checkVersionHandler('0.4.0', '0.4.0');
    expect(result.match).to.be.true;
  });

  it('dev build exact match returns { match: true }', () => {
    const result: VersionCheckResult = checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.6+abc');
    expect(result.match).to.be.true;
  });

  it('clean patch mismatch returns { match: false } with agentVersion and requestVersion', () => {
    const result: VersionCheckResult = checkVersionHandler('0.4.0', '0.4.1');
    expect(result.match).to.be.false;
    if (result.match === false) {
      expect(result.agentVersion).to.equal('0.4.0');
      expect(result.requestVersion).to.equal('0.4.1');
    }
  });

  it('dev vs clean mismatch returns { match: false } with agentVersion and requestVersion', () => {
    const result: VersionCheckResult = checkVersionHandler('0.4.0-dev.6+abc', '0.4.0');
    expect(result.match).to.be.false;
    if (result.match === false) {
      expect(result.agentVersion).to.equal('0.4.0-dev.6+abc');
      expect(result.requestVersion).to.equal('0.4.0');
    }
  });

  it('different dev builds returns { match: false } with agentVersion and requestVersion', () => {
    const result: VersionCheckResult = checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.7+def');
    expect(result.match).to.be.false;
    if (result.match === false) {
      expect(result.agentVersion).to.equal('0.4.0-dev.6+abc');
      expect(result.requestVersion).to.equal('0.4.0-dev.7+def');
    }
  });
});
