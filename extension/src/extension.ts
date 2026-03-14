import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import { execSync } from "child_process";

let server: http.Server | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

// Active titles: TTY device path → { title, intervalId }
// We periodically re-write the escape sequence to override Claude Code's own title
const activeTitles = new Map<
  string,
  { title: string; interval: ReturnType<typeof setInterval> }
>();

// Cache: terminal PID → TTY device path
const ttyCache = new Map<number, string>();

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("claudeTerminalTitle");
  const enabled = config.get<boolean>("enabled", true);

  if (!enabled) {
    return;
  }

  const port = config.get<number>("port", 7890);

  // Ensure terminal.integrated.tabs.title includes ${sequence}
  ensureTabTitleSetting();

  // Status bar indicator
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0
  );
  statusBarItem.text = "$(terminal) CTT";
  statusBarItem.tooltip = "Claude Terminal Title: Active";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Clean up intervals when terminals close
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(async (terminal) => {
      const pid = await terminal.processId;
      if (pid !== undefined) {
        const tty = ttyCache.get(pid);
        if (tty) {
          stopTitleLoop(tty);
          ttyCache.delete(pid);
        }
      }
    })
  );

  // HTTP server
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/title") {
        let body = "";
        req.on("data", (chunk: string | Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              title?: string;
              ancestorPids?: number[];
            };
            const title = data.title;
            const ancestorPids = data.ancestorPids ?? [];

            if (typeof title !== "string" || title.length === 0) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "title is required" }));
              return;
            }

            handleTitleRequest(title, ancestorPids).then((result) => {
              if (statusBarItem) {
                statusBarItem.text = `$(terminal) ${truncate(title, 30)}`;
                statusBarItem.tooltip = `Claude Terminal Title: ${title}`;
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, title, ...result }));
            });
          } catch (_err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid JSON" }));
          }
        });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        const terminals = vscode.window.terminals;
        Promise.all(
          terminals.map(async (t) => ({
            name: t.name,
            pid: await t.processId,
            tty: await getTtyDevice(t),
          }))
        ).then((terminalInfo) => {
          const activeLoops = Array.from(activeTitles.entries()).map(
            ([tty, entry]) => ({ tty, title: entry.title })
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              version: "4.0.0",
              terminals: terminalInfo,
              activeLoops,
            })
          );
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  );

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      vscode.window.showWarningMessage(
        `Claude Terminal Title: Port ${port} is already in use. Another instance may be running.`
      );
    } else {
      vscode.window.showErrorMessage(
        `Claude Terminal Title: Server error: ${err.message}`
      );
    }
  });

  server.listen(port, "127.0.0.1", () => {
    // Server started
  });

  context.subscriptions.push({
    dispose: () => {
      // Stop all title loops
      for (const [tty] of activeTitles) {
        stopTitleLoop(tty);
      }
      if (server) {
        server.close();
        server = undefined;
      }
    },
  });

  // Manual set title command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeTerminalTitle.setTitle",
      async () => {
        const title = await vscode.window.showInputBox({
          prompt: "Enter terminal title",
          placeHolder: "e.g., Auth Fix: Planning",
        });
        if (title) {
          const terminal = vscode.window.activeTerminal;
          if (terminal) {
            const tty = await getTtyDevice(terminal);
            if (tty) {
              startTitleLoop(tty, title);
            }
          }
        }
      }
    )
  );

  // Reset title command — stops all loops
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTerminalTitle.resetTitle", () => {
      for (const [tty] of activeTitles) {
        stopTitleLoop(tty);
      }
      if (statusBarItem) {
        statusBarItem.text = "$(terminal) CTT";
        statusBarItem.tooltip = "Claude Terminal Title: Active";
      }
      vscode.window.showInformationMessage("All terminal titles cleared.");
    })
  );

  // Config change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("claudeTerminalTitle")) {
          vscode.window
            .showInformationMessage(
              "Claude Terminal Title: Reload window to apply changes.",
              "Reload"
            )
            .then((selection: string | undefined) => {
              if (selection === "Reload") {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        }
      }
    )
  );
}

