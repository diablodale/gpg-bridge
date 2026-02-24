/**
 * Integration test helpers — barrel export.
 *
 * Import via: import { GpgTestHelper, AssuanSocketClient, assertSafeToDelete } from '@gpg-bridge/shared/test/integration'
 *
 * GpgTestHelper: extends production GpgCli with test lifecycle helpers (Phase 2+)
 * AssuanSocketClient: Assuan protocol socket test client (Phase 2 and Phase 3)
 * assertSafeToDelete: guard for recursive directory deletion
 */

export { GpgTestHelper } from './gpgCli';

export { AssuanSocketClient } from './assuanSocketClient';
export type { AssuanSocketClientOpts } from './assuanSocketClient';

export { assertSafeToDelete } from './fsUtils';
