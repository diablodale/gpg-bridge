# Dev Container CI

Managing dev container image pulls and container lifecycle for automated and
local integration test runs.

## Architecture analysis

### How `devcontainer up` works with a pure `"image"` config

Both `.devcontainer/phase2/devcontainer.json` and `.devcontainer/phase3/devcontainer.json`
use a pure `"image"` configuration — no `"build"` section, no Dockerfile. The behavior
was confirmed by source analysis of `devContainersSpecCLI.js` bundled in
`node_modules/@devcontainers/cli/dist/spec-node/`.

Key findings:

- **`uG()` — the main `devcontainer up` handler.** When it finds an existing container,
  it calls `vV()` which only starts the container if it is stopped. There is no config
  comparison, no hash check, no staleness detection — it blindly reuses whatever container
  it finds.
- **Container lookup (`mg()`)** uses:
  ```
  docker ps --filter label=devcontainer.local_folder=X --filter label=devcontainer.config_file=Y
  ```
  These two labels are the container's only identity. No ancestor/image relationship is
  checked.
- **Container creation (`UV()`)** runs `docker run` with `-l devcontainer.local_folder=...`
  and `-l devcontainer.config_file=...` as the identity labels. When the `devcontainer.json`
  uses `"image"`, the container is created directly from the MCR base — no intermediate
  named image is built.

The label key constants in the source are `mI = "devcontainer.local_folder"` and
`yI = "devcontainer.config_file"`.

**Drive letter case on Windows (confirmed by inspection of running containers):**
`devcontainer.local_folder` is set from `hostPath` (raw path, uppercase drive letter).
`devcontainer.config_file` is set from `URI.revive(configFile).fsPath`, and VS Code's
`URI.fsPath` always produces a lowercase Windows drive letter. `path.resolve()` in
Node.js produces uppercase. The `docker ps --filter` command is case-sensitive for
label values, so the `config_file` filter must explicitly lowercase the drive letter
before comparing, or no container will ever match.

### Why a `devcontainer build` + hash sentinel doesn't work here

A `devcontainer build --image-name gpg-bridge-phase2:latest` step produces a tagged
image and we stored a sha256 of `devcontainer.json` as a custom label on it. However:

1. `devcontainer up` on a pure `"image"` config never references `gpg-bridge-phase2:latest`
   as an ancestor. It runs the container directly from the MCR base image.
2. `devcontainer up` has no staleness detection of its own (see `uG()` above). Even if
   `devcontainer.json` changes, `devcontainer up` reuses the existing container unchanged.
3. Therefore the hash label on `gpg-bridge-phase2:latest` is completely invisible to the
   container lifecycle. The build step only pre-warms the Docker layer cache and produces
   a dead-end tagged image.

### Why `--id-label` doesn't help

`devcontainer up --id-label my-hash=abc123` stamps a custom label on the container and
uses it for lookup. However:

- `--id-label` **replaces** the default `devcontainer.local_folder`/`devcontainer.config_file`
  label scheme entirely — it does not augment it.
- Containers from a prior hash become orphans with no easily filterable label.
- VS Code's Dev Containers extension calls `devcontainer up` without `--id-label`, so it
  would create a duplicate container alongside ours, using the default label scheme.

### What actually works

Since `devcontainer up` blindly reuses any container it finds by label, **removing the
container is the only reliable mechanism to force a fresh one.** Combined with
`docker pull` to keep the base image current, that is the complete solution. No build
step, no hash sentinel, no custom labels on images.

## Implementation

`scripts/check-devcontainer.js` is called as an npm pre-hook before each integration
test suite. It takes one required argument:

```
node scripts/check-devcontainer.js --config <path>
```

**Steps (in order):**

1. Read the `"image"` field from the `devcontainer.json` at `<path>`.
2. `docker pull <image>` — idempotent; a no-op when the local digest already matches
   the registry. On CI (fresh checkout, no local images) it downloads the image before
   `devcontainer up` runs.
3. `removeExistingContainer()` — uses `docker ps --filter` on both identity labels to
   find and `docker rm --force` any existing container for this workspace+config pair.
   Filtering on both labels ensures we only remove the container for this specific phase,
   not a sibling phase container that shares the same workspace folder.

**Integration points:**

`gpg-bridge-request/package.json` runs the script as npm pre-hooks before each test suite:

```json
"pretest:integration:request-proxy": "node ../scripts/check-devcontainer.js --config .devcontainer/phase2/devcontainer.json",
"pretest:integration:gpg-cli":       "node ../scripts/check-devcontainer.js --config .devcontainer/phase3/devcontainer.json"
```