function ensureTabTitleSetting() {
  const termConfig = vscode.workspace.getConfiguration(
    "terminal.integrated.tabs"
  );
  const currentTitle = termConfig.get<string>("title", "${process}");

  if (!currentTitle.includes("${sequence}")) {
    termConfig.update(
      "title",
      "${sequence}${separator}${process}",
      vscode.ConfigurationTarget.Global
    );
  }
}

async function handleTitleRequest(
  title: string,
  ancestorPids: number[]
): Promise<{ method: string; matchedPid?: number; tty?: string }> {
  const terminals = vscode.window.terminals;

  // Resolve all terminal PIDs and TTYs
  const terminalEntries = await Promise.all(
    terminals.map(async (t) => ({
      terminal: t,
      pid: await t.processId,
      tty: await getTtyDevice(t),
    }))
  );

  // Find which terminal this request belongs to
  const pidSet = new Set(ancestorPids);
  let matchedEntry: (typeof terminalEntries)[0] | undefined;

  for (const entry of terminalEntries) {
    if (entry.pid !== undefined && pidSet.has(entry.pid)) {
      matchedEntry = entry;
      break;
    }
  }

  // Fallback: single terminal or active terminal
  if (!matchedEntry) {
    if (terminals.length === 1) {
      matchedEntry = terminalEntries[0];
    } else {
      const active = vscode.window.activeTerminal;
      if (active) {
        matchedEntry = terminalEntries.find((e) => e.terminal === active);
      }
    }
  }

  if (!matchedEntry || !matchedEntry.tty) {
    return { method: "no-tty", matchedPid: matchedEntry?.pid };
  }

  // Start (or update) the title loop for this terminal's TTY
  startTitleLoop(matchedEntry.tty, title);

  return {
    method: "tty-loop",
    matchedPid: matchedEntry.pid,
    tty: matchedEntry.tty,
  };
}

// Write the escape sequence once
function writeTitleToTty(ttyPath: string, title: string): boolean {
  try {
    const escapeSequence = `\x1b]0;${title}\x07`;
    fs.writeFileSync(ttyPath, escapeSequence, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

// Start a loop that keeps writing our title every second
// This overrides Claude Code's own title updates
function startTitleLoop(ttyPath: string, title: string) {
  // If already running for this TTY, update the title and keep the loop
  const existing = activeTitles.get(ttyPath);
  if (existing) {
    existing.title = title;
    // Write immediately with new title
    writeTitleToTty(ttyPath, title);
    return;
  }

  // Write immediately
  writeTitleToTty(ttyPath, title);

  // Then keep writing every second to override Claude Code's title
  const interval = setInterval(() => {
    const entry = activeTitles.get(ttyPath);
    if (!entry) {
      return;
    }
    const ok = writeTitleToTty(ttyPath, entry.title);
    if (!ok) {
      // TTY gone (terminal closed) — stop the loop
      stopTitleLoop(ttyPath);
    }
  }, 1000);

  activeTitles.set(ttyPath, { title, interval });
}

// Stop the title loop for a TTY
function stopTitleLoop(ttyPath: string) {
  const entry = activeTitles.get(ttyPath);
  if (entry) {
    clearInterval(entry.interval);
    activeTitles.delete(ttyPath);
  }
}

async function getTtyDevice(
  terminal: vscode.Terminal
): Promise<string | null> {
  const pid = await terminal.processId;
  if (pid === undefined) {
    return null;
  }

  // Check cache first
  const cached = ttyCache.get(pid);
  if (cached) {
    return cached;
  }

  try {
    const ttyRaw = execSync(`ps -o tty= -p ${pid}`, {
      encoding: "utf8",
      timeout: 2000,
    }).trim();

    if (!ttyRaw || ttyRaw === "??" || ttyRaw === "-") {
      return null;
    }

    let devicePath: string;
    if (ttyRaw.startsWith("/dev/")) {
      devicePath = ttyRaw;
    } else {
      devicePath = `/dev/${ttyRaw}`;
    }

    if (fs.existsSync(devicePath)) {
      ttyCache.set(pid, devicePath);
      return devicePath;
    }

    return null;
  } catch {
    return null;
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.substring(0, maxLen - 1) + "\u2026";
}

export function deactivate() {
  for (const [tty] of activeTitles) {
    stopTitleLoop(tty);
  }
  if (server) {
    server.close();
    server = undefined;
  }
}
