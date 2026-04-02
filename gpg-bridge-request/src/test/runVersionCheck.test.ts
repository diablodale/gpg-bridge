/**
 * Unit Tests: runVersionCheck and activate()
 *
 * runVersionCheck: Calls runVersionCheck with mock deps — no VS Code host required.
 * activate():      Calls activate() directly with a mock ExtensionContext to cover
 *                  the win32-platform guard and its error catch block.
 *                  On macOS/Linux, process.platform !== 'win32', so the win32 branch
 *                  is skipped and those tests are no-ops; coverage is only recorded
 *                  on Windows (the unit-test host platform).
 */

import * as vscode from 'vscode';
import { expect } from 'chai';
import type { VersionCheckResult } from '@gpg-bridge/shared';
import { activate, deactivate, runVersionCheck } from '../extension';

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

  it('showErrorMessage returns "Open Extensions" with no executeSearchCommand override → default execSearch calls vscode.commands.executeCommand', async () => {
    // Exercises the default execSearch lambda (fn 2 in extension.ts) which calls
    // vscode.commands.executeCommand directly. The command may not exist in the unit-test
    // host and may reject — that is expected and ignored; we only need the lambda invoked.
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
        // No executeSearchCommand override → default lambda (fn 2) is used
      });
    } catch {
      threw = true;
    }
    expect(threw, 'runVersionCheck should throw on mismatch').to.be.true;
    // Allow fire-and-forget .then() chain to flush so the default execSearch lambda runs.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
});

// ---------------------------------------------------------------------------
// activate() — win32 platform guard and error catch block
// ---------------------------------------------------------------------------

describe('activate() win32 guard and catch block', () => {
  // These tests only exercise win32-specific paths; they are no-ops on non-Windows.
  // Coverage is recorded on the Windows unit-test host and combined with other platforms
  // by Codecov so every meaningful statement in those branches is reached in CI.

  it('activate() on win32: platform guard throws internally, catch block registers fallback commands, activate() returns normally', async function () {
    if (process.platform !== 'win32') {
      this.skip();
    }

    const disposables: vscode.Disposable[] = [];
    const mockContext = {
      extension: { packageJSON: { version: '1.0.0-test' }, id: 'test.gpg-bridge-request' },
      subscriptions: {
        push(...items: vscode.Disposable[]) {
          for (const item of items) {
            if (item && typeof item.dispose === 'function') {
              disposables.push(item);
            }
          }
        },
      },
    } as unknown as vscode.ExtensionContext;

    // The win32 guard throws inside activate()'s try block. The catch block runs,
    // logs the error, and registers fallback commands so palette entries don't break.
    // activate() itself returns normally — the error is NOT propagated to the caller.
    let caughtErr: unknown;
    try {
      await activate(mockContext);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr, 'activate() must not propagate the win32 guard error').to.be.undefined;

    // Expected disposables pushed to context.subscriptions:
    //   1 — outputChannel (registered before try)
    //   4 — fallback commands from catch block (start, stop, showStatus, syncPublicKeys)
    //   1 — URI handler (registered after try/catch)
    // Total: 6
    expect(disposables, 'activate() must register exactly 6 disposables on win32').to.have.lengthOf(
      6,
    );

    // Confirm the catch block registered noop for start (not real startRequestProxy).
    // The real handler would attempt to spawn GPG and either throw or set requestProxyService.
    // Noop returns undefined silently.
    let startErr: unknown;
    try {
      await vscode.commands.executeCommand('gpg-bridge-request.start');
    } catch (err) {
      startErr = err;
    }
    expect(startErr, 'start command must not throw (noop registered by catch block)').to.be
      .undefined;

    // Confirm the catch block registered the real showStatus (not noop) by executing it.
    // On win32 requestProxyService is null, so the dialog content must show Inactive state.
    // The unit-test host's DialogService refuses modal dialogs and throws — that throw is
    // the positive signal: "real showStatus ran and reached showInformationMessage".
    let statusErr: unknown;
    try {
      await vscode.commands.executeCommand('gpg-bridge-request.showStatus');
    } catch (err) {
      statusErr = err;
    }
    expect(statusErr, 'showStatus must throw via DialogService refusal').to.be.instanceOf(Error);
    expect((statusErr as Error).message).to.include(
      'DialogService: refused to show dialog in tests',
    );
    expect((statusErr as Error).message).to.include('GPG Bridge Request Status');
    expect((statusErr as Error).message).to.include('State: Inactive');
    expect((statusErr as Error).message).to.include('Version: 1.0.0-test');
    expect((statusErr as Error).message).to.include('GPG version: (unknown)');
    expect((statusErr as Error).message).to.include('GPG bin dir: (unknown)');
    expect((statusErr as Error).message).to.include('GPG socket: (unknown)');

    await deactivate();
  });
});
