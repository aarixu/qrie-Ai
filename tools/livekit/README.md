# tools/livekit

The LiveKit server the live doubt session runs on, as one command on a machine
with no Docker.

```bash
npm run livekit:server
```

First run downloads `livekit_1.13.5_windows_amd64.zip` (17 MB) from the GitHub
release, checks its SHA-256 against the release's own `checksums.txt`, unpacks it
into `tools/livekit/bin/v1.13.5/` (gitignored, never committed), prints the ports
and starts the server with the config in this folder. Every later run skips
straight to starting it. Nothing is installed system-wide; deleting
`tools/livekit/bin/` undoes all of it.

## The whole live path, in order

Four terminals. Order matters — the agent worker **exits rather than retries**
if the server is not up yet.

```bash
npm run livekit:server   # 1. the SFU. Leave it running.
npm run agent:worker     # 2. the live tutor. Registers at ws://127.0.0.1:7880/agent
npm run agent:token      # 3. mints browser join tokens, on :7890
npm run dev              # 4. the student app, on :5173
```

Steps 2 and 3 need `apps/agent/.env` — copy `apps/agent/.env.example` and paste
the three `LIVEKIT_` values that step 1 prints.

## Ports

| Port | Proto | What | Who uses it |
|---|---|---|---|
| 7880 | TCP | HTTP + signalling WebSocket | the browser **and** the agent worker |
| 7881 | TCP | ICE/TCP | fallback for networks that block UDP |
| 7882 | UDP | media — all of it, one mux port | the browser and the tutor's voice |

The agent worker needs no port of its own: it is just another client of 7880.

Media on **one** UDP port is a choice this repo's config makes. Without it,
LiveKit opens **50000-60000** — 10,001 UDP ports, one miserable firewall rule
and a slow ICE gather. `--dev` does the same collapse implicitly; pinning
`rtc.udp_port` in the config means the server behaves identically either way.

Use `ws://127.0.0.1:7880`, never `ws://localhost:7880`. Windows resolves
`localhost` to `::1` first, and any bind that ends up IPv4-only then fails in
the browser with an opaque error while `curl http://127.0.0.1:7880` succeeds.

## Options

```
npm run livekit:server -- [options]

  (none)            run livekit.yaml from this folder
  --dev             ignore config files entirely: plain `livekit-server --dev`
  --config <path>   run a different config
  --version <tag>   a different release, e.g. v1.13.4 (default v1.13.5)
  --force           re-download this version even if it is already unpacked
  --download-only   download, verify and unpack; start nothing
```

`--version` is pinned, not `latest`, on purpose: the asset filename embeds the
version, and a server that moves under a new developer is the opposite of a
repeatable first day.

## Keys

`livekit.yaml` is committed, so it carries **no keys** and must stay that way.
With no keys in the file, this tool adds `--dev` and the server injects its own
well-known development pair — `devkey` / `secret`. Those are in LiveKit's source
code. They are fine for a laptop and wrong for anything a student touches.

For real credentials, generate a pair and keep it out of git:

```bash
tools/livekit/bin/v1.13.5/livekit-server generate-keys
```

then either set `LIVEKIT_KEYS="APIxxxxxxxx: <43-char-secret>"` in the
environment (nothing to commit) or point `key_file:` at a gitignored file. Once
either exists, this tool stops adding `--dev`. A secret shorter than 32
characters does **not** stop the server — it logs an error and scrolls past — so
use `generate-keys` rather than typing one.

The API secret never reaches the browser either way: `apps/agent`'s token server
mints the join tokens. That is a property of minting tokens server-side, not of
self-hosting.

## When Windows Defender blocks the media (the silent one)

First run pops a Windows Defender Firewall dialog for `livekit-server.exe`. That
is expected, not a hang. Tick **Private networks**; leave **Public networks**
unticked.

Why this is worth a section: `bind_addresses` in the config controls only the TCP
signalling listener. The media sockets bind to every interface no matter what, so
the dialog appears even for a loopback-only server. And if it is dismissed,
Windows writes a **block** rule and never asks again. The failure mode after that
is not an error — signalling connects, the room joins, the tutor appears in the
participant list, and **no audio ever arrives**. It reads exactly like an app bug.

