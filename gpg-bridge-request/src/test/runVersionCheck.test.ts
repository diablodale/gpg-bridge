/**
 * Unit Tests: runVersionCheck
 *
 * Calls runVersionCheck with mock deps — no VS Code host required.
 */

import { expect } from 'chai';
import { VersionError } from '@gpg-bridge/shared';
import { runVersionCheck } from '../extension';

describe('runVersionCheck', () => {
  it('executeCommand resolves with true → returns true', async () => {
    const result = await runVersionCheck('0.4.0', {
      executeCommand: async () => true,
      showErrorMessage: async () => undefined,
      executeSearchCommand: async () => undefined,
    });
    expect(result).to.be.true;
  });

  it('executeCommand rejects with non-VersionError → error propagates (not caught as mismatch)', async () => {
    const networkError = new Error('Command not found');
    let threw = false;
    let thrownError: unknown;
    try {
      await runVersionCheck('0.4.0', {
        executeCommand: async () => {
          throw networkError;
        },
        showErrorMessage: async () => {
          throw new Error('should not be called');
        },
        executeSearchCommand: async () => undefined,
      });
    } catch (err) {
      threw = true;
      thrownError = err;
    }
    expect(threw).to.be.true;
    expect(thrownError).to.equal(networkError);
  });

  it('executeCommand rejects with VersionError → throws and showErrorMessage called with error text', async () => {
    let showErrorCalledWith = '';
    let threw = false;
    let thrownError: unknown;
    try {
      await runVersionCheck('0.4.0', {
        executeCommand: async () => {
          throw new VersionError('Version mismatch: agent=0.5.0, request=0.4.0');
        },
        showErrorMessage: async (message: string) => {
          showErrorCalledWith = message;
          return undefined;
        },
        executeSearchCommand: async () => undefined,
      });
    } catch (err) {
      threw = true;
      thrownError = err;
    }
    expect(threw).to.be.true;
    expect(thrownError).to.be.instanceOf(VersionError);
    expect(showErrorCalledWith).to.include('Version mismatch: agent=0.5.0, request=0.4.0');
  });

  it('executeCommand rejects with VersionError and showErrorMessage returns "Open Extensions" → executeSearchCommand called with "hidale.gpg-bridge"', async () => {
    let searchQuery = '';
    let threw = false;
    try {
      await runVersionCheck('0.4.0', {
        executeCommand: async () => {
          throw new VersionError('Version mismatch: agent=0.5.0, request=0.4.0');
        },
        showErrorMessage: async () => 'Open Extensions',
        executeSearchCommand: async (_cmd: string, query: string) => {
          searchQuery = query;
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
    expect(searchQuery).to.equal('hidale.gpg-bridge');
  });
});
