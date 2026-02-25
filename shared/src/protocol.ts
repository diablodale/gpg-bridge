/**
 * Shared protocol utilities for Assuan/GPG protocol handling.
 * Used by both agent-proxy and request-proxy extensions.
 *
 * Key principle: All socket I/O preserves raw bytes using latin1 encoding.
 * This allows binary data (nonces, D blocks) to pass through string operations unchanged.
 */

import type * as net from 'net';
import { LogConfig } from './types';

/**
 * Encode a string to a Buffer using latin1 encoding.
 * latin1 preserves raw bytes without UTF-8 mangling, essential for Assuan protocol.
 *
 * @param data String data to encode
 * @returns Buffer with latin1 encoding
 */
export function encodeProtocolData(data: string): Buffer {
    return Buffer.from(data, 'latin1');
}

/**
 * Decode a Buffer to a string using latin1 encoding.
 * latin1 preserves raw bytes without UTF-8 mangling, essential for Assuan protocol.
 *
 * @param buffer Buffer to decode
 * @returns String with latin1 decoding
 */
export function decodeProtocolData(buffer: Buffer): string {
    return buffer.toString('latin1');
}

/**
 * Sanitize string for safe display in log output.
 * Shows first command word and byte count to avoid overwhelming logs with large blocks.
 *
 * Example: "INQUIRE PASSPHRASE" → "INQUIRE and 17 more bytes"
 *
 * @param str String to sanitize
 * @returns Sanitized display string
 */
export function sanitizeForLog(str: string): string {
    const firstWord = str.split(/[\s\n]/, 1)[0];
    const remainingBytes = str.length - firstWord.length - 1; // -1 for the space/newline after first word
    return `${firstWord} and ${remainingBytes} more bytes`;
}

/**
 * Log a message using the config callback if provided.
 * Replaces console.log to allow integration with VS Code output channels.
 *
 * @param config Configuration object with optional logCallback
 * @param message Message to log
 */
export function log(config: LogConfig, message: string): void {
    if (config.logCallback) {
        config.logCallback(message);
    }
}

/**
 * Safely extract error message from any error type.
 * Handles Error objects, strings, and unknown types.
 *
 * @param error Error to extract message from
 * @param fallback Optional fallback message if extraction fails or error is empty
 * @returns Error message string
 */
export function extractErrorMessage(error: unknown, fallback = 'Unknown error'): string {
    if (error == null) {
        return fallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    if (typeof error === 'object' && 'message' in error) {
        return String(error.message) || fallback;
    }
    const message = String(error);
    return message || fallback;
}

/**
 * Parse a Windows Assuan socket file format.
 * Format: ASCII port number, newline, then 16-byte binary nonce.
 *
 * @param data Buffer containing socket file contents
 * @returns Object with parsed port and nonce
 * @throws Error if format is invalid
 */
export interface ParsedSocketFile {
    port: number;
    nonce: Buffer;
}

export function parseSocketFile(data: Buffer): ParsedSocketFile {
    // Find the newline that separates port from nonce
    const newlineIndex = data.indexOf('\n');
    if (newlineIndex === -1) {
        throw new Error('Invalid socket file format: no newline found');
    }

    // Extract and parse port as ASCII
    const portStr = data.toString('latin1', 0, newlineIndex);
    const port = parseInt(portStr, 10);

    if (isNaN(port)) {
        throw new Error(`Invalid port in socket file: ${portStr}`);
    }

    // Extract raw 16-byte nonce after the newline
    const nonceStart = newlineIndex + 1;
    const nonce = data.subarray(nonceStart, nonceStart + 16);

    if (nonce.length !== 16) {
        throw new Error(`Invalid nonce length: expected 16 bytes, got ${nonce.length}`);
    }

    return { port, nonce };
}

/**
 * Result of response completion detection.
 */
export interface ResponseCompletion {
    /** Whether the response is complete (ends with OK, ERR, or INQUIRE) */
    complete: boolean;
    /** The type of completion marker found, or null if incomplete */
    type: 'OK' | 'ERR' | 'INQUIRE' | null;
}

/**
 * Detect whether an Assuan protocol response is complete.
 * A complete response must end with \n and have OK, ERR, or INQUIRE as the last non-empty line.
 *
 * Valid completion patterns:
 * - "OK" or "OK <optional text>"
 * - "ERR <error code> <optional text>"
 * - "INQUIRE <prompt>"
 *
 * @param response Response string to check
 * @returns Object indicating completion status and type
 *
 * @example
 * detectResponseCompletion("OK\n") // { complete: true, type: 'OK' }
 * detectResponseCompletion("ERR 67109139 No secret key\n") // { complete: true, type: 'ERR' }
 * detectResponseCompletion("INQUIRE PASSPHRASE\n") // { complete: true, type: 'INQUIRE' }
 * detectResponseCompletion("S PROGRESS...") // { complete: false, type: null }
 */
export function detectResponseCompletion(response: string): ResponseCompletion {
    if (!response.endsWith('\n')) {
        return { complete: false, type: null };
    }

    const lines = response.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('OK ') || line === 'OK') {
            return { complete: true, type: 'OK' };
        }
        if (line.startsWith('ERR ')) {
            return { complete: true, type: 'ERR' };
        }
        if (line.startsWith('INQUIRE ')) {
            return { complete: true, type: 'INQUIRE' };
        }

        // Found a non-empty line that's not a completion marker
        return { complete: false, type: null };
    }

    // No non-empty lines found (empty string or only whitespace/newlines)
    return { complete: false, type: null };
}

