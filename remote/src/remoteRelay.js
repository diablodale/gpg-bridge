"use strict";
/**
 * Remote Relay Service
 *
 * Unified implementation for all remote types (WSL, Dev Container, SSH).
 * Creates a Unix socket listener on the GPG socket path and forwards to Windows bridge.
 * Identical code for all three remote types - no platform-specific logic needed.
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
exports.startRemoteRelay = startRemoteRelay;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
/**
 * Start the remote relay
 */
async function startRemoteRelay(config) {
    const socketPath = await getLocalGpgSocketPath();
    if (!socketPath) {
        throw new Error('Could not determine local GPG socket path. ' +
            'Is gpg-agent running? Try: gpgconf --list-dir agent-socket');
    }
    log(config, `📂 Socket: ${socketPath}`);
    // Remove stale socket if it exists
    if (fs.existsSync(socketPath)) {
        try {
            fs.unlinkSync(socketPath);
            log(config, '✅ Removed stale socket file');
        }
        catch (err) {
            log(config, `Warning: could not remove stale socket: ${err}`);
        }
    }
    // Ensure parent directory exists
    const socketDir = path.dirname(socketPath);
    if (!fs.existsSync(socketDir)) {
        fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    }
    // Create the Unix socket server
    const server = net.createServer((localSocket) => {
        log(config, '📥 Incoming connection from client');
        // Connect to Windows bridge
        const remoteSocket = net.createConnection({
            host: config.windowsHost,
            port: config.windowsPort,
            family: 4 // IPv4
        });
        remoteSocket.on('connect', () => {
            log(config, '🔗 Connected to host');
            // Manual bidirectional forwarding with immediate termination on either side closing
            // (matches npiperelay -ep -ei behavior)
            localSocket.on('data', (data) => {
                remoteSocket.write(data);
            });
            remoteSocket.on('data', (data) => {
                localSocket.write(data);
            });
        });
        remoteSocket.on('error', (err) => {
            log(config, `❌ Host error: ${err.message}`);
            localSocket.destroy();
        });
        remoteSocket.on('end', () => {
            log(config, '🔌 Host disconnected');
            localSocket.destroy();
        });
        localSocket.on('error', (err) => {
            log(config, `❌ Client error: ${err.message}`);
            remoteSocket.destroy();
        });
        localSocket.on('end', () => {
            log(config, '🔌 Client disconnected');
            remoteSocket.destroy();
        });
    });
    server.on('error', (err) => {
        log(config, `Server error: ${err.message}`);
    });
    return new Promise((resolve, reject) => {
        server.listen(socketPath, () => {
            // Make socket readable/writable by all users
            try {
                fs.chmodSync(socketPath, 0o666);
            }
            catch (err) {
                log(config, `Warning: could not chmod socket: ${err}`);
            }
            log(config, `✅ Listening on ${socketPath}`);
            resolve({
                stop: async () => {
                    return new Promise((stopResolve) => {
                        server.close(() => {
                            try {
                                fs.unlinkSync(socketPath);
                            }
                            catch (err) {
                                // Ignore
                            }
                            log(config, '✅ Stopped');
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
 * Get the local GPG socket path by querying gpgconf
 */
async function getLocalGpgSocketPath() {
    return new Promise((resolve) => {
        try {
            const result = (0, child_process_1.spawnSync)('gpgconf', ['--list-dir', 'agent-socket'], {
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
        }
        catch (err) {
            resolve(null);
        }
    });
}
/**
 * Log helper
 */
function log(config, message) {
    if (config.logCallback) {
        config.logCallback(message);
    }
}
//# sourceMappingURL=remoteRelay.js.map