/**
 * AssuanSocketClient — Integration Test Helper
 *
 * Minimal Assuan protocol client for integration tests.
 * Connects to a Unix domain socket and communicates using the Assuan protocol.
 *
 * Uses latin1 encoding throughout (matches production socket I/O).
 * Uses detectResponseCompletion() from shared/protocol to detect response boundaries,
 * ensuring the test client and the production proxy agree on framing.
 *
 * Used by Phase 2 and Phase 3 integration tests to drive the Unix socket that
 * request-proxy creates, without involving a real gpg binary.
 */

import * as net from 'net';
import { detectResponseCompletion } from '../../protocol';

const DEFAULT_TIMEOUT_MS = 5000;

export interface AssuanSocketClientOpts {
    /**
     * Milliseconds to wait for a greeting or command response before rejecting.
     * Default: 5000.
     */
    timeoutMs?: number;
}

export class AssuanSocketClient {
    private socket: net.Socket | null = null;
    private readonly timeoutMs: number;

    constructor(opts?: AssuanSocketClientOpts) {
        this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    /**
     * Connect to the Unix socket at socketPath and read the agent greeting.
     * Accumulates data using latin1 encoding to preserve raw bytes.
     * Resolves with the greeting string (e.g. "OK Pleased to meet you\n").
     */
    connect(socketPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(socketPath);
            this.socket = socket;
            socket.setEncoding('latin1');

            let buffer = '';

            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error(
                    `AssuanSocketClient: timed out waiting for greeting on ${socketPath}`
                ));
            }, this.timeoutMs);

            const onData = (chunk: string) => {
                buffer += chunk;
                const completion = detectResponseCompletion(buffer);
                if (!completion.complete) {
                    return;
                }
                clearTimeout(timer);
                socket.removeListener('data', onData);
                socket.removeListener('error', onError);
                resolve(buffer);
            };

            const onError = (err: Error) => {
                clearTimeout(timer);
                socket.removeListener('data', onData);
                reject(new Error(`AssuanSocketClient: connection error: ${err.message}`));
            };

            socket.on('data', onData);
            socket.on('error', onError);
        });
    }

    /**
     * Send a single command and accumulate the response.
     *
     * A trailing newline is appended if absent. Uses detectResponseCompletion()
     * to detect when the response is complete (OK, ERR, or INQUIRE terminal).
     *
     * INQUIRE handling:
     * - INQUIRE PINENTRY_LAUNCHED: notification only; auto-replies END\n then continues
     *   accumulating until a subsequent OK or ERR terminal arrives.
     * - Any other INQUIRE: rejects immediately (unexpected without a passphrase key).
     *
     * Resolves with the full accumulated response string from the last completion
     * (after PINENTRY_LAUNCHED handling if applicable).
     */
    sendCommand(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const socket = this.socket;
            if (!socket || socket.destroyed) {
                reject(new Error('AssuanSocketClient: socket is not connected'));
                return;
            }

            const commandLine = cmd.endsWith('\n') ? cmd : `${cmd}\n`;
            let buffer = '';
            let timerHandle: ReturnType<typeof setTimeout>;

            const resetTimer = () => {
                clearTimeout(timerHandle);
                timerHandle = setTimeout(() => {
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(new Error(
                        `AssuanSocketClient: timed out waiting for response to: ${cmd.trim()}`
                    ));
                }, this.timeoutMs);
            };

            const onData = (chunk: string) => {
                buffer += chunk;
                resetTimer();

                const completion = detectResponseCompletion(buffer);
                if (!completion.complete) {
                    return;
                }

                if (completion.type === 'INQUIRE') {
                    // Extract the INQUIRE keyword from the response
                    const inquireLine = buffer
                        .split('\n')
                        .find(l => l.startsWith('INQUIRE ')) ?? '';
                    const keyword = inquireLine.slice('INQUIRE '.length).split(' ')[0];

                    if (keyword === 'PINENTRY_LAUNCHED') {
                        // Notification — client ACKs with END only, no D-lines.
                        // Reset buffer and continue accumulating until OK/ERR.
                        buffer = '';
                        socket.write('END\n', 'latin1');
                        resetTimer();
                        return;
                    }

                    // Any other INQUIRE is unexpected with a no-passphrase test key.
                    clearTimeout(timerHandle);
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(new Error(
                        `AssuanSocketClient: unexpected INQUIRE: ${inquireLine}`
                    ));
                    return;
                }

                clearTimeout(timerHandle);
                socket.removeListener('data', onData);
                socket.removeListener('error', onError);
                resolve(buffer);
            };

            const onError = (err: Error) => {
                clearTimeout(timerHandle);
                socket.removeListener('data', onData);
                socket.removeListener('error', onError);
                reject(new Error(`AssuanSocketClient: socket error during command: ${err.message}`));
            };

            socket.on('data', onData);
            socket.on('error', onError);

            resetTimer();
            socket.write(commandLine, 'latin1');
        });
    }

    /**
     * Destroy the underlying socket. Safe to call multiple times.
     */
    close(): void {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        this.socket = null;
    }
}
