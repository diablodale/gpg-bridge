# Request Proxy State Machine Refactor

## Overview

Refactor `request-proxy` from an implicit event-driven model into an explicit function-pointer state machine with clear states, events, and transitions. This improves maintainability, testability, and visibility into protocol behavior.

## States

- `DISCONNECTED` — no client socket
- `CLIENT_CONNECTED` — client socket accepted, paused
- `AGENT_CONNECTING` — connecting to agent, awaiting greeting
- `READY` — agent connected, ready to buffer client commands
- `BUFFERING_COMMAND` — accumulating command bytes from client
- `BUFFERING_INQUIRE` — accumulating D-block bytes from client
- `DATA_READY` — complete command or D-block received, ready to send
- `SENDING_TO_AGENT` — sending command/D-block to agent
- `WAITING_FOR_AGENT` — awaiting complete response from agent
- `SENDING_TO_CLIENT` — sending response to client
- `ERROR` — error occurred, beginning cleanup
- `CLOSING` — cleanup in progress
- `FATAL` — unrecoverable error; terminal state
- (Terminal) ← DISCONNECTED after successful cleanup

## Events

- `CLIENT_SOCKET_CONNECTED` — new client socket accepted
- `START_AGENT_CONNECT` — initiate agent connection
- `AGENT_GREETING_OK` — agent greeting received successfully
- `AGENT_CONNECT_ERROR` — agent connection failed
- `CLIENT_DATA_START` — first chunk of client data arrives (for command flow)
- `CLIENT_DATA_PARTIAL` — data arrives but incomplete command
- `COMMAND_COMPLETE` — complete command line (with `\n`) received
- `INQUIRE_DATA_START` — first chunk of client data arrives (for inquire flow)
- `INQUIRE_DATA_PARTIAL` — data arrives but incomplete D-block
- `INQUIRE_COMPLETE` — complete D-block (ending with `END\n`) received
- `BUFFER_ERROR` — error during buffering (e.g., encoding issue)
- `DISPATCH_DATA` — send complete command or D-block to agent
- `WRITE_OK` — write to agent/client succeeded
- `WRITE_ERROR` — write to agent/client failed
- `AGENT_RESPONSE_COMPLETE` — complete response from agent received
- `AGENT_TIMEOUT` — no response from agent within timeout
- `AGENT_SOCKET_ERROR` — agent socket error (ECONNRESET, etc.)
- `CLIENT_DATA_DURING_WAIT` — client sent data while waiting for agent
- `RESPONSE_OK_OR_ERR` — agent response is OK or ERR (transition to READY)
- `RESPONSE_INQUIRE` — agent response contains INQUIRE (transition to BUFFERING_INQUIRE)
- `CLEANUP_START` — beginning cleanup (ERROR → CLOSING)
- `CLEANUP_COMPLETE` — cleanup finished successfully (CLOSING → DISCONNECTED)
- `CLEANUP_ERROR` — cleanup encountered an error (CLOSING → FATAL)

## State Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> DISCONNECTED

    DISCONNECTED --> CLIENT_CONNECTED: client_socket_connected
    CLIENT_CONNECTED --> AGENT_CONNECTING: start_agent_connect
    AGENT_CONNECTING --> READY: agent_greeting_ok
    AGENT_CONNECTING --> ERROR: agent_connect_error

    READY --> BUFFERING_COMMAND: client_data_start

    BUFFERING_COMMAND --> BUFFERING_COMMAND: client_data_partial
    BUFFERING_COMMAND --> DATA_READY: command_complete
    BUFFERING_COMMAND --> ERROR: buffer_error

    DATA_READY --> SENDING_TO_AGENT: dispatch_data

    SENDING_TO_AGENT --> WAITING_FOR_AGENT: write_ok
    SENDING_TO_AGENT --> ERROR: write_error

    WAITING_FOR_AGENT --> SENDING_TO_CLIENT: agent_response_complete
    WAITING_FOR_AGENT --> ERROR: agent_timeout
    WAITING_FOR_AGENT --> ERROR: agent_socket_error
    WAITING_FOR_AGENT --> ERROR: client_data_during_wait

    SENDING_TO_CLIENT --> READY: response_ok_or_err
    SENDING_TO_CLIENT --> BUFFERING_INQUIRE: response_inquire
    SENDING_TO_CLIENT --> ERROR: write_error

    BUFFERING_INQUIRE --> BUFFERING_INQUIRE: inquire_data_start
    BUFFERING_INQUIRE --> BUFFERING_INQUIRE: inquire_data_partial
    BUFFERING_INQUIRE --> DATA_READY: inquire_complete
    BUFFERING_INQUIRE --> ERROR: buffer_error

    ERROR --> CLOSING: cleanup_start
    CLOSING --> DISCONNECTED: cleanup_complete
    CLOSING --> FATAL: cleanup_error
    FATAL --> [*]
