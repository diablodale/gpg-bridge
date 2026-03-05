/**
 * Unit Tests: checkVersionHandler
 *
 * Pure function — no VS Code host required.
 */

import { expect } from 'chai';
import { VersionError } from '@gpg-bridge/shared';
import { checkVersionHandler } from '../extension';

describe('checkVersionHandler', () => {
  it('clean exact match returns true without throwing', () => {
    expect(() => checkVersionHandler('0.4.0', '0.4.0')).to.not.throw();
    expect(checkVersionHandler('0.4.0', '0.4.0')).to.be.true;
  });

  it('dev build exact match returns true without throwing', () => {
    expect(() => checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.6+abc')).to.not.throw();
    expect(checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.6+abc')).to.be.true;
  });

  it('clean patch mismatch throws VersionError with both versions in message', () => {
    expect(() => checkVersionHandler('0.4.0', '0.4.1'))
      .to.throw(VersionError)
      .with.property('message')
      .that.includes('agent=0.4.0')
      .and.includes('request=0.4.1');
  });

  it('dev vs clean mismatch throws VersionError with both versions in message', () => {
    expect(() => checkVersionHandler('0.4.0-dev.6+abc', '0.4.0'))
      .to.throw(VersionError)
      .with.property('message')
      .that.includes('agent=0.4.0-dev.6+abc')
      .and.includes('request=0.4.0');
  });

  it('different dev builds throws VersionError with both versions in message', () => {
    expect(() => checkVersionHandler('0.4.0-dev.6+abc', '0.4.0-dev.7+def'))
      .to.throw(VersionError)
      .with.property('message')
      .that.includes('agent=0.4.0-dev.6+abc')
      .and.includes('request=0.4.0-dev.7+def');
  });
});
