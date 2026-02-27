The GPG Agent protocol is a **simple, line‑oriented, ASCII text protocol**, very similar in spirit to SMTP/IMAP-style command/response exchanges. The official documentation is terse, but the behavior is well‑established because `gpg-connect-agent` itself is just a thin wrapper around this protocol.

- [Assuan Protocol](https://www.gnupg.org/documentation/manuals/gnupg/Agent-Protocol.html) - GPG Agent Assuan protocol
- [Assuan Manual](https://www.gnupg.org/documentation/manuals/assuan/) - Assuan developer details

Below is a clear, practical breakdown of how to speak the protocol correctly so you can proxy it.

---

# 🧩 **How GPG Agent’s Socket Protocol Actually Works**

## 1. **Encoding**

- **All commands and responses are ASCII text.**
- **Lines are terminated with LF (`\n`)**, not CRLF.
- No binary framing, no length prefixes.
- Data blocks (e.g., key material) are Base64 or percent‑escaped text depending on the command.

---

## 2. **Basic Message Structure**

Every message is a **single line**:

```
COMMAND arguments...\n
```

Examples:

```
GETINFO version
KEYINFO --list
SIGKEY 1234567890ABCDEF
```

---

# 3. **Command/Response Flow**

The protocol is **strict request → response**.  
You **must wait for the agent’s response** before sending the next command.

### ✔️ **Successful response**

Always begins with:

```
OK
```

Optionally followed by text:

```
OK <some message>
```

### ❌ **Error response**

Begins with:

```
ERR <code> <description>
```

Example:

```
ERR 67108949 No such key
```

---

# 4. **Status and Data Lines**

Before the final `OK` or `ERR`, the agent may send:

### **Status lines**

Start with:

```
S <keyword> <data...>
```

Example:

```
S PINENTRY_LAUNCHED 1234
```

### **Data blocks**

Start with:

```
D <data...>
```

These are typically percent‑escaped or Base64 depending on the command.

---

# 5. **Multi-line Data Blocks**

Some commands (e.g., `SETKEY`, `IMPORT_KEY`) use a special block syntax:

```
INQUIRE <keyword>
```

This means the agent is asking the client to send data.

You respond with:

```
D <line1>
D <line2>
END
```

Then the agent continues with `OK` or `ERR`.

---

# 6. **Example Full Exchange**

### Client:

```
GETINFO version
```

### Server:

```
D 2.4.3
OK
```

---

### Client:

```
SIGKEY 1234567890ABCDEF
```

### Server:

```
S KEY_CREATED B 1234567890ABCDEF
OK
```

---

### Client:

```
BYE
```

### Server:

```
OK closing connection
```

---

# 7. **Proxying Considerations**

Since the protocol is:

- ASCII
- Line‑oriented
- Strict request/response
- No pipelining

Your proxy must:

### ✔️ **Forward lines exactly as-is**

Do not modify whitespace, percent escapes, or Base64.

### ✔️ **Preserve ordering**

Never send a new command until the previous one has produced `OK` or `ERR`.

### ✔️ **Handle INQUIRE blocks**

These are the only interactive cases.

### ✔️ **Treat the socket as a byte stream**

No packet boundaries exist—your “discrete packets” must be based on newline detection.

---

# 8. **Best Reference Implementation**

The easiest way to understand the protocol is to watch `gpg-connect-agent`:

```
gpg-connect-agent --verbose
```

You can type commands manually and see exactly what the agent sends back.

---

Handling **INQUIRE / D / END** blocks correctly is the trickiest part of the GPG Agent protocol, and it’s essential if you’re building a proxy. The good news is that the rules are consistent once you understand the flow.

Below is a clear, practical guide to handling these blocks safely and robustly.

---

# 🔐 What an `INQUIRE` Block Means

When the agent sends:

```
INQUIRE <keyword>
```

…it is **pausing the command** and asking the client to provide data.  
This is the _only_ time the agent expects the client to send more than one line before receiving an `OK` or `ERR`.

Examples of inquiries:

- `INQUIRE PINENTRY_LAUNCHED`
- `INQUIRE NEEDPIN`
- `INQUIRE PASSPHRASE`
- `INQUIRE KEYDATA`

---

# 🧭 The Required Client Response

When you receive an `INQUIRE`, you must send:

### 1. Zero or more data lines:

```
D <data>
D <more data>
```

### 2. A terminating line:

```
END
```

Only then will the agent resume processing and eventually send `OK` or `ERR`.

---

# 🧱 Safe Handling Rules (Critical for a Proxy)

## **1. Never send anything except `D` lines or `END` after an INQUIRE**

If you send a normal command instead of `D`/`END`, the agent will treat it as malformed input and close the connection.

Your proxy must enforce:

- After `INQUIRE`, the _only_ valid outgoing lines are:
  - `D ...`
  - `END`

---

## **2. Do not forward `INQUIRE` to the remote server unless intended**

If your proxy is translating or encapsulating the protocol, you must decide:

- Are you forwarding the inquiry to the remote server?
- Or are you handling it locally?

Most proxies simply forward everything, but you must ensure the remote side understands the protocol.

---

## **3. Preserve exact byte content in `D` lines**

`D` lines may contain:

- Percent‑escaped text
- Base64
- Arbitrary ASCII sequences

Your proxy must **not modify or re-encode** these lines.

---

## **4. Do not assume how many `D` lines will be sent**

Some inquiries expect:

- A single line (e.g., a passphrase)
- Multiple lines (e.g., key import)
- Zero lines (client just sends `END`)

Your proxy must treat `D` lines as a stream until it sees `END`.

---

## **5. After sending `END`, wait for `OK` or `ERR`**

The agent will not accept new commands until it finishes the inquiry.

Example:

```
INQUIRE NEEDPIN
```

Client:

```
D hunter2
END
```

Agent:

```
OK
```

Only now may the next command be sent.

---

## **6. Handle nested inquiries (rare but possible)**

The agent _can_ send another `INQUIRE` after you respond to the first one, before the final `OK`.

Your proxy must be prepared for:

```
INQUIRE A
  → D ... / END
INQUIRE B
  → D ... / END
OK
```

This is uncommon but valid.

---

# 🧪 Example of a Full Safe Exchange

### Agent:

```
INQUIRE NEEDPIN
```

### Proxy → Client:

(forward unchanged)

### Client → Proxy:

```
D 70617373776F7264
END
```

### Proxy → Agent:

(forward unchanged)

### Agent:

```
OK
```

### Proxy → Client:

(forward unchanged)

---

# 🛡️ Safety Checklist for Your Proxy

| Requirement                                      | Why it matters                         |
| ------------------------------------------------ | -------------------------------------- |
| Detect `INQUIRE` lines                           | Switch into “inquiry mode”             |
| Only allow `D` and `END` until inquiry completes | Prevent protocol corruption            |
| Forward data exactly as received                 | Avoid breaking percent‑encoding        |
| Wait for `OK`/`ERR` before next command          | Maintain strict request/response order |
| Support multiple sequential inquiries            | Some operations require them           |
| Never pipeline commands                          | GPG agent does not support pipelining  |
