"use strict";
/**
 * Unit tests for shared protocol utilities
 * These test the pure functions in shared/protocol.ts
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
const assert = __importStar(require("assert"));
const mocha_1 = require("mocha");
const protocol_1 = require("../protocol");
// Test helper for creating buffers
function createBuffer(text) {
    return Buffer.from(text, 'latin1');
}
(0, mocha_1.describe)('Protocol Utilities', () => {
    (0, mocha_1.describe)('Latin1 Encoding/Decoding', () => {
        (0, mocha_1.it)('encodeProtocolData converts string to Buffer with latin1', () => {
            const input = 'HELLO\n';
            const result = (0, protocol_1.encodeProtocolData)(input);
            assert.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
            assert.strictEqual(result.toString('latin1'), input, 'Round-trip encoding should preserve data');
        });
        (0, mocha_1.it)('decodeProtocolData converts Buffer back to string', () => {
            const input = Buffer.from('BYE\n', 'latin1');
            const result = (0, protocol_1.decodeProtocolData)(input);
            assert.strictEqual(result, 'BYE\n', 'Decoded string should match original');
        });
        (0, mocha_1.it)('encodeProtocolData and decodeProtocolData round-trip correctly', () => {
            const testCases = [
                'simple\n',
                'with spaces \n',
                'OK\n',
                'ERR 123 error message\n',
                'INQUIRE DATA\n'
            ];
            testCases.forEach(testCase => {
                const encoded = (0, protocol_1.encodeProtocolData)(testCase);
                const decoded = (0, protocol_1.decodeProtocolData)(encoded);
                assert.strictEqual(decoded, testCase, `Round-trip failed for: ${JSON.stringify(testCase)}`);
            });
        });
    });
    (0, mocha_1.describe)('Logging Utilities', () => {
        (0, mocha_1.it)('sanitizeForLog shows first word and byte count', () => {
            const input = 'KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4 - - 0 P';
            const result = (0, protocol_1.sanitizeForLog)(input);
            assert.ok(result.includes('KEYINFO'), 'Should contain first word');
            assert.ok(result.includes('more bytes'), 'Should indicate byte count');
            assert.strictEqual(result.length < input.length, true, 'Should be shorter than input');
        });
        (0, mocha_1.it)('sanitizeForLog handles single-word input', () => {
            const input = 'OK';
            const result = (0, protocol_1.sanitizeForLog)(input);
            assert.ok(result.includes('OK'), 'Should contain the word');
        });
        (0, mocha_1.it)('sanitizeForLog handles newline-delimited data', () => {
            const input = 'DATA\nmultiple\nlines';
            const result = (0, protocol_1.sanitizeForLog)(input);
            assert.ok(result.includes('DATA'), 'Should extract first word');
        });
    });
    (0, mocha_1.describe)('Error Extraction', () => {
        (0, mocha_1.it)('extractErrorMessage gets message from Error objects', () => {
            const error = new Error('Connection refused');
            const result = (0, protocol_1.extractErrorMessage)(error);
            assert.strictEqual(result, 'Connection refused');
        });
        (0, mocha_1.it)('extractErrorMessage uses fallback for non-Error values', () => {
            const result = (0, protocol_1.extractErrorMessage)('string error', 'Fallback');
            assert.strictEqual(result, 'string error');
        });
        (0, mocha_1.it)('extractErrorMessage uses default fallback when provided', () => {
            const result = (0, protocol_1.extractErrorMessage)(null, 'Default message');
            assert.strictEqual(result, 'Default message');
        });
        (0, mocha_1.it)('extractErrorMessage handles error with code property', () => {
            const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
            const result = (0, protocol_1.extractErrorMessage)(error);
            assert.ok(result.includes('Connection refused') || result.includes('ECONNREFUSED'));
        });
    });
    (0, mocha_1.describe)('Socket File Parsing', () => {
        (0, mocha_1.it)('parseSocketFile extracts port and nonce from socket data', () => {
            const portStr = '12345';
            const nonce = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
            const socketData = Buffer.concat([
                Buffer.from(portStr, 'utf-8'),
                Buffer.from('\n', 'utf-8'),
                nonce
            ]);
            const result = (0, protocol_1.parseSocketFile)(socketData);
            assert.strictEqual(result.port, 12345, 'Port should be parsed correctly');
            assert.deepStrictEqual(result.nonce, nonce, 'Nonce should match');
        });
        (0, mocha_1.it)('parseSocketFile throws on invalid format (no newline)', () => {
            const invalidData = Buffer.from('12345_no_newline_here', 'utf-8');
            assert.throws(() => (0, protocol_1.parseSocketFile)(invalidData), /no newline found/);
        });
        (0, mocha_1.it)('parseSocketFile throws on invalid port', () => {
            const invalidData = Buffer.concat([
                Buffer.from('not_a_number\n', 'utf-8'),
                Buffer.alloc(16)
            ]);
            assert.throws(() => (0, protocol_1.parseSocketFile)(invalidData), /Invalid port/);
        });
        (0, mocha_1.it)('parseSocketFile throws on invalid nonce length', () => {
            const invalidData = Buffer.concat([
                Buffer.from('12345\n', 'utf-8'),
                Buffer.alloc(8) // Wrong length
            ]);
            assert.throws(() => (0, protocol_1.parseSocketFile)(invalidData), /Invalid nonce length/);
        });
    });
    (0, mocha_1.describe)('Command Extraction', () => {
        (0, mocha_1.it)('extractNextCommand extracts command in SEND_COMMAND state', () => {
            const buffer = 'KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4 - - 0 P\n';
            const result = (0, protocol_1.extractNextCommand)(buffer, 'SEND_COMMAND');
            assert.strictEqual(result.command, buffer);
            assert.strictEqual(result.remaining, '');
        });
        (0, mocha_1.it)('extractNextCommand keeps remaining data after command', () => {
            const buffer = 'KEYINFO cmd\nNEXT line\n';
            const result = (0, protocol_1.extractNextCommand)(buffer, 'SEND_COMMAND');
            assert.strictEqual(result.command, 'KEYINFO cmd\n');
            assert.strictEqual(result.remaining, 'NEXT line\n');
        });
        (0, mocha_1.it)('extractNextCommand returns null when no newline found', () => {
            const buffer = 'incomplete command';
            const result = (0, protocol_1.extractNextCommand)(buffer, 'SEND_COMMAND');
            assert.strictEqual(result.command, null);
            assert.strictEqual(result.remaining, buffer);
        });
        (0, mocha_1.it)('extractNextCommand extracts inquire data in INQUIRE_DATA state', () => {
            const buffer = 'D some data\nD more data\nEND\nOK\n';
            const result = (0, protocol_1.extractNextCommand)(buffer, 'INQUIRE_DATA');
            assert.ok(result.command, 'Command should be extracted');
            assert.ok(result.command.includes('END\n'), 'Command should include END marker');
            assert.strictEqual(result.remaining, 'OK\n', 'Remaining buffer should have OK response');
        });
    });
    (0, mocha_1.describe)('State Determination', () => {
        (0, mocha_1.it)('determineNextState: SEND_COMMAND with OK response moves to SEND_COMMAND', () => {
            const result = (0, protocol_1.determineNextState)('OK\n', 'SEND_COMMAND');
            assert.strictEqual(result, 'SEND_COMMAND');
        });
        (0, mocha_1.it)('determineNextState: SEND_COMMAND with INQUIRE moves to INQUIRE_DATA', () => {
            const result = (0, protocol_1.determineNextState)('INQUIRE PASSPHRASE\n', 'SEND_COMMAND');
            assert.strictEqual(result, 'INQUIRE_DATA');
        });
        (0, mocha_1.it)('determineNextState: WAIT_RESPONSE with OK moves to SEND_COMMAND', () => {
            const result = (0, protocol_1.determineNextState)('OK\n', 'WAIT_RESPONSE');
            assert.strictEqual(result, 'SEND_COMMAND');
        });
        (0, mocha_1.it)('determineNextState: INQUIRE_DATA closes with OK', () => {
            const result = (0, protocol_1.determineNextState)('OK\n', 'INQUIRE_DATA');
            assert.strictEqual(result, 'SEND_COMMAND');
        });
        (0, mocha_1.it)('determineNextState: ERR response stays in same state for retry', () => {
            const result = (0, protocol_1.determineNextState)('ERR 123 error\n', 'SEND_COMMAND');
            assert.strictEqual(result, 'SEND_COMMAND');
        });
    });
});
//# sourceMappingURL=protocol.test.js.map