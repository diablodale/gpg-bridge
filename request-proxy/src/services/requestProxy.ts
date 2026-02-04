/**
 * Request Proxy Service - State Machine Implementation
 *
 * Creates a Unix socket server on the GPG agent socket path.
 * Implements a 4-state machine to handle GPG Assuan protocol:
 *   DISCONNECTED -> SEND_COMMAND -> WAIT_RESPONSE -> [back to SEND_COMMAND or to INQUIRE_DATA]
 *   INQUIRE_DATA -> WAIT_RESPONSE -> [back to SEND_COMMAND]
 *
 * Each client connection manages its own state machine using sessionId.
 * Commands are sent to agent-proxy extension via VS Code commands.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';

export interface RequestProxyConfig {
    logCallback?: (message: string) => void;
}

export interface RequestProxyInstance {
    stop(): Promise<void>;
}

// Client session state
type ClientState = 'DISCONNECTED' | 'SEND_COMMAND' | 'WAIT_RESPONSE' | 'INQUIRE_DATA';

interface ClientSession {
    socket: net.Socket;
    sessionId: string | null;
    state: ClientState;
    buffer: string;
    commandBlock: string;
}

/**
 * Start the Request Proxy
 */
export async function startRequestProxy(config: RequestProxyConfig): Promise<RequestProxyInstance> {
    const socketPath = await getLocalGpgSocketPath();
    if (!socketPath) {
        throw new Error(
            'Could not determine local GPG socket path. ' +
            'Is gpg-agent running? Try: gpgconf --list-dir agent-extra-socket'
        );
    }

    log(config, `Creating Unix socket server at: ${socketPath}`);

    // Remove stale socket if it exists
    if (fs.existsSync(socketPath)) {
        try {
            fs.unlinkSync(socketPath);
            log(config, 'Removed stale socket file');
        } catch (err) {
            log(config, `Warning: could not remove stale socket: ${err}`);
        }
    }

    // Ensure parent directory exists
    const socketDir = path.dirname(socketPath);
    if (!fs.existsSync(socketDir)) {
        fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    }

    // Create the Unix socket server
    const server = net.createServer((clientSocket) => {
        const clientSession: ClientSession = {
            socket: clientSocket,
            sessionId: null,
            state: 'DISCONNECTED',
            buffer: '',
            commandBlock: ''
        };

        log(config, `Client connected, initiating connection to agent-proxy`);

        // Start by connecting to agent-proxy
        connectToAgent(config, clientSession);

        // Handle incoming data from client
        clientSocket.on('data', (chunk: Buffer) => {
            handleClientData(config, clientSession, chunk);
        });

        // Handle client disconnect
        clientSocket.on('end', () => {
            log(config, `Client disconnected, closing session`);
            cleanupSession(config, clientSession);
        });

        clientSocket.on('error', (err: Error) => {
            log(config, `Client socket error: ${err.message}`);
            cleanupSession(config, clientSession);
        });
    });

    server.on('error', (err: Error) => {
        log(config, `Server error: ${err.message}`);
    });

    return new Promise((resolve, reject) => {
        server.listen(socketPath, () => {
            // Make socket readable/writable by all users
            try {
                fs.chmodSync(socketPath, 0o666);
            } catch (err) {
                log(config, `Warning: could not chmod socket: ${err}`);
            }

            log(config, `Request proxy listening on ${socketPath}`);

            resolve({
                stop: async () => {
                    return new Promise((stopResolve) => {
                        server.close(() => {
                            try {
                                fs.unlinkSync(socketPath);
                            } catch (err) {
                                // Ignore
                            }
                            log(config, 'Request proxy stopped');
                            stopResolve();
                        });
                    });
                }
            });
        });

        server.on('error', reject);
    });
}

/**
 * Connect to agent-proxy via VS Code command
 */
