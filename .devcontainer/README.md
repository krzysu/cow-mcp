# Dev Container

Optional sandboxed development environment. The goal is to isolate `pnpm install`, builds, and tests from the host machine so a malicious dependency cannot read host secrets (SSH keys, AWS credentials, keychain, browser cookies, env vars) or exfiltrate them.

## Usage

1. Install [OrbStack](https://orbstack.dev) (recommended on macOS) or Docker Desktop.
2. Install the **Dev Containers** extension for VS Code or Cursor.
3. Open this repo → Command Palette → **"Dev Containers: Reopen in Container"**.

First build pulls the image and runs `pnpm install`; subsequent opens are instant.

## Workflow

- **Edit, `git`, signing → host machine.** Source is bind-mounted at `/workspace`. Use a host terminal (iTerm, Ghostty, Terminal.app) for `git push` so signing keys / SSH agent never enter the container.
- **Install, build, run, test → container.** Use the VS Code integrated terminal (it runs inside the container) for `pnpm install`, `pnpm test`, `pnpm dev`.

## Security choices

| Choice | Why |
| --- | --- |
| `containerEnv.SSH_AUTH_SOCK = ""` + `remote.SSH.enableAgentForwarding: false` | VS Code's default behavior forwards the host SSH agent into the container. With forwarding on, a malicious dep can use your SSH key without ever seeing the key file. We turn it off. |
| `pnpm config set ignore-scripts true` (set in `postCreateCommand`) | Disables npm/pnpm postinstall scripts by default — the most common supply-chain attack vector. `pnpm rebuild` runs allowed native rebuilds explicitly. To opt in for a specific install, run `pnpm install --ignore-scripts=false` and review the package first. |
| Named Docker volume for `node_modules` (with pnpm `store-dir` inside it) | Dependencies live in a Docker volume invisible to the host filesystem. The host only ever sees source files. The store sits inside the same volume so pnpm's hardlink-based installs work correctly (cross-filesystem stores fall back to project-local `.pnpm-store`, which would defeat the isolation). |
| `remoteUser: node` | Runs as a non-root container user. Defense in depth against container-escape exploits. |

## What this does _not_ protect against

- **Code written into the bind mount.** `/workspace` is the host filesystem. A malicious dependency that runs (a postinstall, a test, the dev server) can modify source files, `package.json`, or `.git/hooks` — and you'd then `git push` the result. `ignore-scripts` reduces this; reviewing diffs before pushing closes it.
- **Secrets you set inside the container.** Network egress is unrestricted. If you `export PRIVATE_KEY=…` in the container shell, a malicious dep can exfiltrate it. Don't do that — keep test secrets on the host and pass them only when actually needed.
- **End users of cow-mcp.** This sandbox is for _developing_ the server. The published binary runs on the consumer's host with whatever env vars the MCP client passes (e.g. `PRIVATE_KEY`). End users wanting the same protection should run their MCP client (and cow-mcp) inside a container of their own.

## Resetting

```bash
# from host terminal, container stopped:
docker volume rm cow-mcp-node-modules
```

Then "Reopen in Container" rebuilds the volume from scratch.
