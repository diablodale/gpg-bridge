/**
 * Unit tests for VSCodeCommandExecutor.
 *
 * Registers stub implementations of the three gpg-bridge-agent commands in the
 * VS Code extension host and verifies that VSCodeCommandExecutor delegates to
 * them correctly, including the sessionId spread logic in connectAgent().
 */

import { expect } from 'chai';
import * as vscode from 'vscode';
import { VSCodeCommandExecutor } from '../services/commandExecutor';

describe('VSCodeCommandExecutor', () => {
  let connectCalls: unknown[][] = [];
  let sendCalls: unknown[][] = [];
  let disconnectCalls: unknown[][] = [];

  const disposables: vscode.Disposable[] = [];

  before(() => {
    disposables.push(
      vscode.commands.registerCommand('_gpg-bridge-agent.connectAgent', (...args: unknown[]) => {
        connectCalls.push(args);
        return { sessionId: 'test-session', greeting: 'OK\n' };
      }),
      vscode.commands.registerCommand('_gpg-bridge-agent.sendCommands', (...args: unknown[]) => {
        sendCalls.push(args);
        return { response: 'S DATA reply\nOK\n' };
      }),
      vscode.commands.registerCommand('_gpg-bridge-agent.disconnectAgent', (...args: unknown[]) => {
        disconnectCalls.push(args);
        return undefined;
      }),
    );
  });

  after(() => {
    disposables.forEach((d) => d.dispose());
  });

  beforeEach(() => {
    connectCalls = [];
    sendCalls = [];
    disconnectCalls = [];
  });

  // -------------------------------------------------------------------------
  // connectAgent
  // -------------------------------------------------------------------------

  it('connectAgent() without sessionId calls the command with no extra args', async () => {
    const executor = new VSCodeCommandExecutor();
    const result = await executor.connectAgent();
    expect(result).to.deep.equal({ sessionId: 'test-session', greeting: 'OK\n' });
    // No extra args — avoids passing undefined across the extension IPC boundary
    expect(connectCalls).to.have.length(1);
    expect(connectCalls[0]).to.deep.equal([]);
  });

  it('connectAgent() with sessionId spreads it as the first argument', async () => {
    const executor = new VSCodeCommandExecutor();
    const result = await executor.connectAgent('existing-session');
    expect(result).to.deep.equal({ sessionId: 'test-session', greeting: 'OK\n' });
    expect(connectCalls[0]).to.deep.equal(['existing-session']);
  });

  // -------------------------------------------------------------------------
  // sendCommands
  // -------------------------------------------------------------------------

  it('sendCommands() passes sessionId and commandBlock to the command', async () => {
    const executor = new VSCodeCommandExecutor();
    const result = await executor.sendCommands('sess-1', 'GETINFO version\n');
    expect(result).to.deep.equal({ response: 'S DATA reply\nOK\n' });
    expect(sendCalls[0]).to.deep.equal(['sess-1', 'GETINFO version\n']);
  });

  // -------------------------------------------------------------------------
  // disconnectAgent
  // -------------------------------------------------------------------------

  it('disconnectAgent() passes sessionId to the command', async () => {
    const executor = new VSCodeCommandExecutor();
    await executor.disconnectAgent('sess-2');
    expect(disconnectCalls[0]).to.deep.equal(['sess-2']);
  });
});