```

## Implementation Plan

### Phase 1: Type Definitions & Infrastructure ✅ COMPLETE
**File:** `request-proxy/src/services/requestProxy.ts`

- [x] Define `ClientState` type with all 12 states
- [x] Define `StateEvent` union with all 20+ events (22 total)
- [x] Define `StateHandler` function signature
- [x] Create transition table (lookup: `(state, event) → nextState`)
- [x] Add validation that transition table covers all valid (state, event) pairs
- [x] Create `dispatch(event: StateEvent) → Promise<void>` function as central router (implemented as `dispatchStateEvent`)

#### Dependency Injection Design ✅ COMPLETE
- [x] `RequestProxyConfig` — public API, no `commandExecutor` (static config only)
- [x] `RequestProxyDeps` — optional dependencies for injection (includes `commandExecutor`, `serverFactory`, `fileSystem`, `getSocketPath`)
- [x] `RequestProxyConfigWithExecutor` — internal type used by handlers (guarantees `commandExecutor` is present)
- [x] Simplify `startRequestProxy(config, deps?)` signature (removed `Omit<>` pattern)
- [x] All handlers use internal type with executor (non-optional, type-safe)

### Phase 2: State Handlers ✅ COMPLETE
**File:** `request-proxy/src/services/requestProxy.ts`  
Implement handler for each state:

- [x] `handleDisconnected(event)` — only accepts `CLIENT_SOCKET_CONNECTED`
- [x] `handleClientConnected(event)` — only accepts `START_AGENT_CONNECT`
- [x] `handleAgentConnecting(event)` — accepts `AGENT_GREETING_OK`, `AGENT_CONNECT_ERROR`
- [x] `handleReady(event)` — only accepts `CLIENT_DATA_START`
- [x] `handleBufferingCommand(event)` — accumulates data; emits `COMMAND_COMPLETE` or stays in state
- [x] `handleDataReady(event)` — only accepts `DISPATCH_DATA`
- [x] `handleSendingToAgent(event)` — only accepts `WRITE_OK`, `WRITE_ERROR`
- [x] `handleWaitingForAgent(event)` — accepts `AGENT_RESPONSE_COMPLETE`, timeouts, socket errors, pipelined data
- [x] `handleSendingToClient(event)` — only accepts `WRITE_OK`, `WRITE_ERROR` plus determination of next state
- [x] `handleBufferingInquire(event)` — accumulates D-block; emits `INQUIRE_COMPLETE` or stays in state

- [x] `handleError(event)` — only accepts `CLEANUP_START`
- [x] `handleClosing(event)` — accepts `CLEANUP_COMPLETE`, `CLEANUP_ERROR` (goes to `FATAL`)
- [x] `handleFatal(event)` — no transitions out; log state and remain
- [x] `dispatchStateEvent()` — central router for state machine dispatch

### Phase 3: Socket Event Integration ✅ COMPLETE
**File:** `request-proxy/src/services/requestProxy.ts`  
Wire socket callbacks to emit events:

- [x] Client `on('readable')` → emit `CLIENT_DATA_START`/`CLIENT_DATA_PARTIAL` (for READY/BUFFERING_COMMAND) or `INQUIRE_DATA_START`/`INQUIRE_DATA_PARTIAL` (for BUFFERING_INQUIRE)
- [x] Socket handler is state-aware: checks current state to determine correct event type
- [x] Client `on('error')` → logs error; cleanup triggered by `on('close')` event
- [x] Client `on('close')` → calls `disconnectAgent()` directly (cleanup outside state machine)
- [x] Socket initialization → emits `CLIENT_SOCKET_CONNECTED`, `START_AGENT_CONNECT`, connects to agent and emits `AGENT_GREETING_OK` or `AGENT_CONNECT_ERROR`
- [x] Fixed `handleDisconnected` to properly handle `CLIENT_SOCKET_CONNECTED` and return `CLIENT_CONNECTED`
- [x] Fixed `handleClientConnected` to properly handle `START_AGENT_CONNECT` and return `AGENT_CONNECTING`
- [x] Added `INQUIRE_DATA_START` event for symmetric design with command flow
- [x] Updated `handleBufferingInquire` to accept both `INQUIRE_DATA_START` and `INQUIRE_DATA_PARTIAL`
- [x] Write operations use existing `writeToClient()` function with error callback (WRITE_OK/WRITE_ERROR emission deferred to Phase 5/6)

### Phase 4: Buffer Management
**File:** `request-proxy/src/services/requestProxy.ts`

Create a shared buffer utility to avoid duplication:

- [ ] Extract `extractFromBuffer(buffer, delimiter) → { extracted: string | null; remaining: string }` helper function
  - For `BUFFERING_COMMAND`: delimiter is `'\n'`
  - For `BUFFERING_INQUIRE`: delimiter is `'END\n'`
  - Returns extracted data (or null if incomplete) and remaining buffer
- [ ] Use latin1 encoding consistently throughout
- [ ] Remove calls to `extractNextCommand()` and `determineNextState()` from shared

Then in the state handlers:

- [ ] `handleBufferingCommand`: call `extractFromBuffer(buffer, '\n')`, emit `COMMAND_COMPLETE` if extracted, else stay in state
- [ ] `handleBufferingInquire`: call `extractFromBuffer(buffer, 'END\n')`, emit `INQUIRE_COMPLETE` if extracted, else stay in state

### Phase 5: Response Processing & INQUIRE Detection
**File:** `request-proxy/src/services/requestProxy.ts`

- [ ] In `handleWaitingForAgent`, accumulate agent response with proper binary handling
- [ ] Detect complete response (ends with OK/ERR/INQUIRE at line start)
- [ ] In `handleSendingToClient`, parse response to check for `INQUIRE`
- [ ] Emit `RESPONSE_OK_OR_ERR` or `RESPONSE_INQUIRE` event
- [ ] Transition to `READY` or `BUFFERING_INQUIRE` accordingly

### Phase 6: Error Handling & Cleanup
**File:** `request-proxy/src/services/requestProxy.ts`

- [ ] Implement `handleError` to initiate graceful shutdown
- [ ] Implement `handleClosing` to perform full session cleanup:
  - [ ] Remove socket event listeners (close, error, readable, etc.)
  - [ ] Destroy socket connection
  - [ ] Clear session buffer
  - [ ] Clear sessionId
  - [ ] Remove session entry from session map
  - [ ] Emit either `CLEANUP_COMPLETE` (success) or `CLEANUP_ERROR` (failure) event
- [ ] Implement `handleFatal` to log fatal state and ensure no recovery attempts
- [ ] Add explicit logging for all error transitions
- [ ] Ensure cleanup always runs, even on internal errors
- [ ] Validate that cleanup errors transition to `FATAL` (not loop back)

### Phase 7a: Tests for Current Implementation (Phases 1-3)
**File:** `request-proxy/src/test/requestProxy.test.ts`

#### State Machine Fundamentals
- [ ] Transition table validation: use TypeScript type system to ensure all (state, event) pairs are handled
- [ ] Add tests for each valid state transition in the table (focus on implemented transitions)
- [ ] Add tests for implemented error transitions (AGENT_CONNECT_ERROR → ERROR)
- [ ] Ensure all 13 states have handlers (compile-time validation via stateHandlers map)

#### State-Aware Socket Event Emission (Critical - would catch Phase 3 bug)
- [ ] Test socket handler in READY state with empty buffer emits `CLIENT_DATA_START`
- [ ] Test socket handler in BUFFERING_COMMAND state with data in buffer emits `CLIENT_DATA_PARTIAL`
- [ ] Test socket handler in BUFFERING_INQUIRE state with empty buffer emits `INQUIRE_DATA_START`
- [ ] Test socket handler in BUFFERING_INQUIRE state with data in buffer emits `INQUIRE_DATA_PARTIAL`
- [ ] Test that socket handler checks `session.state` to determine event type
- [ ] Test transition from READY with first data chunk

#### State Transition Verification
- [ ] Add helper/mechanism to capture and inspect `session.state` field during tests
- [ ] Test complete connection sequence: DISCONNECTED → CLIENT_CONNECTED → AGENT_CONNECTING → READY
- [ ] Test that CLIENT_SOCKET_CONNECTED event transitions from DISCONNECTED to CLIENT_CONNECTED
- [ ] Test that START_AGENT_CONNECT event transitions from CLIENT_CONNECTED to AGENT_CONNECTING
- [ ] Test that AGENT_GREETING_OK event transitions from AGENT_CONNECTING to READY
- [ ] Test that AGENT_CONNECT_ERROR event transitions from AGENT_CONNECTING to ERROR
- [ ] Verify state field updates synchronously after each dispatchStateEvent call
- [ ] Test that greeting is written to client socket upon AGENT_GREETING_OK

#### Invalid Event Tests (Current States)
- [ ] Test sending invalid event to DISCONNECTED state (e.g., AGENT_GREETING_OK)
- [ ] Test sending invalid event to CLIENT_CONNECTED state (e.g., CLIENT_DATA_START)
- [ ] Test sending invalid event to AGENT_CONNECTING state (e.g., COMMAND_COMPLETE)
- [ ] Test sending invalid event to READY state (e.g., INQUIRE_DATA_START)
- [ ] Verify handler throws error with descriptive message
- [ ] Verify error transitions state to ERROR via dispatchStateEvent error handler

#### Basic Session Lifecycle
- [ ] Test socket close event calls disconnectAgent
- [ ] Test socket error event is logged
- [ ] Test server creation and listening
- [ ] Test server stop and cleanup

### Phase 7b: Tests for Buffer Management (Phase 4)
**File:** `request-proxy/src/test/requestProxy.test.ts`

#### Buffering Scenarios - Commands
- [ ] Test partial data arrival in BUFFERING_COMMAND (multiple chunks before newline)
- [ ] Test command split across 2 chunks
- [ ] Test command split across 3+ chunks
- [ ] Test multiple commands in single chunk (first command extracted, rest buffered)
- [ ] Test newline as last byte in chunk
- [ ] Test newline split across chunk boundary
- [ ] Test empty command (just newline)
- [ ] Test very long command (multiple KB)

#### Buffering Scenarios - INQUIRE D-blocks
- [ ] Test partial D-block arrival in BUFFERING_INQUIRE (multiple chunks before END\n)
- [ ] Test D-block split across 2 chunks
- [ ] Test D-block split across 3+ chunks
- [ ] Test END\n as last bytes in chunk
- [ ] Test END\n split across chunk boundary (EN|D\n, E|ND\n, END|\n)
- [ ] Test D-block with binary data (all byte values 0-255)
- [ ] Test multiple D lines before END
- [ ] Test very large D-block (multiple MB)

#### Buffer Management & Clearing
- [ ] Test buffer is cleared after command is extracted and COMMAND_COMPLETE emitted
- [ ] Test buffer is cleared after transitioning from BUFFERING_COMMAND to DATA_READY
- [ ] Test buffer is cleared after D-block is extracted and INQUIRE_COMPLETE emitted
- [ ] Test buffer is cleared after INQUIRE response and before entering BUFFERING_INQUIRE
- [ ] Test buffer retains remaining data after extracting first command/D-block
- [ ] Test buffer state when pipelined data arrives (remains in buffer for next processing)

#### Event Emission from Buffering States
- [ ] Test BUFFERING_COMMAND emits COMMAND_COMPLETE when newline detected
- [ ] Test BUFFERING_COMMAND stays in state when newline not detected
- [ ] Test BUFFERING_INQUIRE emits INQUIRE_COMPLETE when END\n detected
- [ ] Test BUFFERING_INQUIRE stays in state when END\n not detected
- [ ] Test COMMAND_COMPLETE event includes extracted command string
- [ ] Test INQUIRE_COMPLETE event includes extracted D-block string

### Phase 7c: Tests for Response Processing & INQUIRE (Phase 5)
**File:** `request-proxy/src/test/requestProxy.test.ts`

#### INQUIRE Response Detection
- [ ] Test INQUIRE response detection (starts with "INQUIRE")
- [ ] Test INQUIRE response detection (contains "\nINQUIRE")
- [ ] Test case sensitivity of INQUIRE detection
- [ ] Test OK response does not trigger INQUIRE detection
- [ ] Test ERR response does not trigger INQUIRE detection
- [ ] Test RESPONSE_INQUIRE event emission
- [ ] Test RESPONSE_OK_OR_ERR event emission

#### INQUIRE Flow (Comprehensive End-to-End)
- [ ] Test full INQUIRE cycle:
  1. Send command → READY → BUFFERING_COMMAND → DATA_READY
  2. Command sent to agent, receive INQUIRE response
  3. INQUIRE detected → emit RESPONSE_INQUIRE → transition to BUFFERING_INQUIRE
  4. Verify buffer is empty at BUFFERING_INQUIRE entry
  5. Client sends D-block data → accumulate in BUFFERING_INQUIRE
  6. Client sends END\n → emit INQUIRE_COMPLETE → transition to DATA_READY
  7. D-block sent to agent → receive OK response
  8. OK response sent to client → transition to READY
- [ ] Test INQUIRE with binary data in D-block (preserve all bytes)
- [ ] Test INQUIRE with multiple D lines
- [ ] Test multiple sequential INQUIRE sequences in same session
- [ ] Test nested INQUIRE (agent responds to D-block with another INQUIRE)
- [ ] Test INQUIRE followed by regular command

#### Response Processing
- [ ] Test agent response accumulation in WAITING_FOR_AGENT
- [ ] Test complete response detection (ends with OK/ERR/INQUIRE)
- [ ] Test response parsing in SENDING_TO_CLIENT
- [ ] Test proper state transition based on response type
- [ ] Test response with binary data is preserved

### Phase 7d: Tests for Error Handling & Cleanup (Phase 6)
**File:** `request-proxy/src/test/requestProxy.test.ts`

#### Invalid Event Tests (All States)
- [ ] Test sending invalid event to BUFFERING_COMMAND (e.g., AGENT_GREETING_OK)
- [ ] Test sending invalid event to BUFFERING_INQUIRE (e.g., CLIENT_DATA_START)
- [ ] Test sending invalid event to DATA_READY (e.g., CLIENT_SOCKET_CONNECTED)
- [ ] Test sending invalid event to SENDING_TO_AGENT, WAITING_FOR_AGENT, SENDING_TO_CLIENT
- [ ] Test sending invalid event to ERROR, CLOSING, FATAL states
- [ ] Verify all invalid events transition to ERROR state

#### Error Handling
- [ ] Test transition to ERROR state from AGENT_CONNECTING on connection failure
- [ ] Test transition to ERROR state from BUFFERING_COMMAND on buffer error
- [ ] Test transition to ERROR state from BUFFERING_INQUIRE on buffer error
- [ ] Test transition to ERROR state from SENDING_TO_AGENT on write error
- [ ] Test transition to ERROR state from WAITING_FOR_AGENT on timeout
- [ ] Test transition to ERROR state from WAITING_FOR_AGENT on socket error
- [ ] Test transition to ERROR state from SENDING_TO_CLIENT on write error
- [ ] Test ERROR state emits CLEANUP_START automatically
- [ ] Test ERROR state logs error information

#### Cleanup Sequence
- [ ] Test cleanup sequence: ERROR → CLOSING → DISCONNECTED
- [ ] Test cleanup on agent connection failure: AGENT_CONNECTING → ERROR → CLOSING → DISCONNECTED
- [ ] Test CLOSING state removes all socket event listeners (close, error, readable)
- [ ] Test CLOSING state calls socket.destroy()
- [ ] Test CLOSING state clears session buffer
- [ ] Test CLOSING state clears sessionId
- [ ] Test CLOSING state calls commandExecutor.disconnectAgent if sessionId exists
- [ ] Test CLOSING emits CLEANUP_COMPLETE on success → DISCONNECTED
- [ ] Test `CLOSING` → `FATAL` on cleanup error (CLEANUP_ERROR event)
- [ ] Test FATAL state has no outbound transitions
- [ ] Test FATAL state logs terminal status

#### Pipelined Data & Edge Cases
- [ ] Test pipelined client data during `WAITING_FOR_AGENT` (should emit CLIENT_DATA_DURING_WAIT → ERROR)
- [ ] Test client sends data while in AGENT_CONNECTING state (should buffer or error)
- [ ] Test client sends data while in ERROR state
- [ ] Test client sends data while in CLOSING state
- [ ] Test rapid connect/disconnect cycles
- [ ] Test buffer overflow scenarios (commands exceeding reasonable size limits)
- [ ] Test socket errors during various states
- [ ] Test multiple errors in sequence (error during error handling)

#### Session Lifecycle & Cleanup
- [ ] Test full session teardown after client disconnects
- [ ] Test disconnectAgent is called when socket close event fires
- [ ] Test multiple sequential sessions reuse same server (connect → disconnect → connect)
- [ ] Test that DISCONNECTED state can accept new CLIENT_SOCKET_CONNECTED after cleanup
- [ ] Test socket listeners are properly removed (no memory leaks)
- [ ] Test that old session data doesn't leak into new sessions

### Phase 8: Cleanup
**Files:** `shared/src/protocol.ts`, `shared/src/test/protocol.test.ts`

- [ ] Check if `extractNextCommand()` is used elsewhere (agent-proxy, other extensions)
- [ ] Check if `determineNextState()` is used elsewhere
- [ ] If unused, mark as deprecated or remove entirely
- [ ] If used elsewhere, keep and ensure tests remain valid
- [ ] Remove import of these helpers from `request-proxy`

### Phase 9: Compile & Test
**Files:** Root directory

- [ ] Run `npm run compile` — all packages must compile without error
- [ ] Run `npm test` — all existing tests must pass
- [ ] Verify no regressions in agent-proxy or extension behavior

## Success Criteria

- [ ] All 12 states implemented with explicit handlers
- [ ] Transition table covers all valid (state, event) pairs
- [ ] All error paths explicitly listed and tested
- [ ] Socket callbacks emit events into dispatcher
- [ ] Buffering logic is explicit (not implicit)
- [ ] INQUIRE detection is clear and testable
- [ ] Client data during `WAITING_FOR_AGENT` properly rejected
- [ ] No calls to removed shared helpers remain in request-proxy
- [ ] All tests pass; no regressions
- [ ] Mermaid diagram matches implementation

## Notes

- **Event flow is deterministic** per the state diagram; socket callbacks emit events and handlers follow defined transitions. No async/sync debate—the state paths are fixed.
- **Handlers emit events** as defined in the plan; example: `handleBufferingCommand` accumulates data and emits `COMMAND_COMPLETE` when newline is detected, or stays in state on partial data.
- **Timeouts in request-proxy** are limited to `gpgconf` calls (socket path resolution). Agent-proxy handles its own response timeouts internally via `waitForResponse()` and emits `AGENT_TIMEOUT` to the dispatcher.
- **Full session cleanup** in `CLOSING` state must release all resources tied to the client session:
  - Remove socket and all event listeners
  - Clear buffer and sessionId
  - Remove session entry from session map
  - This allows a new client-initiated session to begin at `DISCONNECTED` without residual state.
- **Transition table validation** occurs via TypeScript type checking (ensure all state/event pairs are handled) and unit tests (verify each transition produces correct next state). No runtime validation needed.
- **Dispatcher is event-driven** (not a polling loop); socket callbacks emit events asynchronously into the dispatcher, which routes them through state handlers deterministically.
- **Logging** uses `log(config, message)` with `sanitizeForLog()` for protocol data (per AGENTS.md).
- **Binary safety** maintained via latin1 encoding throughout.
