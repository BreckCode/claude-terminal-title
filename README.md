# Claude Terminal Title

Automatically updates your terminal tab title based on what Claude Code is doing — so you can see progress at a glance.

![demo](https://img.shields.io/badge/Claude_Code-Terminal_Title-blue?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![platform](https://img.shields.io/badge/platform-macOS%20|%20Linux-lightgrey?style=flat-square)

## The Problem

When you're running multiple Claude Code sessions in different terminals, every tab shows something like `2.1.76` or `claude` — which tells you nothing about what each session is actually working on. You end up clicking through tabs trying to find the right one.

And you can't just change the title yourself — VS Code (and its forks like Cursor, VSCodium) ignores terminal title escape sequences. Claude Code runs commands in a captured subprocess, so even `printf '\033]0;title\007'` doesn't reach the terminal emulator. There's no built-in way to set a meaningful title.

This tool fixes that.

## What It Does

With Claude Terminal Title installed, Claude automatically updates the terminal tab as it works:

```
Auth Fix: Planning  →  Auth Fix: Building  →  Auth Fix: (3/5)  →  Auth Fix: Testing  →  Auth Fix: Done
```

Now when you have 3-4 Claude sessions running, each tab shows exactly what that session is doing. No more guessing — just glance at the tabs.

## How It Works

```
Claude Code  ──ctt command──▶  Local HTTP Server  ──VS Code API──▶  Terminal Tab Renamed
                                 (extension)
```

- **Inside VS Code/Cursor/VSCodium**: The `ctt` command calls the extension's local HTTP server, which renames the terminal via the VS Code API.
- **Normal terminals**: The `ctt` command uses ANSI escape sequences written directly to the parent TTY.

## Quick Setup

```bash
git clone https://github.com/BreckCode/claude-terminal-title.git
cd claude-terminal-title
bash setup.sh
```

That's it. The setup script will:

1. Install the VS Code extension (auto-detects VS Code, Cursor, VSCodium)
2. Install the `ctt` CLI command to `/usr/local/bin/`
3. Install a Claude Code rule so Claude automatically updates the title
4. Configure a `SessionStart` hook for Claude Code

After setup, reload your editor window (`Cmd+Shift+P` → `Reload Window`).

## Manual Usage

```bash
# Set terminal title
ctt "My Task: Planning"

# Check if extension server is running
ctt --status

# Help
ctt --help
```

## Title Format

```
<short-task-name>: <phase-or-progress>
```

| Phase | Example |
|-------|---------|
| Planning | `Auth Fix: Planning` |
| Building | `Auth Fix: Building` |
| Progress | `Auth Fix: (3/10)` |
| Testing | `Auth Fix: Testing` |
| Debugging | `Auth Fix: Debugging` |
| Done | `Auth Fix: Done` |
| Waiting | `Auth Fix: Waiting` |

## Components

### VS Code Extension

A lightweight extension that:
- Starts a local HTTP server on port `7890` (configurable)
- Listens for `POST /title` requests with `{"title": "..."}`
- Renames the terminal running Claude Code
- Shows current title in the status bar

**Settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeTerminalTitle.port` | `7890` | HTTP server port |
| `claudeTerminalTitle.enabled` | `true` | Enable/disable the extension |

**Commands (Cmd+Shift+P):**

- `Claude Terminal Title: Set Title` — manually set a title
- `Claude Terminal Title: Reset Title` — reset to default

### CLI Command (`ctt`)

A shell script that auto-detects your environment:

- **VS Code/Cursor/VSCodium** → calls the extension's HTTP server
- **Terminal.app** → uses AppleScript
- **iTerm2** → uses iTerm2 escape sequences
- **Other terminals** → uses standard ANSI escape sequences via parent TTY

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CTT_PORT` | `7890` | Override the server port |

### Claude Code Rule

Installed to `~/.claude/rules/terminal-title.md`, this rule instructs Claude to:
- Call `ctt` when starting, progressing through, and completing tasks
- Use short, descriptive titles
- Show progress as `(X/Y)` when working through numbered steps

### SessionStart Hook

Added to `~/.claude/settings.json`, sets the title to `Claude: Ready` when a new session starts.

## API

The extension exposes a simple HTTP API on `localhost:7890`:

### Set Title

```bash
curl -X POST http://localhost:7890/title \
  -H "Content-Type: application/json" \
  -d '{"title": "My Task: Building"}'
```

Response: `{"ok": true, "title": "My Task: Building"}`

### Health Check

```bash
curl http://localhost:7890/health
```

Response: `{"status": "ok", "version": "1.0.0", "currentTitle": "My Task: Building"}`

## Supported Editors

| Editor | Supported |
|--------|-----------|
| VS Code | Yes |
| Cursor | Yes |
| VSCodium | Yes |
| Other VS Code forks | Should work (uses standard extension API) |

## Supported Terminals (without extension)

| Terminal | Method |
|----------|--------|
| Terminal.app (macOS) | AppleScript |
| iTerm2 | Proprietary escape sequences |
| Any terminal with TTY access | ANSI escape sequences |

## Uninstall

```bash
bash setup.sh --uninstall
```

## Troubleshooting

**Extension not working after install?**
→ Reload the editor window: `Cmd+Shift+P` → `Reload Window`

**Port already in use?**
→ Change the port in VS Code settings: `claudeTerminalTitle.port`
→ Set `CTT_PORT` environment variable for the CLI

**`ctt` command not found?**
→ Make sure `/usr/local/bin` is in your `PATH`
→ Or run `setup.sh` again

**Title not updating in normal terminal?**
→ Some terminals don't support title changes. Try iTerm2 or Terminal.app on macOS.

## Project Structure

```
claude-terminal-title/
├── extension/                  # VS Code extension source
│   ├── src/extension.ts        # Extension code (HTTP server + rename logic)
│   ├── package.json            # Extension manifest
│   └── tsconfig.json           # TypeScript config
├── bin/
│   └── ctt                     # CLI command (shell script)
├── skill/
│   └── terminal-title.md       # Claude Code rule
├── claude-terminal-title.vsix  # Pre-built extension package
├── setup.sh                    # One-click installer
├── LICENSE                     # MIT
└── README.md                   # This file
```

## License

MIT