/**
 * Safely cleanup a socket by removing listeners and destroying it.
 * Uses first-error-wins pattern: returns the first error encountered, logs all errors.
 *
 * @param socket Socket to cleanup
 * @param config Configuration with optional logging callback
 * @param sessionId Session ID for logging context
 * @returns First error encountered during cleanup, or null if cleanup succeeded
 *
 * @example
 * const error = cleanupSocket(socket, config, sessionId);
 * if (error) {
 *     log(config, `[${sessionId}] Socket cleanup failed: ${error.message}`);
 * }
 */

/**
 * Minimal interface required for socket cleanup operations.
 * Using a structural subset rather than net.Socket allows test code to pass
 * lightweight mock objects without casting.
 */
export interface CleanableSocket {
    removeAllListeners(): void;
    destroy(): void;
}

export function cleanupSocket(
    socket: CleanableSocket,
    config: LogConfig,
    sessionId: string
): Error | null {
    let cleanupError: Error | null = null;

    // Step 1: Remove all listeners (prevents event handlers from firing during destroy)
    try {
        socket.removeAllListeners();
        log(config, `[${sessionId}] Socket listeners removed`);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        cleanupError = cleanupError ?? error;
        log(config, `[${sessionId}] Error removing socket listeners: ${error.message}`);
    }

    // Step 2: Destroy the socket (closes connection and releases resources)
    try {
        socket.destroy();
        log(config, `[${sessionId}] Socket destroyed`);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        cleanupError = cleanupError ?? error;
        log(config, `[${sessionId}] Error destroying socket: ${error.message}`);
    }

    return cleanupError;
}

/**
 * Result of command extraction from buffer.
 */
export interface CommandExtraction {
    /** The extracted command (including delimiter), or null if incomplete */
    extracted: string | null;
    /** Remaining buffer content after extraction */
    remaining: string;
}

/**
 * Extract a complete command from a buffer (newline-delimited).
 * Used by request-proxy to parse client commands from buffered data.
 *
 * A complete command ends with \n. If found, the command (including \n) is extracted
 * and the remaining buffer is returned.
 *
 * @param buffer Buffer containing potential command data
 * @returns Object with extracted command (or null) and remaining buffer
 *
 * @example
 * const result = extractCommand("KEYINFO\nNOP\n");
 * // { extracted: "KEYINFO\n", remaining: "NOP\n" }
 *
 * const partial = extractCommand("KEYINFO");
 * // { extracted: null, remaining: "KEYINFO" }
 */
export function extractCommand(buffer: string): CommandExtraction {
    const delimiterIndex = buffer.indexOf('\n');
    if (delimiterIndex !== -1) {
        return {
            extracted: buffer.substring(0, delimiterIndex + 1),
            remaining: buffer.substring(delimiterIndex + 1)
        };
    }
    return { extracted: null, remaining: buffer };
}

/**
 * Extract a complete INQUIRE D-block from buffer (ends with END\n).
 * Used by request-proxy to parse client D-block responses during INQUIRE flow.
 *
 * A complete D-block ends with END\n. If found, the entire block (including END\n)
 * is extracted and the remaining buffer is returned.
 *
 * @param buffer Buffer containing potential D-block data
 * @returns Object with extracted D-block (or null) and remaining buffer
 *
 * @example
 * const result = extractInquireBlock("D some data\nEND\n");
 * // { extracted: "D some data\nEND\n", remaining: "" }
 *
 * const partial = extractInquireBlock("D some data\n");
 * // { extracted: null, remaining: "D some data\n" }
 */
export function extractInquireBlock(buffer: string): CommandExtraction {
    const delimiterIndex = buffer.indexOf('END\n');
    if (delimiterIndex !== -1) {
        return {
            extracted: buffer.substring(0, delimiterIndex + 4), // 'END\n' is 4 chars
            remaining: buffer.substring(delimiterIndex + 4)
        };
    }
    return { extracted: null, remaining: buffer };
}
