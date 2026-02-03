"use strict";
/**
 * Remote Extension Context
 *
 * This code runs on the remote (WSL/container/SSH).
 * It activates automatically when VS Code connects to any remote.
 */
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
const remoteRelay_1 = require("./remoteRelay");
let relayInstance = null;
async function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('GPG Windows Relay');
    try {
        outputChannel.appendLine(`🔐 Remote context (${vscode.env.remoteName}) activated`);
        // Register commands
        const startCommand = vscode.commands.registerCommand('gpg-windows-relay.start', async () => {
            await startRemoteRelayHandler(outputChannel);
        });
        const stopCommand = vscode.commands.registerCommand('gpg-windows-relay.stop', async () => {
            await stopRemoteRelayHandler(outputChannel);
        });
        context.subscriptions.push(startCommand, stopCommand, outputChannel);
        // Auto-start relay on remote
        outputChannel.appendLine('🚀 Auto-starting relay...');
        try {
            await startRemoteRelayHandler(outputChannel);
        }
        catch (err) {
            // Error already logged by handler, but show output
            outputChannel.show();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Error: ${message}`);
        outputChannel.show(true);
    }
}
async function startRemoteRelayHandler(outputChannel) {
    if (relayInstance) {
        outputChannel.appendLine('⚠️  Relay already running');
        return;
    }
    try {
        outputChannel.appendLine('🚀 Starting relay...');
        outputChannel.appendLine('   📡 Relay: Unix socket listener (GPG client side)');
        outputChannel.appendLine('   🖥️  Bridge: Windows TCP server (gpg-agent side)');
        // Get the configured port from workspace settings (defaults to 63331)
        const config = vscode.workspace.getConfiguration('gpgWinRelay');
        const windowsBridgePort = config.get('listenPort') || 63331;
        // Start the relay
        relayInstance = await (0, remoteRelay_1.startRemoteRelay)({
            windowsHost: 'localhost',
            windowsPort: windowsBridgePort,
            logCallback: (msg) => outputChannel.appendLine(`      ${msg}`)
        });
        outputChannel.appendLine(`✅ Relay established (listening locally, forwarding to localhost:${windowsBridgePort})`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Failed to start relay: ${message}`);
        outputChannel.appendLine('⚠️  Make sure bridge is running: F1 > "GPG Windows Relay: Start"');
        outputChannel.show(true);
        throw error;
    }
}
async function stopRemoteRelayHandler(outputChannel) {
    if (!relayInstance) {
        outputChannel.appendLine('⚠️  Relay is not running');
        return;
    }
    try {
        outputChannel.appendLine('🛑 Stopping relay...');
        await relayInstance.stop();
        relayInstance = null;
        outputChannel.appendLine('✅ Relay stopped');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Error stopping relay: ${message}`);
        outputChannel.show(true);
    }
}
function deactivate() {
    if (relayInstance) {
        relayInstance.stop().catch((err) => {
            console.error('Error deactivating relay:', err);
        });
    }
}
//# sourceMappingURL=extension.js.map