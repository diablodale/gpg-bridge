/**
 * Agent Proxy Service
 *
 * Creates a TCP server that proxies to the Assuan socket provided by gpg4win.
 * Reads the Assuan socket file to get the TCP port and nonce, then:
 * 1. Creates a local proxy socket on TCP port
 * 2. On connection: authenticates with the nonce and pipes to gpg-agent
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentProxyConfig {
    gpgAgentSocketPath: string; // Path to Assuan socket file, e.g. C:\Users\dale\AppData\Local\gnupg\d.123123123\S.gpg-agent
    proxyPort: number;          // TCP port for proxy (default: 63331)
    debugLogging: boolean;
}

export interface ParsedAssuan {
    port: number;
    nonce: Buffer;
}

export class AgentProxy {
    private server: net.Server | null = null;
    private logCallback?: (message: string) => void;
    private assuanPort: number;
    private nonce: Buffer;

    constructor(private config: AgentProxyConfig) {
        // Parse the Assuan socket file immediately on instantiation
        const parsed = this.parseAssuanSocket();
        this.assuanPort = parsed.port;
        this.nonce = parsed.nonce;
    }

    public setLogCallback(callback: (message: string) => void): void {
        this.logCallback = callback;
    }

    private log(message: string): void {
        if (this.config.debugLogging && this.logCallback) {
            this.logCallback(message);
        }
    }

    /**
     * Parse the Assuan socket file
     *
     * Format:
     * Line 1: TCP port number
     * Line 2: 16-byte nonce
     */
    private parseAssuanSocket(): ParsedAssuan {
        this.log(`Reading Assuan socket file: ${this.config.gpgAgentSocketPath}`);

        const contents = fs.readFileSync(this.config.gpgAgentSocketPath, 'binary');

        // Find the first newline to get the port
        const newlineIndex = contents.indexOf('\n');
        if (newlineIndex === -1) {
            throw new Error('Invalid Assuan socket file: no newline found');
        }

        const portStr = contents.substring(0, newlineIndex).trim();
        const port = parseInt(portStr, 10);

        if (isNaN(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid port in Assuan socket file: ${portStr}`);
        }

        // Extract the nonce (16 bytes after the newline)
        const nonceStart = newlineIndex + 1;
        const nonce = Buffer.from(contents.substring(nonceStart, nonceStart + 16), 'binary');

        if (nonce.length !== 16) {
            throw new Error(`Invalid nonce length: expected 16, got ${nonce.length}`);
        }

        this.log(`Parsed Assuan socket: port=${port}, nonce=${nonce.toString('hex')}`);

        this.assuanPort = port;
        return { port, nonce };
    }

    public getAssuanPort(): number {
        return this.assuanPort;
    }

    /**
     * Start the Agent Proxy
     */
    public async start(): Promise<void> {
        this.log(`Starting Agent proxy on localhost:${this.config.proxyPort}`);

        this.server = net.createServer((clientSocket) => {
            this.log('Incoming connection from request proxy');

            // Connect to gpg-agent's Assuan socket
            const gpgSocket = net.createConnection({
                host: 'localhost',
                port: this.assuanPort,
                family: 4  // IPv4
            });

            gpgSocket.on('connect', () => {
                this.log('Connected to gpg-agent Assuan socket');

                // Send nonce for authentication
                gpgSocket.write(this.nonce);

                // Manual bidirectional piping with -ep and -ei semantics:
                // -ep: terminate on EOF from gpg-agent (the "pipe"), even if client has more data
                // -ei: terminate on EOF from client (stdin), even if gpg-agent has more data
                // This means: terminate the connection if EITHER side closes

                // Forward from client to gpg-agent
                clientSocket.on('data', (data) => {
                    gpgSocket.write(data);
                });

                // Forward from gpg-agent to client
                gpgSocket.on('data', (data) => {
                    clientSocket.write(data);
                });
            });

            gpgSocket.on('error', (err) => {
                this.log(`Error connecting to gpg-agent: ${err.message}`);
                clientSocket.destroy();
            });

            gpgSocket.on('end', () => {
                this.log('gpg-agent connection closed (terminating)');
                clientSocket.destroy();  // Immediately terminate, don't wait for client to finish
            });

            clientSocket.on('error', (err) => {
                this.log(`Error on client connection: ${err.message}`);
                gpgSocket.destroy();
            });

            clientSocket.on('end', () => {
                this.log('Remote relay disconnected (terminating)');
                gpgSocket.destroy();  // Immediately terminate, don't wait for gpg-agent to finish
            });
        });

        this.server.on('error', (err) => {
            this.log(`Agent proxy server error: ${err.message}`);
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.log('ERROR: Agent proxy timeout (5s)');
                reject(new Error('Agent proxy timeout - port may be in use'));
            }, 5000);

            this.server!.listen(this.config.proxyPort, 'localhost', () => {
                clearTimeout(timeout);
                this.log(`Agent proxy ready on localhost:${this.config.proxyPort}`);
                resolve();
            });

            this.server!.on('error', (err) => {
                clearTimeout(timeout);
                this.log(`Agent proxy error: ${err.message}`);
                reject(err);
            });
        });
    }

    /**
     * Stop the Agent Proxy
     */
    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.log('Agent Proxy stopped');
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Check if agent proxy is running
     */
    public isRunning(): boolean {
        return this.server !== null;
    }
}

