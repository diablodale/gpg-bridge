/**
 * Unit tests for shared protocol utilities
 * These test the pure functions in shared/protocol.ts
 */

import * as assert from 'assert';
import { describe, it } from 'mocha';
import {
  encodeProtocolData,
  decodeProtocolData,
  sanitizeForLog,
  extractErrorMessage,
  parseSocketFile,
  detectResponseCompletion,
  cleanupSocket,
  extractCommand,
  extractInquireBlock,
} from '../protocol';

// Test helper for creating buffers
function createBuffer(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

describe('Protocol Utilities', () => {
  describe('Latin1 Encoding/Decoding', () => {
    it('encodeProtocolData converts string to Buffer with latin1', () => {
      const input = 'HELLO\n';
      const result = encodeProtocolData(input);
      assert.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
      assert.strictEqual(
        result.toString('latin1'),
        input,
        'Round-trip encoding should preserve data',
      );
    });

    it('decodeProtocolData converts Buffer back to string', () => {
      const input = Buffer.from('BYE\n', 'latin1');
      const result = decodeProtocolData(input);
      assert.strictEqual(result, 'BYE\n', 'Decoded string should match original');
    });

    it('encodeProtocolData and decodeProtocolData round-trip correctly', () => {
      const testCases = [
        'simple\n',
        'with spaces \n',
        'OK\n',
        'ERR 123 error message\n',
        'INQUIRE DATA\n',
      ];

      testCases.forEach((testCase) => {
        const encoded = encodeProtocolData(testCase);
        const decoded = decodeProtocolData(encoded);
        assert.strictEqual(decoded, testCase, `Round-trip failed for: ${JSON.stringify(testCase)}`);
      });
    });
  });

  describe('Logging Utilities', () => {
    it('sanitizeForLog shows first word and byte count', () => {
      const input = 'KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4 - - 0 P';
      const result = sanitizeForLog(input);
      assert.ok(result.includes('KEYINFO'), 'Should contain first word');
      assert.ok(result.includes('more bytes'), 'Should indicate byte count');
      assert.strictEqual(result.length < input.length, true, 'Should be shorter than input');
    });

    it('sanitizeForLog handles single-word input', () => {
      const input = 'OK';
      const result = sanitizeForLog(input);
      assert.ok(result.includes('OK'), 'Should contain the word');
    });

    it('sanitizeForLog handles newline-delimited data', () => {
      const input = 'DATA\nmultiple\nlines';
      const result = sanitizeForLog(input);
      assert.ok(result.includes('DATA'), 'Should extract first word');
    });
  });

  describe('Error Extraction', () => {
    it('extractErrorMessage gets message from Error objects', () => {
      const error = new Error('Connection refused');
      const result = extractErrorMessage(error);
      assert.strictEqual(result, 'Connection refused');
    });

    it('extractErrorMessage uses fallback for non-Error values', () => {
      const result = extractErrorMessage('string error', 'Fallback');
      assert.strictEqual(result, 'string error');
    });

    it('extractErrorMessage uses default fallback when provided', () => {
      const result = extractErrorMessage(null, 'Default message');
      assert.strictEqual(result, 'Default message');
    });

    it('extractErrorMessage handles error with code property', () => {
      const error: unknown = { code: 'ECONNREFUSED', message: 'Connection refused' };
      const result = extractErrorMessage(error);
      assert.ok(result.includes('Connection refused') || result.includes('ECONNREFUSED'));
    });
  });

  describe('Socket File Parsing', () => {
    it('parseSocketFile extracts port and nonce from socket data', () => {
      const portStr = '12345';
      const nonce = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const socketData = Buffer.concat([
        Buffer.from(portStr, 'utf-8'),
        Buffer.from('\n', 'utf-8'),
        nonce,
      ]);

      const result = parseSocketFile(socketData);
      assert.strictEqual(result.port, 12345, 'Port should be parsed correctly');
      assert.deepStrictEqual(result.nonce, nonce, 'Nonce should match');
    });

    it('parseSocketFile throws on invalid format (no newline)', () => {
      const invalidData = Buffer.from('12345_no_newline_here', 'utf-8');
      assert.throws(() => parseSocketFile(invalidData), /no newline found/);
    });

    it('parseSocketFile throws on invalid port', () => {
      const invalidData = Buffer.concat([Buffer.from('not_a_number\n', 'utf-8'), Buffer.alloc(16)]);
      assert.throws(() => parseSocketFile(invalidData), /Invalid port/);
    });

    it('parseSocketFile throws on invalid nonce length', () => {
      const invalidData = Buffer.concat([
        Buffer.from('12345\n', 'utf-8'),
        Buffer.alloc(8), // Wrong length
      ]);
      assert.throws(() => parseSocketFile(invalidData), /Invalid nonce length/);
    });

    it('parseSocketFile ignores extra data after nonce', () => {
      const portStr = '31415';
      const nonce = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const extraData = Buffer.from('this is extra data that should be ignored', 'utf-8');
      const socketData = Buffer.concat([
        Buffer.from(portStr, 'utf-8'),
        Buffer.from('\n', 'utf-8'),
        nonce,
        extraData, // Extra data after valid nonce
      ]);

      const result = parseSocketFile(socketData);
      assert.strictEqual(result.port, 31415, 'Port should be parsed correctly');
      assert.deepStrictEqual(result.nonce, nonce, 'Nonce should match (extra data ignored)');
    });
  });

  describe('Binary Data Handling (GPG Agent Responses)', () => {
    it('encodeProtocolData round-trips all latin1 byte values (0-255)', () => {
      // Create a string with all 256 byte values
      const bytes: number[] = [];
      for (let i = 0; i < 256; i++) {
        bytes.push(i);
      }
      const binary = String.fromCharCode(...bytes);

      const encoded = encodeProtocolData(binary);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, binary, 'All byte values should round-trip correctly');

      // Verify each byte
      for (let i = 0; i < 256; i++) {
        assert.strictEqual(decoded.charCodeAt(i), i, `Byte ${i} should be preserved`);
      }
    });

    it('handles high-byte values (128-255) common in binary data', () => {
      // Simulate GPG signature data with high bytes
      const highBytes = Buffer.from([0xc0, 0xde, 0xba, 0xbe, 0xca, 0xfe, 0xbe, 0xef]);
      const input = highBytes.toString('latin1');

      const encoded = encodeProtocolData(input);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, input, 'High bytes should round-trip correctly');
      assert.deepStrictEqual(
        Buffer.from(decoded, 'latin1'),
        highBytes,
        'Should recreate original buffer',
      );
    });

    it('handles null bytes in binary data (edge case)', () => {
      // Create binary data with null bytes
      const binaryData = String.fromCharCode(0x01, 0x00, 0x02, 0x00, 0x03);

      const encoded = encodeProtocolData(binaryData);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, binaryData, 'Null bytes should be preserved');
      assert.strictEqual(decoded.length, 5, 'Length should include null bytes');
    });

    it('handles all 0xFF bytes (full saturation)', () => {
      const allFF = String.fromCharCode(0xff, 0xff, 0xff, 0xff);

      const encoded = encodeProtocolData(allFF);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, allFF, 'Should handle all 0xFF bytes');
      assert.strictEqual(decoded.length, 4);
    });

    it('handles realistic GPG signature response with binary and ASCII mixed', () => {
      // Simulate a D block containing signature data
      // Format: D <binary_data>
      const signatureBytes = Buffer.from([0x30, 0x45, 0x02, 0x20, 0xab, 0xcd, 0xef, 0x01]);
      const dataCommand = 'D ' + signatureBytes.toString('latin1') + '\n';

      const encoded = encodeProtocolData(dataCommand);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, dataCommand, 'D block with binary data should round-trip');

      // Extract signature bytes back out
      const parts = decoded.split(' ');
      assert.strictEqual(parts[0], 'D', 'Command should be D');
      const recoveredSignature = Buffer.from(parts.slice(1).join(' ').trim(), 'latin1');
      assert.deepStrictEqual(
        recoveredSignature,
        signatureBytes,
        'Signature bytes should be recoverable',
      );
    });

    it('handles random binary data sequences (simulating GPG output)', () => {
      // Generate pseudo-random binary data (deterministic for testing)
      const randomBytes: number[] = [];
      let seed = 12345;
      for (let i = 0; i < 64; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0; // Unsigned to avoid overflow issues
        randomBytes.push(((seed / 65536) % 256) | 0); // Ensure integer
      }

      const binaryString = String.fromCharCode(...randomBytes);
      const dataBlock = 'D ' + binaryString + '\n';

      const encoded = encodeProtocolData(dataBlock);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded, dataBlock, 'Random binary sequence should survive round-trip');

      // Verify the binary was not corrupted by checking the buffer directly
      const encodedBuffer = Buffer.from(encoded);
      const expectedBuffer = Buffer.from(dataBlock, 'latin1');
      assert.deepStrictEqual(
        encodedBuffer,
        expectedBuffer,
        'Buffer representation should match exactly',
      );
    });

    it('sanitizeForLog handles binary data safely without corruption', () => {
      // Binary data that might appear in responses
      const binaryData = String.fromCharCode(0xab, 0xcd, 0xef, 0x12, 0x34);
      const input = 'SIGDATA ' + binaryData;

      // sanitizeForLog should not corrupt the data, just truncate for logging
      const sanitized = sanitizeForLog(input);

      // Should start with the first word
      assert.ok(sanitized.startsWith('SIGDATA'), 'Should start with first word');
      // Long input should be truncated
      if (input.length > 50) {
        assert.strictEqual(
          sanitized.length < input.length,
          true,
          'Should be truncated for logging',
        );
      }
    });

    it('handles large binary responses (e.g., exported keys)', () => {
      // Simulate a large key export (1KB of binary data)
      const largeData: number[] = [];
      for (let i = 0; i < 1024; i++) {
        largeData.push((i * 7) % 256); // Pseudo-random 1KB
      }

      const binaryString = String.fromCharCode(...largeData);
      const response = 'D ' + binaryString + '\nEND\nOK\n';

      const encoded = encodeProtocolData(response);
      const decoded = decodeProtocolData(encoded);

      assert.strictEqual(decoded.length, response.length, 'Full length should be preserved');
      assert.strictEqual(decoded, response, 'Large binary response should survive round-trip');
    });
  });

  describe('Response Completion Detection', () => {
    describe('OK responses', () => {
      it('detects simple OK response', () => {
        const result = detectResponseCompletion('OK\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('detects OK with additional text', () => {
        const result = detectResponseCompletion('OK Pleased to meet you\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('detects OK after status lines', () => {
        const response = 'S PROGRESS gpg_agent_get_confirmation 100 100\nOK\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('detects OK with trailing empty lines', () => {
        const result = detectResponseCompletion('OK\n\n\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('detects OK after D block', () => {
        const response = 'D This is some data\nOK\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });
    });

    describe('ERR responses', () => {
      it('detects ERR with error code and message', () => {
        const result = detectResponseCompletion('ERR 67109139 No secret key\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'ERR');
      });

      it('detects ERR with minimal code', () => {
        const result = detectResponseCompletion('ERR 1\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'ERR');
      });

      it('detects ERR after status lines', () => {
        const response = 'S PROGRESS key_lookup 50 100\nERR 67108873 Operation cancelled\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'ERR');
      });

      it('detects ERR with detailed message', () => {
        const result = detectResponseCompletion(
          'ERR 100663404 Inappropriate ioctl for device <Pinentry>\n',
        );
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'ERR');
      });
    });

    describe('INQUIRE responses', () => {
      it('detects INQUIRE with keyword', () => {
        const result = detectResponseCompletion('INQUIRE PASSPHRASE\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'INQUIRE');
      });

      it('detects INQUIRE with prompt text', () => {
        const result = detectResponseCompletion('INQUIRE PASSPHRASE Enter passphrase:\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'INQUIRE');
      });

      it('detects INQUIRE after status lines', () => {
        const response = 'S NEED_PASSPHRASE\nINQUIRE PASSPHRASE\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'INQUIRE');
      });
    });

    describe('Incomplete responses', () => {
      it('rejects response without trailing newline', () => {
        const result = detectResponseCompletion('OK');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects partial response with status only', () => {
        const result = detectResponseCompletion('S PROGRESS 50 100\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects multi-line status without completion', () => {
        const response = 'S KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4\nS KEYLIST_MODE 1\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects D block without completion', () => {
        const result = detectResponseCompletion('D Some data\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects empty string', () => {
        const result = detectResponseCompletion('');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects only whitespace', () => {
        const result = detectResponseCompletion('   \n  \n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('rejects comment lines without completion', () => {
        const result = detectResponseCompletion('# This is a comment\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });
    });

    describe('Edge cases', () => {
      it('handles OK at end with mixed whitespace', () => {
        const response = 'S DATA\n  \nOK  \n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('rejects OK-like text in middle of line', () => {
        const result = detectResponseCompletion('S NOT_OK_YET\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('handles very long multi-line responses', () => {
        const lines = ['S PROGRESS 1 100'];
        for (let i = 2; i <= 100; i++) {
          lines.push(`S PROGRESS ${i} 100`);
        }
        lines.push('OK');
        const response = lines.join('\n') + '\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('handles response with binary data in D block', () => {
        const binaryData = String.fromCharCode(0x00, 0xff, 0xab, 0xcd);
        const response = `D ${binaryData}\nOK\n`;
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('rejects when completion marker is case-sensitive mismatch', () => {
        const result = detectResponseCompletion('ok\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('handles multiple consecutive newlines before completion', () => {
        const result = detectResponseCompletion('S DATA\n\n\n\nOK\n');
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });

      it('rejects ERR-like text without space separator', () => {
        const result = detectResponseCompletion('S ERROR_OCCURRED\n');
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.type, null);
      });

      it('handles realistic KEYINFO response', () => {
        const response =
          'S KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4 T E77DE0715C50F8253FA55E7F78A8ACB2D65CC0FA - - - P - - -\nOK\n';
        const result = detectResponseCompletion(response);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.type, 'OK');
      });
    });
  });

  describe('Socket Cleanup', () => {
    interface MockSocket {
      removeAllListeners: () => void;
      destroy: () => void;
      shouldThrowOnRemove?: boolean;
      shouldThrowOnDestroy?: boolean;
      removeCalled?: boolean;
      destroyCalled?: boolean;
    }

    function createMockSocket(
      opts: { throwOnRemove?: boolean; throwOnDestroy?: boolean } = {},
    ): MockSocket {
      return {
        shouldThrowOnRemove: opts.throwOnRemove,
        shouldThrowOnDestroy: opts.throwOnDestroy,
        removeCalled: false,
        destroyCalled: false,
        removeAllListeners() {
          this.removeCalled = true;
          if (this.shouldThrowOnRemove) {
            throw new Error('Mock removeAllListeners error');
          }
        },
        destroy() {
          this.destroyCalled = true;
          if (this.shouldThrowOnDestroy) {
            throw new Error('Mock destroy error');
          }
        },
      };
    }

    it('should cleanup socket successfully when no errors', () => {
      const mockSocket = createMockSocket();
      const config = {
        logCallback: () => {
          /* silent */
        },
      };
      const error = cleanupSocket(mockSocket, config, 'test-session');

      assert.strictEqual(error, null, 'Should return null on successful cleanup');
      assert.strictEqual(mockSocket.removeCalled, true, 'Should call removeAllListeners');
      assert.strictEqual(mockSocket.destroyCalled, true, 'Should call destroy');
    });

    it('should return error when removeAllListeners throws', () => {
      const mockSocket = createMockSocket({ throwOnRemove: true });
      const config = {
        logCallback: () => {
          /* silent */
        },
      };
      const error = cleanupSocket(mockSocket, config, 'test-session');

      assert.ok(error instanceof Error, 'Should return Error instance');
      assert.ok(
        error?.message.includes('removeAllListeners'),
        'Error should mention removeAllListeners',
      );
      assert.strictEqual(
        mockSocket.removeCalled,
        true,
        'Should call removeAllListeners despite error',
      );
      assert.strictEqual(
        mockSocket.destroyCalled,
        true,
        'Should still call destroy after removeAllListeners error',
      );
    });

    it('should return error when destroy throws', () => {
      const mockSocket = createMockSocket({ throwOnDestroy: true });
      const config = {
        logCallback: () => {
          /* silent */
        },
      };
      const error = cleanupSocket(mockSocket, config, 'test-session');

      assert.ok(error instanceof Error, 'Should return Error instance');
      assert.ok(error?.message.includes('destroy'), 'Error should mention destroy');
      assert.strictEqual(mockSocket.removeCalled, true, 'Should call removeAllListeners');
      assert.strictEqual(mockSocket.destroyCalled, true, 'Should call destroy despite error');
    });

    it('should return first error when both operations throw (first-error-wins)', () => {
      const mockSocket = createMockSocket({ throwOnRemove: true, throwOnDestroy: true });
      const config = {
        logCallback: () => {
          /* silent */
        },
      };
      const error = cleanupSocket(mockSocket, config, 'test-session');

      assert.ok(error instanceof Error, 'Should return Error instance');
      assert.ok(
        error?.message.includes('removeAllListeners'),
        'Should return first error (removeAllListeners)',
      );
      assert.strictEqual(mockSocket.removeCalled, true, 'Should call removeAllListeners');
      assert.strictEqual(mockSocket.destroyCalled, true, 'Should call destroy despite first error');
    });

    it('should log all operations when logCallback provided', () => {
      const logs: string[] = [];
      const mockSocket = createMockSocket();
      const config = { logCallback: (msg: string) => logs.push(msg) };
      cleanupSocket(mockSocket, config, 'test-123');

      assert.ok(
        logs.some((l) => l.includes('[test-123]') && l.includes('listeners removed')),
        'Should log removeAllListeners success',
      );
      assert.ok(
        logs.some((l) => l.includes('[test-123]') && l.includes('destroyed')),
        'Should log destroy success',
      );
    });

    it('should log errors when operations throw', () => {
      const logs: string[] = [];
      const mockSocket = createMockSocket({ throwOnRemove: true, throwOnDestroy: true });
      const config = { logCallback: (msg: string) => logs.push(msg) };
      cleanupSocket(mockSocket, config, 'test-456');

      assert.ok(
        logs.some((l) => l.includes('[test-456]') && l.includes('Error removing')),
        'Should log removeAllListeners error',
      );
      assert.ok(
        logs.some((l) => l.includes('[test-456]') && l.includes('Error destroying')),
        'Should log destroy error',
      );
    });

    it('should handle non-Error throws gracefully', () => {
      const mockSocket = {
        removeCalled: false,
        destroyCalled: false,
        removeAllListeners() {
          this.removeCalled = true;
          throw 'string error'; // Not an Error object
        },
        destroy() {
          this.destroyCalled = true;
        },
      };

      const config = {
        logCallback: () => {
          /* silent */
        },
      };
      const error = cleanupSocket(mockSocket, config, 'test-session');

      assert.ok(error instanceof Error, 'Should convert string to Error instance');
      assert.strictEqual(error.message, 'string error');
    });
  });

  describe('Command Extraction', () => {
    it('should extract single complete command', () => {
      const result = extractCommand('KEYINFO\n');
      assert.strictEqual(result.extracted, 'KEYINFO\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should extract command and leave remaining data', () => {
      const result = extractCommand('KEYINFO\nNOP\n');
      assert.strictEqual(result.extracted, 'KEYINFO\n');
      assert.strictEqual(result.remaining, 'NOP\n');
    });

    it('should return null for incomplete command', () => {
      const result = extractCommand('KEYINFO');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, 'KEYINFO');
    });

    it('should handle empty buffer', () => {
      const result = extractCommand('');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, '');
    });

    it('should extract command with arguments', () => {
      const result = extractCommand('KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4\n');
      assert.strictEqual(result.extracted, 'KEYINFO D27BB288411333745EE1B194FBC6162A92775BA4\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should extract only first command when multiple present', () => {
      const result = extractCommand('GETINFO version\nNOP\nBYE\n');
      assert.strictEqual(result.extracted, 'GETINFO version\n');
      assert.strictEqual(result.remaining, 'NOP\nBYE\n');
    });

    it('should handle command with spaces', () => {
      const result = extractCommand('SETDESC Please enter passphrase\n');
      assert.strictEqual(result.extracted, 'SETDESC Please enter passphrase\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should handle partial command after newline', () => {
      const result = extractCommand('KEYINFO\nNOP');
      assert.strictEqual(result.extracted, 'KEYINFO\n');
      assert.strictEqual(result.remaining, 'NOP');
    });

    it('should handle just newline', () => {
      const result = extractCommand('\n');
      assert.strictEqual(result.extracted, '\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should handle multiple newlines', () => {
      const result = extractCommand('\n\n\n');
      assert.strictEqual(result.extracted, '\n');
      assert.strictEqual(result.remaining, '\n\n');
    });

    it('should preserve binary data in command', () => {
      const binaryData = String.fromCharCode(0x00, 0xff, 0xab);
      const buffer = `D ${binaryData}\n`;
      const result = extractCommand(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should handle very long command', () => {
      const longCommand = 'SETDESC ' + 'x'.repeat(10000) + '\n';
      const result = extractCommand(longCommand);
      assert.strictEqual(result.extracted, longCommand);
      assert.strictEqual(result.remaining, '');
    });
  });

  describe('INQUIRE D-block Extraction', () => {
    it('should extract simple D-block', () => {
      const result = extractInquireBlock('D data\nEND\n');
      assert.strictEqual(result.extracted, 'D data\nEND\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should extract D-block with multiple D lines', () => {
      const buffer = 'D line1\nD line2\nD line3\nEND\n';
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should return null for incomplete D-block (no END)', () => {
      const result = extractInquireBlock('D data\n');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, 'D data\n');
    });

    it('should return null for partial END', () => {
      const result = extractInquireBlock('D data\nEN');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, 'D data\nEN');
    });

    it('should return null for END without newline', () => {
      const result = extractInquireBlock('D data\nEND');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, 'D data\nEND');
    });

    it('should extract D-block and leave remaining data', () => {
      const result = extractInquireBlock('D data\nEND\nGETINFO\n');
      assert.strictEqual(result.extracted, 'D data\nEND\n');
      assert.strictEqual(result.remaining, 'GETINFO\n');
    });

    it('should handle empty buffer', () => {
      const result = extractInquireBlock('');
      assert.strictEqual(result.extracted, null);
      assert.strictEqual(result.remaining, '');
    });

    it('should handle just END\\n', () => {
      const result = extractInquireBlock('END\n');
      assert.strictEqual(result.extracted, 'END\n');
      assert.strictEqual(result.remaining, '');
    });

    it('should preserve binary data in D-block', () => {
      const binaryData = String.fromCharCode(0x00, 0xff, 0xab, 0xcd, 0xef);
      const buffer = `D ${binaryData}\nEND\n`;
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should handle D-block with all byte values (0-255)', () => {
      const bytes: number[] = [];
      for (let i = 0; i < 256; i++) {
        bytes.push(i);
      }
      const binaryString = String.fromCharCode(...bytes);
      const buffer = `D ${binaryString}\nEND\n`;
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should handle very large D-block (multiple MB)', () => {
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      const buffer = `D ${largeData}\nEND\n`;
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should handle multiple D-blocks sequentially', () => {
      const buffer1 = 'D data1\nEND\n';
      const result1 = extractInquireBlock(buffer1);
      assert.strictEqual(result1.extracted, buffer1);

      const buffer2 = 'D data2\nEND\n';
      const result2 = extractInquireBlock(buffer2);
      assert.strictEqual(result2.extracted, buffer2);
    });

    it('should handle D-block split across chunks (simulated)', () => {
      // Simulate first chunk: partial D-block
      const chunk1 = 'D some';
      const result1 = extractInquireBlock(chunk1);
      assert.strictEqual(result1.extracted, null);
      assert.strictEqual(result1.remaining, 'D some');

      // Simulate second chunk: continuation
      const chunk2 = result1.remaining + ' data\nEN';
      const result2 = extractInquireBlock(chunk2);
      assert.strictEqual(result2.extracted, null);
      assert.strictEqual(result2.remaining, 'D some data\nEN');

      // Simulate third chunk: completion
      const chunk3 = result2.remaining + 'D\n';
      const result3 = extractInquireBlock(chunk3);
      assert.strictEqual(result3.extracted, 'D some data\nEND\n');
      assert.strictEqual(result3.remaining, '');
    });

    it('should handle END appearing in middle of data', () => {
      const buffer = 'D This has END in it\nEND\n';
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, buffer);
      assert.strictEqual(result.remaining, '');
    });

    it('should find first END\\n occurrence', () => {
      const buffer = 'D data\nEND\nEND\n';
      const result = extractInquireBlock(buffer);
      assert.strictEqual(result.extracted, 'D data\nEND\n');
      assert.strictEqual(result.remaining, 'END\n');
    });

    it('should handle empty D-block', () => {
      const result = extractInquireBlock('D \nEND\n');
      assert.strictEqual(result.extracted, 'D \nEND\n');
      assert.strictEqual(result.remaining, '');
    });
  });
});
