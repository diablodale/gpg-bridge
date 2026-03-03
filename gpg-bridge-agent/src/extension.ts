import * as vscode from 'vscode';
import { AgentProxy } from './services/agentProxy';
import {
  GpgCli,
  isTestEnvironment,
  isIntegrationTestEnvironment,
  extractErrorMessage,
} from '@gpg-bridge/shared';
import type { KeyFilter } from '@gpg-bridge/shared';

// Global GPG Bridge Agent service instance
let agentProxyService: AgentProxy | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('GPG Bridge Agent');
  statusBarItem = vscode.window.createStatusBarItem(
    context.extension.id,
    vscode.StatusBarAlignment.Right,
    100,
  );

  // Register three command handlers for inter-extension communication
  context.subscriptions.push(
    // ── Trust model for internal commands ──────────────────────────────────
    // The underscore prefix is the VS Code convention for "internal" commands:
    // it hides them from the command palette so users don't see them, but it
    // does NOT restrict which extensions can call them. Any co-installed VS Code
    // extension running in the same extension host can invoke these commands via
    // vscode.commands.executeCommand('_gpg-bridge-agent.*', ...).
    //
    // This is an accepted architectural constraint for the single-user
    // dev-container scenario this extension targets. The practical mitigations are:
    //   1. Each handler throws (rejects) when agentProxyService === null, so
    //      commands called before activation or after deactivation are rejected.
    //   2. The bridge connects only to agent-extra-socket, where gpg-agent itself
    //      enforces command restrictions — returning ERR 67109115 Forbidden for
    //      sensitive operations (PRESET_PASSPHRASE, CLEAR_PASSPHRASE, etc.).
    //   3. On startup, AgentProxy.start() actively verifies the socket IS the extra
    //      socket by sending GETEVENTCOUNTER and asserting ERR Forbidden. This
    //      command has been forbidden on the extra socket since GnuPG 2.1.
    //      If it succeeds (standard socket or renamed/linked substitute), startup
    //      is aborted. This is a pure read — no gpg-agent state is modified.
    //   4. All operations require a caller-provided sessionId that maps to an
    //      active session; unknown sessionIds are silently ignored or rejected.
    // ────────────────────────────────────────────────────────────────────────

    // Internal commands called by request-proxy extension, hidden from user with underscore prefix
    vscode.commands.registerCommand('_gpg-bridge-agent.connectAgent', connectAgent),
    vscode.commands.registerCommand('_gpg-bridge-agent.sendCommands', sendCommands),
    vscode.commands.registerCommand('_gpg-bridge-agent.disconnectAgent', disconnectAgent),
    vscode.commands.registerCommand('_gpg-bridge-agent.exportPublicKeys', exportPublicKeysCommand),
    // UI commands visible to user
    vscode.commands.registerCommand('gpg-bridge-agent.start', startAgentProxy),
    vscode.commands.registerCommand('gpg-bridge-agent.stop', stopAgentProxy),
    vscode.commands.registerCommand('gpg-bridge-agent.showStatus', showStatus),
    outputChannel,
    statusBarItem,
  );

  outputChannel.appendLine('Commands registered');

  // Update status bar
  statusBarItem.name = 'GPG Bridge Agent';
  statusBarItem.command = 'gpg-bridge-agent.showStatus';
  updateStatusBar();
  statusBarItem.show();

  // Start GPG Bridge Agent (detects GnuPG bin dir, resolves socket path, and runs the
  // extra-socket probe — all inside start()). Throws on any failure.
  // isIntegrationTestEnvironment() overrides isTestEnvironment() so integration
  // tests get full extension initialization (unit tests still skip init).
  if (!isTestEnvironment() || isIntegrationTestEnvironment()) {
    try {
      await startAgentProxy();
    } catch (error: unknown) {
      // startAgentProxy() logs, shows its own error dialog, and cleans up agentProxyService
      outputChannel.appendLine(`Start failed: ${extractErrorMessage(error)}`);
    }
  }
}

export function deactivate() {
  return agentProxyService?.stop();
}

// TODO Issue Reporting as defined at https://code.visualstudio.com/api/get-started/wrapping-up#issue-reporting

// ==============================================================================
// Command handlers for inter-extension communication
// ==============================================================================

/**
 * Command: _gpg-bridge-agent.exportPublicKeys
 *
 * Called by request-proxy (or for manual use) to export public keys from the GPG keyring.
 * Returns the exported key data as an ASCII-armored string, or undefined if nothing was exported.
 */