Check for a bad rule before you go debugging the app:

```powershell
Get-NetFirewallRule -DisplayName '*livekit*' | Format-Table DisplayName,Direction,Action
```

If there is a `Block` rule, **delete it** (`Remove-NetFirewallRule`) and restart
the server so the prompt comes back. Adding an Allow rule on top does not help:
block wins.

## Other things that look like bugs and are not

- **`Only one usage of each socket address ... permitted`** on startup — another
  `livekit-server` is already running and holding 7882. `Get-Process
  livekit-server` finds it. This is the common one when two terminals get away
  from you.
- **`ERROR ... CPU monitoring unsupported on current platform`** with a Go stack
  trace, every boot on Windows. Harmless: it disables capacity management, which
  matters on a cluster and not on a laptop.
- **`ports --dev` prints `%!s(int=7882)`** instead of `7882`. A cosmetic Go
  format-verb bug in 1.13.5. The port really is 7882.
- **A typo in the YAML aborts startup** rather than being ignored — config
  parsing is strict. Suspect a stray key before you suspect a bug.
- **Unpacking by hand in Git Bash fails** with `Cannot connect to C: resolve
  failed`. That is Git's GNU tar reading a drive letter as an SSH host, and it
  cannot read a zip anyway. This tool calls the bsdtar in the System32 folder by
  absolute path for exactly that reason; by hand, use `Expand-Archive`.
- **macOS has no binary in the release.** LiveKit ships mac through Homebrew:
  `brew install livekit`, then run it yourself with
  `livekit-server --config tools/livekit/livekit.yaml --dev`.

## Self-host or LiveKit Cloud?

The client code is byte-identical either way — same `AccessToken`, same
`room.connect`, same agent worker. Only `LIVEKIT_URL` and the two keys change.
So this is a `.env` decision, not an architecture decision, and it does not have
to be made now.

**Self-hosting is genuinely easy for local development** and buys two real
things: unmetered iteration (replay the same doubt-handoff two hundred times
without burning agent minutes) and demos that work with the Wi-Fi off.

**Production self-hosting is the part people underestimate.** The moment a
student is not on your LAN you need a public IP, TLS in front of 7880, a TURN
server on 443 for students behind school and corporate firewalls (LiveKit's
embedded TURN needs real certificates), and Redis as soon as there is more than
one node. Cloud does all of that.

Cloud's free "Build" tier, for a solo founder deciding what it actually covers —
these are **hard caps**: requests fail when you cross them, and they reset on the
1st with no rollover.

| Allowance | Free tier |
|---|---|
| **Agent session minutes** | **1,000 / month** — about 16 hours of live tutoring, total, across all students |
| **Concurrent agent sessions** | **5** (with 1 deployed agent) |
| WebRTC participant minutes | 5,000 / month |
| Concurrent connections | 100 |
| Downstream bandwidth | 50 GB |
| Inference credit | $2.50 (about 50 minutes) |
| Transcode minutes | 60 |

Do not read the 100 concurrent connections as your ceiling. For a voice tutor the
binding constraints are the two in bold: **five simultaneous students in a live
doubt, and sixteen hours of live tutoring a month.** Watching the recording costs
neither — only raised hands do.

The shape that fits this product: **self-host locally for development, Cloud for
anything a real student touches.**

## What is in here

| File | What |
|---|---|
| `src/cli.ts` | flags and wiring, nothing else |
| `src/release.ts` | pure: platform to asset name, tag to URL, checksum parsing, unpack command |
| `src/install.ts` | download, verify, unpack; network and unpacker both injected |
| `src/config.ts` | pure: reads keys and ports out of a config file's text |
| `src/server.ts` | pure: which flags the server gets, and the banner; plus the spawn |
| `livekit.yaml` | the config that ships — commented for someone editing it at 2am |

Tests cover the platform mapping for every platform the release carries, the tag
to URL construction, the already-downloaded skip, checksum verification and
mismatch, and the `--dev`-injection decision. No test touches the network.
