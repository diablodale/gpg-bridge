/**
 * Unit Tests: runVersionCheck
 *
 * Calls runVersionCheck with mock deps — no VS Code host required.
 */

import { expect } from 'chai';
import type { VersionCheckResult } from '@gpg-bridge/shared';
import { runVersionCheck } from '../extension';

describe('runVersionCheck', () => {
  it('executeCommand resolves with { match: true } → returns without error', async () => {
    await runVersionCheck('0.4.0', {
      executeCommand: async () => ({ match: true }) satisfies VersionCheckResult,
      showErrorMessage: async () => undefined,
      executeSearchCommand: async () => undefined,
    });
    // reaching here = no throw = success
  });

  it('executeCommand rejects with non-mismatch error → propagates without calling showErrorMessage', async () => {
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

  it('executeCommand resolves with { match: false } → throws and showErrorMessage called with version info', async () => {
    let showErrorCalledWith = '';
    let threw = false;
    try {
      await runVersionCheck('0.4.0', {
        executeCommand: async () =>
          ({
            match: false,
            agentVersion: '0.5.0',
            requestVersion: '0.4.0',
          }) satisfies VersionCheckResult,
        showErrorMessage: async (message: string) => {
          showErrorCalledWith = message;
          return undefined;
        },
        executeSearchCommand: async () => undefined,
      });
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
    expect(showErrorCalledWith).to.include('Incompatible versions of GPG Bridge');
  });

  it('executeCommand resolves with { match: false } and showErrorMessage returns "Open Extensions" → executeSearchCommand called with "hidale.gpg-bridge"', async () => {
    let searchQuery = '';
    let threw = false;
    try {
      await runVersionCheck('0.4.0', {
        executeCommand: async () =>
          ({
            match: false,
            agentVersion: '0.5.0',
            requestVersion: '0.4.0',
          }) satisfies VersionCheckResult,
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