async function connectToAgent(config: RequestProxyConfig, session: ClientSession): Promise<void> {
    try {
        // Call connectAgent command
        const result = await vscode.commands.executeCommand('gpg-agent-proxy.connectAgent') as { sessionId: string };
        session.sessionId = result.sessionId;
        session.state = 'SEND_COMMAND';
        log(config, `[${session.sessionId}] Connected to agent-proxy`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log(config, `Failed to connect to agent-proxy: ${msg}`);
        session.socket.destroy();
    }
}

/**
 * Handle incoming data from client
 *
 * Implements the state machine:
 * SEND_COMMAND: Read until complete command line
 * WAIT_RESPONSE: Handled by sendCommands promise
 * INQUIRE_DATA: Read D lines until END
 */
async function handleClientData(config: RequestProxyConfig, session: ClientSession, chunk: Buffer): Promise<void> {
    session.buffer += chunk.toString('utf-8');

    if (session.state === 'SEND_COMMAND') {
        // Look for complete command line (ends with \n)
        const newlineIndex = session.buffer.indexOf('\n');
        if (newlineIndex === -1) {
            return; // Wait for more data
        }

        // Extract command
        const command = session.buffer.substring(0, newlineIndex + 1);
        session.buffer = session.buffer.substring(newlineIndex + 1);
        session.commandBlock = command;

        log(config, `[${session.sessionId}] Command: ${command.trim()}`);

        // Send command to agent-proxy
        session.state = 'WAIT_RESPONSE';
        try {
            const result = await vscode.commands.executeCommand(
                'gpg-agent-proxy.sendCommands',
                session.sessionId,
                command
            ) as { response: string };

            const response = result.response;
            log(config, `[${session.sessionId}] Response: ${response.replace(/\n/g, '\\n')}`);

            // Send response to client
            session.socket.write(response);

            // Check if response contains INQUIRE
            if (response.includes('INQUIRE')) {
                session.state = 'INQUIRE_DATA';
                log(config, `[${session.sessionId}] Entering INQUIRE_DATA state`);
            } else {
                // Back to SEND_COMMAND for next command
                session.state = 'SEND_COMMAND';
                // Process any buffered data
                if (session.buffer.length > 0) {
                    handleClientData(config, session, Buffer.from(session.buffer));
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log(config, `[${session.sessionId}] Error sending command: ${msg}`);
            session.socket.destroy();
        }
    } else if (session.state === 'INQUIRE_DATA') {
        // Look for D lines followed by END
        const endIndex = session.buffer.indexOf('END\n');
        if (endIndex === -1) {
            return; // Wait for more data
        }

        // Extract D block (including END\n)
        const dataBlock = session.buffer.substring(0, endIndex + 4);
        session.buffer = session.buffer.substring(endIndex + 4);

        log(config, `[${session.sessionId}] Data block: ${dataBlock.replace(/\n/g, '\\n')}`);

        // Send D block to agent-proxy
        session.state = 'WAIT_RESPONSE';
        try {
            const result = await vscode.commands.executeCommand(
                'gpg-agent-proxy.sendCommands',
                session.sessionId,
                dataBlock
            ) as { response: string };

            const response = result.response;
            log(config, `[${session.sessionId}] Response: ${response.replace(/\n/g, '\\n')}`);

            // Send response to client
            session.socket.write(response);

            // Check if response contains another INQUIRE
            if (response.includes('INQUIRE')) {
                session.state = 'INQUIRE_DATA';
                log(config, `[${session.sessionId}] Continuing in INQUIRE_DATA state`);
            } else {
                // Back to SEND_COMMAND for next command
                session.state = 'SEND_COMMAND';
                // Process any buffered data
                if (session.buffer.length > 0) {
                    handleClientData(config, session, Buffer.from(session.buffer));
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log(config, `[${session.sessionId}] Error sending data block: ${msg}`);
            session.socket.destroy();
        }
    }
}

/**
 * Clean up session
 */
async function cleanupSession(config: RequestProxyConfig, session: ClientSession): Promise<void> {
    if (!session.sessionId) {
        return;
    }

    try {
        await vscode.commands.executeCommand('gpg-agent-proxy.disconnectAgent', session.sessionId);
        log(config, `[${session.sessionId}] Session cleaned up`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log(config, `[${session.sessionId}] Error cleaning up: ${msg}`);
    }
}

/**
 * Get the local GPG socket path by querying gpgconf
 */
async function getLocalGpgSocketPath(): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const result = spawnSync('gpgconf', ['--list-dir', 'agent-extra-socket'], {
                encoding: 'utf-8',
                timeout: 5000
            });

            if (result.error) {
                resolve(null);
                return;
            }

            if (result.status !== 0) {
                resolve(null);
                return;
            }

            const socketPath = result.stdout.trim();
            resolve(socketPath || null);
        } catch (err) {
            resolve(null);
        }
    });
}

/**
 * Log helper
 */
function log(config: RequestProxyConfig, message: string): void {
    if (config.logCallback) {
        config.logCallback(message);
    }
}

