import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { AgentProxy } from './services/agentProxy';

// Agent proxy state management
let agentProxyService: AgentProxy | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let detectedGpg4winPath: string | null = null;
let detectedAgentSocket: string | null = null;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('GPG Agent Proxy');
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

	outputChannel.appendLine('GPG Agent Proxy activated');

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('gpg-agent-proxy.start', startAgentProxy),
		vscode.commands.registerCommand('gpg-agent-proxy.stop', stopAgentProxy),
		vscode.commands.registerCommand('gpg-agent-proxy.restart', restartAgentProxy),
		vscode.commands.registerCommand('gpg-agent-proxy.showStatus', showStatus),
		vscode.commands.registerCommand('gpg-agent-proxy.getProxyPort', getProxyPort),
		vscode.commands.registerCommand('gpg-agent-proxy.ensureAgentProxyRunning', ensureAgentProxyRunning),
		outputChannel,
		statusBarItem
	);

	outputChannel.appendLine('Commands registered');

	// Update status bar
	updateStatusBar();
	statusBarItem.show();

	// Detect Gpg4win and agent socket on startup (async, will complete in background)
	detectGpg4winPath().catch(() => {
		// Silently ignore if gpg4win detection fails
	});

	// Auto-start agent proxy by default (can be disabled with autoStart: false)
	const config = vscode.workspace.getConfiguration('gpgAgentProxy');
	if (config.get('autoStart', true)) {
		outputChannel.appendLine('Auto-starting agent proxy...');
		startAgentProxy().catch((error: unknown) => {
			outputChannel.appendLine(`Auto-start failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}
}

// Get the configured proxy port
function getConfiguredProxyPort(): number {
	const config = vscode.workspace.getConfiguration('gpgAgentProxy');
	return config.get<number>('proxyPort') || 63331;
}

// Detect Gpg4win installation path
async function detectGpg4winPath(): Promise<void> {
	const config = vscode.workspace.getConfiguration('gpgAgentProxy');
	const configPath = config.get<string>('gpg4winPath') || '';

	// Check configured path first
	if (configPath) {
		const gpgconfPath = path.join(configPath, 'gpgconf.exe');
		if (fs.existsSync(gpgconfPath)) {
			detectedGpg4winPath = configPath;
			detectAgentSocket();
			return;
		}
	}

	// Check 64-bit default locations
	const gpg4win64Paths = [
		'C:\\Program Files\\GnuPG\\bin',
		'C:\\Program Files\\Gpg4win\\bin'
	];

	for (const checkPath of gpg4win64Paths) {
		const gpgconfPath = path.join(checkPath, 'gpgconf.exe');
		if (fs.existsSync(gpgconfPath)) {
			detectedGpg4winPath = checkPath;
			detectAgentSocket();
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
			detectedGpg4winPath = checkPath;
			detectAgentSocket();
			return;
		}
	}

	outputChannel.appendLine('Gpg4win not found. Please install Gpg4win or configure path.');
}

// Detect GPG agent socket path
function detectAgentSocket(): void {
	if (!detectedGpg4winPath) {
		return;
	}

	const gpgconfPath = path.join(detectedGpg4winPath, 'gpgconf.exe');
	if (!fs.existsSync(gpgconfPath)) {
		return;
	}

	try {
		const result = spawnSync(gpgconfPath, ['--list-dir', 'agent-socket'], {
			encoding: 'utf8',
			timeout: 2000
		});

		if (result.status === 0 && result.stdout) {
			detectedAgentSocket = result.stdout.trim();
			outputChannel.appendLine(`Detected GPG agent socket: ${detectedAgentSocket}`);
		}
	} catch (error) {
		// Silently fail
	}
}

// Get request proxy port (called by remote extension via command)
async function getProxyPort(): Promise<number> {
	if (!agentProxyService?.isRunning()) {
		throw new Error('Agent proxy is not running');
	}
	return getConfiguredProxyPort();
}

// Ensure agent proxy is running and return port
async function ensureAgentProxyRunning(): Promise<number> {
	if (!agentProxyService?.isRunning()) {
		outputChannel.appendLine('Request to ensure agent proxy running...');
		await startAgentProxy();
	}

	if (!agentProxyService?.isRunning()) {
		throw new Error('Failed to start agent proxy');
	}

	return getConfiguredProxyPort();
}

// Start the agentProxyService
async function startAgentProxy(): Promise<void> {
	if (agentProxyService?.isRunning()) {
		vscode.window.showWarningMessage('Agent proxy is already running');
		return;
	}

	try {
		if (!detectedGpg4winPath || !detectedAgentSocket) {
			// Try detecting again
			await detectGpg4winPath();
			if (!detectedAgentSocket) {
				throw new Error('Gpg4win not found. Please install Gpg4win or configure path.');
			}
		}

		outputChannel.appendLine('Starting agent proxy...');

		const config = vscode.workspace.getConfiguration('gpgAgentProxy');
		const debugLogging = config.get<boolean>('debugLogging') || false;
		const proxyPort = getConfiguredProxyPort();

		agentProxyService = new AgentProxy({
			gpgAgentSocketPath: detectedAgentSocket,
			proxyPort: proxyPort,
			debugLogging: debugLogging
		});

		agentProxyService.setLogCallback((message: string) => outputChannel.appendLine(message));
		outputChannel.appendLine(`GPG agent socket: ${detectedAgentSocket}`);
		outputChannel.appendLine(`Assuan TCP port: ${agentProxyService.getAssuanPort()}`);
		outputChannel.appendLine(`Proxy port: ${proxyPort}`);

		outputChannel.appendLine('Starting agent proxy...');
		await agentProxyService.start();
		outputChannel.appendLine('Agent proxy started successfully');

		updateStatusBar(true);
		vscode.window.showInformationMessage(`Agent proxy started on localhost:${proxyPort}`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(`Error starting agent proxy: ${errorMessage}`);
		outputChannel.show(true);
		vscode.window.showErrorMessage(`Failed to start agent proxy: ${errorMessage}`);
		agentProxyService = null;
	}
}

// Stop the agent proxy
async function stopAgentProxy(): Promise<void> {
	if (!agentProxyService?.isRunning()) {
		vscode.window.showInformationMessage('Agent proxy is not running');
		return;
	}

	outputChannel.appendLine('Stopping agent proxy...');
	await agentProxyService.stop();
	agentProxyService = null;

	updateStatusBar(false);
	outputChannel.appendLine('Agent proxy stopped');
	vscode.window.showInformationMessage('Agent proxy stopped');
}

// Restart the agent proxy
async function restartAgentProxy(): Promise<void> {
	await stopAgentProxy();
	await new Promise((resolve) => setTimeout(resolve, 500));
	await startAgentProxy();
}

// Show agent proxy status
function showStatus(): void {
	const isRunning = agentProxyService?.isRunning() || false;
	const gpg4winPath = detectedGpg4winPath || '(not detected)';
	const agentSocket = detectedAgentSocket || '(not detected)';
	const config = vscode.workspace.getConfiguration('gpgAgentProxy');

	const status = [
		'GPG Agent Proxy Status',
		'',
		`Agent proxy: ${isRunning ? 'Running' : 'Stopped'}`,
		`Auto-start: ${config.get('autoStart') ? 'Enabled' : 'Disabled'}`,
		'',
		`Gpg4win: ${gpg4winPath}`,
		`GPG agent socket: ${agentSocket}`,
		`Proxy port: ${getConfiguredProxyPort()}`
	].join('\n');

	vscode.window.showInformationMessage(status, { modal: true });
	outputChannel.show();
}

// Update the status bar item
function updateStatusBar(running?: boolean): void {
	const isRunning = running ?? (agentProxyService?.isRunning() || false);

	if (isRunning) {
		statusBarItem.text = '$(key) GPG Agent Proxy: Active';
		statusBarItem.tooltip = 'GPG agent proxy is running';
	} else {
		statusBarItem.text = '$(key) GPG Agent Proxy: Inactive';
		statusBarItem.tooltip = 'GPG agent proxy is not running';
	}

	statusBarItem.command = 'gpg-agent-proxy.showStatus';
}

// This method is called when your extension is deactivated
export function deactivate(): void {
	if (agentProxyService?.isRunning()) {
		agentProxyService.stop().catch(() => {
			// Silently ignore cleanup errors
		});
	}
}
