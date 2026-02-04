/**
 * Remote Extension Context
 *
 * This code runs on the remote (WSL/container/SSH).
 * It activates automatically when VS Code connects to any remote.
 */

import * as vscode from 'vscode';
import { startRequestProxy } from './services/requestProxy';

let requestProxyInstance: Awaited<ReturnType<typeof startRequestProxy>> | null = null;

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('GPG Request Proxy');

    try {
        outputChannel.appendLine(`Remote context (${vscode.env.remoteName}) activated`);

        // Register commands
        const startCommand = vscode.commands.registerCommand('gpg-request-proxy.start', async () => {
            await startRequestProxyHandler(outputChannel);
        });

        const stopCommand = vscode.commands.registerCommand('gpg-request-proxy.stop', async () => {
            await stopRequestProxyHandler(outputChannel);
        });

        context.subscriptions.push(startCommand, stopCommand, outputChannel);

        // Auto-start request proxy on remote
        outputChannel.appendLine('Auto-starting request proxy...');
        try {
            await startRequestProxyHandler(outputChannel);
        } catch (err) {
            // Error already logged by handler, but show output
            outputChannel.show();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Error: ${message}`);
        outputChannel.show(true);
    }
}

async function startRequestProxyHandler(outputChannel: vscode.OutputChannel) {
    if (requestProxyInstance) {
        outputChannel.appendLine('Request proxy already running');
        return;
    }

    try {
        outputChannel.appendLine('Starting request proxy...');

        // Get the configured port from workspace settings (defaults to 63331)
        const config = vscode.workspace.getConfiguration('gpgAgentProxy');
        const agentProxyPort = config.get<number>('proxyPort') || 63331;

        // Start the request proxy
        requestProxyInstance = await startRequestProxy({
            agentProxyHost: 'localhost',
            agentProxyPort: agentProxyPort,
            logCallback: (msg) => outputChannel.appendLine(`      ${msg}`)
        });

        outputChannel.appendLine(`Request proxy established to agent proxy on ${agentProxyPort})`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Failed to start request proxy: ${message}`);
        outputChannel.appendLine('Make sure agent proxy is running: F1 > "GPG Agent Proxy: Start"');
        outputChannel.show(true);
        throw error;
    }
}

async function stopRequestProxyHandler(outputChannel: vscode.OutputChannel) {
    if (!requestProxyInstance) {
        outputChannel.appendLine('Request proxy is not running');
        return;
    }

    try {
        outputChannel.appendLine('Stopping request proxy...');
        await requestProxyInstance.stop();
        requestProxyInstance = null;
        outputChannel.appendLine('Request proxy stopped');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Error stopping request proxy: ${message}`);
        outputChannel.show(true);
    }
}

export function deactivate() {
    if (requestProxyInstance) {
        requestProxyInstance.stop().catch((err) => {
            console.error('Error deactivating request proxy:', err);
        });
    }
}


