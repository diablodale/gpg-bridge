import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { AgentProxy } from './services/agentProxy';
import { isTestEnvironment, isIntegrationTestEnvironment, extractErrorMessage } from '@gpg-bridge/shared';

// Global agent proxy service instance
let agentProxyService: AgentProxy | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let detectedGpgBinDir: string | null = null;
let resolvedAgentSocketPath: string | null = null;
let probeSuccessful = false;

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('GPG Bridge Agent');
	statusBarItem = vscode.window.createStatusBarItem(context.extension.id, vscode.StatusBarAlignment.Right, 100);

	// This extension is the Windows-side half of the bridge.
	// The os field in package.json prevents marketplace installs on non-win32, but
	// local VSIX installs bypass that check. Guard at runtime so nothing starts.
	if (process.platform !== 'win32') {
        const msg = 'GPG Bridge Agent is inactive. It can only be installed on Windows.';
        outputChannel.appendLine(msg);
        void vscode.window.showErrorMessage(msg);
        return;
    }

	// Register three command handlers for inter-extension communication
	context.subscriptions.push(
		// Internal commands called by request-proxy extension, hidden from user with underscore prefix
		vscode.commands.registerCommand('_gpg-bridge-agent.connectAgent', connectAgent),
		vscode.commands.registerCommand('_gpg-bridge-agent.sendCommands', sendCommands),
		vscode.commands.registerCommand('_gpg-bridge-agent.disconnectAgent', disconnectAgent),
		// UI commands visible to user
		vscode.commands.registerCommand('gpg-bridge-agent.start', startAgentProxy),
		vscode.commands.registerCommand('gpg-bridge-agent.stop', stopAgentProxy),
		vscode.commands.registerCommand('gpg-bridge-agent.showStatus', showStatus),
		outputChannel,
		statusBarItem
	);

	outputChannel.appendLine('Commands registered');

	// Update status bar
	statusBarItem.name = 'GPG Bridge Agent';
	statusBarItem.command = 'gpg-bridge-agent.showStatus';
	updateStatusBar();
	statusBarItem.show();

	// Start agent proxy (detects GnuPG bin dir and socket path internally).
	// isIntegrationTestEnvironment() overrides isTestEnvironment() so integration
	// tests get full extension initialization (unit tests still skip init).
	if (!isTestEnvironment() || isIntegrationTestEnvironment()) {
		try {
			await startAgentProxy();

			// Run sanity probe in background (fire-and-forget)
			// It will update status bar to Ready after successful probe
			probeGpgAgent();
		} catch (error: unknown) {
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
 * Command: _gpg-agent-proxy.connectAgent
 *
 * Called by request-proxy to establish a connection to gpg-agent.
 * Returns a sessionId and greeting that must be relayed to the client.
 */
async function connectAgent(sessionId?: string): Promise<{ sessionId: string; greeting: string }> {
	if (!agentProxyService) {
		throw new Error('Agent proxy not initialized. Please start the extension.');
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
async function sendCommands(sessionId: string, commandBlock: string): Promise<{ response: string }> {
	if (!agentProxyService) {
		throw new Error('Agent proxy not initialized. Please start the extension.');
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
		throw new Error('Agent proxy not initialized.');
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
 * Detect GnuPG bin directory.
 * Throws if gpgconf.exe cannot be found.
 */
async function detectGpgBinDir(): Promise<void> {
	const config = vscode.workspace.getConfiguration('gpgBridgeAgent');
	const configPath = config.get<string>('gpgBinDir') || '';

	// If a path is explicitly configured, use it exclusively — do not fall back to
	// auto-detection.  An invalid configured path is a user error and should fail loudly.
	if (configPath) {
		const gpgconfPath = path.join(configPath, 'gpgconf.exe');
		if (fs.existsSync(gpgconfPath)) {
			detectedGpgBinDir = configPath;
			resolveAgentSocketPath();
			return;
		}
		throw new Error(`GnuPG bin not found at configured path: ${configPath}`);
	}

	// Check 64-bit default locations
	const gpg4win64Paths = [
		'C:\\Program Files\\GnuPG\\bin',
		'C:\\Program Files\\Gpg4win\\bin'
	];

	for (const checkPath of gpg4win64Paths) {
		const gpgconfPath = path.join(checkPath, 'gpgconf.exe');
		if (fs.existsSync(gpgconfPath)) {
			detectedGpgBinDir = checkPath;
			resolveAgentSocketPath();
			return;
		}
	}

	// Check 32-bit (x86) default locations
	const gpg4win32Paths = [
		'C:\\Program Files (x86)\\GnuPG\\bin',
		'C:\\Program Files (x86)\\Gpg4win\\bin'
	];

	for (const checkPath of gpg4win32Paths) {
		const gpgconfPath = path.join(checkPath, 'gpgconf.exe');
		if (fs.existsSync(gpgconfPath)) {
			detectedGpgBinDir = checkPath;
			resolveAgentSocketPath();
			return;
		}
	}

	throw new Error('GnuPG bin not found. Please install Gpg4win or set gpgBridgeAgent.gpgBinDir.');
}

/**
 * Resolve the GPG agent socket path by querying gpgconf.
 * Sets resolvedAgentSocketPath to the path reported by gpgconf.
 * Throws if the path cannot be resolved.
 */
function resolveAgentSocketPath(): void {
	if (!detectedGpgBinDir) {
		throw new Error('resolveAgentSocketPath() called before gpg bin dir was set');
	}

	const gpgconfPath = path.join(detectedGpgBinDir, 'gpgconf.exe');
	if (!fs.existsSync(gpgconfPath)) {
		throw new Error(`gpgconf not found at: ${gpgconfPath}`);
	}

	let result;
	try {
		result = spawnSync(gpgconfPath, ['--list-dirs', 'agent-extra-socket'], {
			encoding: 'utf8',
			timeout: 2000
		});
	} catch (error) {
		throw new Error(`Failed to run gpgconf: ${extractErrorMessage(error)}`);
	}

	if (result.status !== 0 || !result.stdout?.trim()) {
		throw new Error(`gpgconf failed to report agent-extra-socket (exit ${result.status})`);
	}

	resolvedAgentSocketPath = result.stdout.trim();
	outputChannel.appendLine(`Resolved GPG agent extra socket path: ${resolvedAgentSocketPath}`);
}

/**
 * Start the agent proxy service
 */
async function startAgentProxy(): Promise<void> {
	if (isTestEnvironment() && !isIntegrationTestEnvironment()) {
		return;
	}
	if (agentProxyService) {
		vscode.window.showWarningMessage('Agent proxy already running');
		return;
	}

	try {
		// Ensure GnuPG bin dir and agent socket path are resolved.
		// detectGpgBinDir() calls resolveAgentSocketPath() internally; both throw on failure.
		if (!detectedGpgBinDir || !resolvedAgentSocketPath) {
			await detectGpgBinDir();
		}

		outputChannel.appendLine('Starting agent proxy...');

		// Create a log callback that respects the debugLogging setting
		const config = vscode.workspace.getConfiguration('gpgBridgeAgent');
		const debugLogging = config.get<boolean>('debugLogging') || true;	// TODO remove forced debug logging
		const logCallback = debugLogging ? (message: string) => outputChannel.appendLine(message) : undefined;

		agentProxyService = new AgentProxy({
			gpgAgentSocketPath: resolvedAgentSocketPath!,
			logCallback: logCallback,
			statusBarCallback: () => updateStatusBar()
		});

		outputChannel.appendLine('Agent proxy initialized. Probe of gpg-agent in process. Status will be READY when complete.');
	} catch (error) {
		const errorMessage = extractErrorMessage(error);
		outputChannel.appendLine(`Error starting agent proxy: ${errorMessage}`);
		outputChannel.show(true);
		vscode.window.showErrorMessage(`Failed to start agent proxy: ${errorMessage}`);
		agentProxyService = null;
		throw error; // propagate so callers (commands, tests) can observe failure
	}
}

/**
 * Stop the agent proxy service
 */
async function stopAgentProxy(): Promise<void> {
	if (!agentProxyService) {
		vscode.window.showInformationMessage('Agent proxy is not running');
		return;
	}

	outputChannel.appendLine('Stopping agent proxy...');
	await agentProxyService.stop();
	agentProxyService = null;
	// Reset resolved state so the next start re-detects (e.g. if gpgBinDir changed).
	detectedGpgBinDir = null;
	resolvedAgentSocketPath = null;
	probeSuccessful = false;

	updateStatusBar();
	outputChannel.appendLine('Agent proxy stopped');
	vscode.window.showInformationMessage('Agent proxy stopped');
}

/**
 * Show agent proxy status
 */
function showStatus(): void {
	const gpgBinDir = detectedGpgBinDir || '(not detected)';
	const agentSocket = resolvedAgentSocketPath || '(not detected)';

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
		`GPG agent: ${agentSocket}`
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

	if (agentProxyService && probeSuccessful) {
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
		label: tooltip
	};
}

/**
 * Sanity probe: Send GETINFO version to verify agent is responsive
 * Runs async after activation, doesn't block startup
 * Sets probeSuccessful flag and updates status bar
 */
async function probeGpgAgent(): Promise<void> {
	if (!agentProxyService) {
		return;
	}

	try {
		const result = await agentProxyService.connectAgent();
		await agentProxyService.sendCommands(result.sessionId, 'GETINFO version\n');
		await agentProxyService.disconnectAgent(result.sessionId);
		outputChannel.appendLine('Probe of gpg-agent succeeded. Agent proxy is READY.');
		probeSuccessful = true;
		updateStatusBar();
	} catch (error) {
		const msg = extractErrorMessage(error);
		outputChannel.appendLine(`Probe of gpg-agent failed. Agent proxy is NOT READY: ${msg}`);
	}
}