The VS Code tasks "Refresh Phase 2 dev container" and "Refresh Phase 3 dev container"
call the script manually to pull a fresh image and reset the container state on demand.

**devcontainer CLI label invariant:**

The label values used by `removeExistingContainer()` match exactly what the test runners
embed in `REMOTE_CONTAINER_URI`:

| Docker label                | Value in `check-devcontainer.js`              | Value in test runner URI JSON   |
| --------------------------- | --------------------------------------------- | ------------------------------- |
| `devcontainer.local_folder` | `repoRoot`                                    | `hostPath`                      |
| `devcontainer.config_file`  | `resolvedConfig` with drive letter lowercased | `URI.revive(configFile).fsPath` |

⚠️ **Drive letter case on Windows**: `devcontainer.local_folder` uses the raw `hostPath`
value (uppercase drive letter, e.g. `C:\...`); `devcontainer.config_file` uses
`URI.revive(configFile).fsPath`, and VS Code's `URI.fsPath` always lowercases Windows
drive letters (e.g. `c:\...`). `path.resolve()` in Node.js produces uppercase.
`removeExistingContainer()` normalizes `resolvedConfig`'s drive letter to lowercase
before using it as the `config_file` filter value, otherwise Docker's label filter
(case-sensitive for values) never matches and no container is found.

**CI behavior:**

On a fresh CI checkout with no local images, `docker pull` downloads the image.
No separate CI-specific code path is needed.

## Manual tests

Run from the repository root. `removeExistingContainer()` runs at the end of every
execution — the tests below use a config whose container does not exist, so the removal
step logs "No existing container to remove" and exits cleanly.

#### 1. Argument validation

```powershell
# Missing --config should print usage and exit 1
node scripts/check-devcontainer.js
```

Expected:

```
Missing required argument: --config
Usage: node scripts/check-devcontainer.js --config <path>
```

#### 2. Successful pull path

```powershell
node scripts/check-devcontainer.js --config .devcontainer/phase2/devcontainer.json
```

Expected log lines (docker pull output appears between them):

```
[check-devcontainer] Config: .devcontainer/phase2/devcontainer.json
[check-devcontainer] Image:  mcr.microsoft.com/devcontainers/javascript-node:22-trixie
[check-devcontainer] Pulling: mcr.microsoft.com/devcontainers/javascript-node:22-trixie
[check-devcontainer] Pull complete
[check-devcontainer] No existing container to remove
```

#### 3. Security: path traversal protection

The script rejects any `--config` value that resolves outside the repository root —
whether via relative `..` segments, normalized mid-path traversal, or absolute paths.
All three cases must exit 1.

```powershell
# Relative escape
node scripts/check-devcontainer.js --config ..\..\outside.json

# Traversal buried in a longer path (path.resolve normalises it before the check)
node scripts/check-devcontainer.js --config ".devcontainer\phase2\..\..\..\..\outside.json"

# Absolute path outside the repo root
node scripts/check-devcontainer.js --config "C:\Windows\System32\drivers\etc\hosts"
```

Expected for all three — exits 1:

```
--config resolves outside the repository root: <resolved path>
```

#### 4. Security: image name validation

The `"image"` value extracted from `devcontainer.json` is matched against the OCI
image name regex before use. A malformed value in the config file causes exit 1 before
any Docker call is made. Construct a throwaway JSON to trigger this:

```powershell
# Write a devcontainer.json with a bad image name into a temp dir inside the repo
$tmp = "tmp-ci-test"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
'{"image": "bad image name!"}' | Set-Content "$tmp\devcontainer.json"
node scripts/check-devcontainer.js --config "$tmp\devcontainer.json"
Remove-Item -Recurse -Force $tmp
```

Expected — exits 1:

```
Invalid image name in tmp-ci-test\devcontainer.json: bad image name!
```

#### 5. Security: no shell interpolation (structural check)

The script passes `shell: false` to every `spawnSync` call. Arguments are always passed
as a JavaScript array, which Node.js hands directly to `CreateProcess` (Windows) or
`execve` (Linux/macOS). Shell metacharacters in argument strings are passed as literals
and cannot trigger unintended shell behaviour.

Confirm every `shell:` option in the script is `false`, never `true`:

```powershell
Select-String -Path scripts\check-devcontainer.js -Pattern 'shell\s*:'
```

Expected: three matches, all reading `shell: false`. Zero matches for `shell: true`.

Also confirm that `docker rm --force` is the only use of `'--force'` in an argument
array — it is Docker's own flag, not a CLI option of this script:

```powershell
Select-String -Path scripts\check-devcontainer.js -Pattern "'--force'"
```

Expected: exactly one match, on the `docker rm` line.