async function exportPublicKeysCommand(filter?: KeyFilter): Promise<string | undefined> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  // TODO updateStatusBar to indicate export in progress
  try {
    const result = await agentProxyService.exportPublicKeys(filter);
    outputChannel.appendLine(
      `[exportPublicKeys] filter=${filter ?? '(interactive)'} → ${result ? result.length : 0} chars`,
    );
    return result;
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[exportPublicKeys] Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.connectAgent
 *
 * Called by request-proxy to establish a connection to gpg-agent.
 * Returns a sessionId and greeting that must be relayed to the client.
 */
async function connectAgent(sessionId?: string): Promise<{ sessionId: string; greeting: string }> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  try {
    const result = await agentProxyService.connectAgent(sessionId);
    outputChannel.appendLine(`[connectAgent] Session created: ${result.sessionId}`);
    outputChannel.appendLine(`[connectAgent] Returning: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[connectAgent] Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.sendCommands
 *
 * Called by request-proxy to send a command block to gpg-agent.
 * commandBlock: complete command (e.g., "GETINFO version\n" or "D data\nEND\n")
 * Returns the complete response from gpg-agent.
 */
async function sendCommands(
  sessionId: string,
  commandBlock: string,
): Promise<{ response: string }> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  try {
    const result = await agentProxyService.sendCommands(sessionId, commandBlock);
    outputChannel.appendLine(`[sendCommands] Session ${sessionId}: sent and received response`);
    return result;
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[sendCommands] Session ${sessionId}: Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.disconnectAgent
 *
 * Called by request-proxy to close a session.
 * sessionId: the session to disconnect
 */
async function disconnectAgent(sessionId: string): Promise<void> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized.');
  }

  try {
    await agentProxyService.disconnectAgent(sessionId);
    outputChannel.appendLine(`[disconnectAgent] Session closed: ${sessionId}`);
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[disconnectAgent] Session ${sessionId}: Error: ${msg}`);
    throw error;
  }
}

// ==============================================================================
// UI command handlers
// ==============================================================================

/**
 * Start the GPG Bridge Agent service
 */
async function startAgentProxy(): Promise<void> {
  if (isTestEnvironment() && !isIntegrationTestEnvironment()) {
    return;
  }
  if (agentProxyService) {
    vscode.window.showWarningMessage('GPG Bridge Agent already running');
    return;
  }

  try {
    outputChannel.appendLine('Starting GPG Bridge Agent...');

    const config = vscode.workspace.getConfiguration('gpgBridgeAgent');
    const gpgBinDir = config.get<string>('gpgBinDir') ?? '';
    const debugLogging = config.get<boolean>('debugLogging') ?? false;
    const logCallback = debugLogging
      ? (message: string) => outputChannel.appendLine(message)
      : undefined;

    agentProxyService = new AgentProxy(
      { logCallback, statusBarCallback: () => updateStatusBar() },
      { gpgCliFactory: { create: () => new GpgCli({ gpgBinDir: gpgBinDir || undefined }) } },
    );
    await agentProxyService.start();

    // start() includes the extra-socket probe — reaching here means probe succeeded
    updateStatusBar();
    outputChannel.appendLine('GPG Bridge Agent started. Status: READY.');
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    outputChannel.appendLine(`Error starting GPG Bridge Agent: ${errorMessage}`);
    outputChannel.show(true);
    vscode.window.showErrorMessage(`Failed to start GPG Bridge Agent: ${errorMessage}`);
    // stop() cleans up any partially-initialized GpgCli resources before we discard the instance
    await agentProxyService?.stop();
    agentProxyService = null;
    throw error; // propagate so callers (commands, tests) can observe failure
  }
}

/**
 * Stop the GPG Bridge Agent service
 */
async function stopAgentProxy(): Promise<void> {
  if (!agentProxyService) {
    vscode.window.showInformationMessage('GPG Bridge Agent is not running');
    return;
  }

  outputChannel.appendLine('Stopping GPG Bridge Agent...');
  await agentProxyService.stop();
  agentProxyService = null;

  updateStatusBar();
  outputChannel.appendLine('GPG Bridge Agent stopped');
  vscode.window.showInformationMessage('GPG Bridge Agent stopped');
}

/**
 * Show GPG Bridge Agent status
 */
function showStatus(): void {
  const gpgBinDir = agentProxyService?.getGpgBinDir() ?? '(not detected)';
  const agentSocket = agentProxyService?.getAgentSocketPath() ?? '(not detected)';

  let state = 'Inactive';
  let sessionCount = 0;
  if (agentProxyService) {
    sessionCount = agentProxyService.getSessionCount();
    state = sessionCount > 0 ? 'Active' : 'Ready';
  }

  const status = [
    'GPG Bridge Agent Status',
    '',
    `State: ${state}${sessionCount > 0 ? ` (${sessionCount} session${sessionCount > 1 ? 's' : ''})` : ''}`,
    `GPG bin dir: ${gpgBinDir}`,
    `GPG agent: ${agentSocket}`,
  ].join('\n');

  vscode.window.showInformationMessage(status, { modal: true });
  outputChannel.show();
}

/**
 * Update the status bar item
 */
function updateStatusBar(): void {
  let icon = '$(circle-slash)';
  let tooltip = 'GPG Bridge Agent is not ready';

  if (agentProxyService) {
    const sessionCount = agentProxyService.getSessionCount();
    if (sessionCount > 0) {
      icon = '$(sync~spin)';
      tooltip = `GPG Bridge Agent is active with ${sessionCount} session${sessionCount > 1 ? 's' : ''}`;
    } else {
      icon = '$(check)';
      tooltip = 'GPG Bridge Agent is ready';
    }
  }

  statusBarItem.text = `${icon} GPG`;
  statusBarItem.tooltip = tooltip;
  statusBarItem.accessibilityInformation = {
    label: tooltip,
  };
}
