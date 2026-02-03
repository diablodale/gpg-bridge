"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const assuanBridge_1 = require("./services/assuanBridge");
// Bridge state management
let bridge = null;
let outputChannel;
let statusBarItem;
let detectedGpg4winPath = null;
let detectedAgentSocket = null;
// This method is called when your extension is activated
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('GPG Windows Relay');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    outputChannel.appendLine('🔐 GPG Windows Relay Bridge activated');
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('gpg-windows-relay.start', startBridge), vscode.commands.registerCommand('gpg-windows-relay.stop', stopBridge), vscode.commands.registerCommand('gpg-windows-relay.restart', restartBridge), vscode.commands.registerCommand('gpg-windows-relay.showStatus', showStatus), vscode.commands.registerCommand('gpg-windows-relay.getRelayPort', getRelayPort), vscode.commands.registerCommand('gpg-windows-relay.ensureBridgeRunning', ensureBridgeRunning), outputChannel, statusBarItem);
    outputChannel.appendLine('✅ Commands registered');
    // Update status bar
    updateStatusBar();
    statusBarItem.show();
    // Detect Gpg4win and agent socket on startup (async, will complete in background)
    detectGpg4winPath().catch(() => {
        // Silently ignore if gpg4win detection fails
    });
    // Auto-start bridge by default (can be disabled with autoStart: false)
    const config = vscode.workspace.getConfiguration('gpgWinRelay');
    if (config.get('autoStart', true)) {
        outputChannel.appendLine('🚀 Auto-starting bridge...');
        startBridge().catch((error) => {
            outputChannel.appendLine(`❌ Auto-start failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
}
// Get the configured listen port
function getConfiguredListenPort() {
    const config = vscode.workspace.getConfiguration('gpgWinRelay');
    return config.get('listenPort') || 63331;
}
// Detect Gpg4win installation path
async function detectGpg4winPath() {
    const config = vscode.workspace.getConfiguration('gpgWinRelay');
    const configPath = config.get('gpg4winPath') || '';
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
    outputChannel.appendLine('⚠️  Gpg4win not found. Please install Gpg4win or configure path.');
}
// Detect GPG agent socket path
function detectAgentSocket() {
    if (!detectedGpg4winPath) {
        return;
    }
    const gpgconfPath = path.join(detectedGpg4winPath, 'gpgconf.exe');
    if (!fs.existsSync(gpgconfPath)) {
        return;
    }
    try {
        const result = (0, child_process_1.spawnSync)(gpgconfPath, ['--list-dir', 'agent-socket'], {
            encoding: 'utf8',
            timeout: 2000
        });
        if (result.status === 0 && result.stdout) {
            detectedAgentSocket = result.stdout.trim();
            outputChannel.appendLine(`✅ Detected GPG agent socket: ${detectedAgentSocket}`);
        }
    }
    catch (error) {
        // Silently fail
    }
}
// Get relay port (called by remote extension via command)
async function getRelayPort() {
    if (!bridge?.isRunning()) {
        throw new Error('❌ Bridge is not running');
    }
    return getConfiguredListenPort();
}
// Ensure bridge is running and return port (called by remote to start bridge if needed)
async function ensureBridgeRunning() {
    if (!bridge?.isRunning()) {
        outputChannel.appendLine('🔄 Remote requested bridge start...');
        await startBridge();
    }
    if (!bridge?.isRunning()) {
        throw new Error('Failed to start bridge');
    }
    return getConfiguredListenPort();
}
// Start the bridge
async function startBridge() {
    if (bridge?.isRunning()) {
        vscode.window.showWarningMessage('Bridge is already running');
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
        outputChannel.appendLine('🚀 Starting bridge...');
        const config = vscode.workspace.getConfiguration('gpgWinRelay');
        const debugLogging = config.get('debugLogging') || false;
        const listenPort = getConfiguredListenPort();
        bridge = new assuanBridge_1.AssuanBridge({
            gpgAgentSocketPath: detectedAgentSocket,
            listenPort: listenPort,
            debugLogging: debugLogging
        });
        bridge.setLogCallback((message) => outputChannel.appendLine(message));
        outputChannel.appendLine(`🔌 GPG agent socket: ${detectedAgentSocket}`);
        outputChannel.appendLine(`📌 Assuan TCP port: ${bridge.getAssuanPort()}`);
        outputChannel.appendLine(`📡 Listen port: ${listenPort}`);
        outputChannel.appendLine('⏳ Starting bridge...');
        await bridge.start();
        outputChannel.appendLine('✅ Bridge started successfully');
        updateStatusBar(true);
        vscode.window.showInformationMessage(`Bridge started on localhost:${listenPort}`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Error starting bridge: ${errorMessage}`);
        outputChannel.show(true);
        vscode.window.showErrorMessage(`Failed to start bridge: ${errorMessage}`);
        bridge = null;
    }
}
// Stop the bridge
async function stopBridge() {
    if (!bridge?.isRunning()) {
        vscode.window.showInformationMessage('Bridge is not running');
        return;
    }
    outputChannel.appendLine('🛑 Stopping bridge...');
    await bridge.stop();
    bridge = null;
    updateStatusBar(false);
    outputChannel.appendLine('✅ Bridge stopped');
    vscode.window.showInformationMessage('Bridge stopped');
}
// Restart the bridge
async function restartBridge() {
    await stopBridge();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await startBridge();
}
// Show bridge status
function showStatus() {
    const isRunning = bridge?.isRunning() || false;
    const gpg4winPath = detectedGpg4winPath || '(not detected)';
    const agentSocket = detectedAgentSocket || '(not detected)';
    const config = vscode.workspace.getConfiguration('gpgWinRelay');
    const status = [
        'GPG Windows Relay Bridge Status',
        '',
        `Bridge: ${isRunning ? '✅ Running' : '🛑 Stopped'}`,
        `Auto-start: ${config.get('autoStart') ? 'Enabled' : 'Disabled'}`,
        '',
        `Gpg4win: ${gpg4winPath}`,
        `GPG agent socket: ${agentSocket}`,
        `Listen port: ${getConfiguredListenPort()}`
    ].join('\n');
    vscode.window.showInformationMessage(status, { modal: true });
    outputChannel.show();
}
// Update the status bar item
function updateStatusBar(running) {
    const isRunning = running ?? (bridge?.isRunning() || false);
    if (isRunning) {
        statusBarItem.text = '$(key) GPG Relay: Active';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        statusBarItem.tooltip = 'Bridge is running';
    }
    else {
        statusBarItem.text = '$(key) GPG Relay: Inactive';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.tooltip = 'Bridge is not running';
    }
    statusBarItem.command = 'gpg-windows-relay.showStatus';
}
// This method is called when your extension is deactivated
function deactivate() {
    if (bridge?.isRunning()) {
        bridge.stop().catch(() => {
            // Silently ignore cleanup errors
        });
    }
}
//# sourceMappingURL=extension.js.map