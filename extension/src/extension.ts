import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import { execSync } from "child_process";

let server: http.Server | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

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
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              version: "3.0.0",
              terminals: terminalInfo,
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
            await setTitleViaTty(terminal, title);
          }
        }
      }
    )
  );

  // Reset title command
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTerminalTitle.resetTitle", () => {
      if (statusBarItem) {
        statusBarItem.text = "$(terminal) CTT";
        statusBarItem.tooltip = "Claude Terminal Title: Active";
      }
      vscode.window.showInformationMessage("Terminal titles cleared.");
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

// Set terminal.integrated.tabs.title to include ${sequence} if not already
function ensureTabTitleSetting() {
  const termConfig = vscode.workspace.getConfiguration("terminal.integrated.tabs");
  const currentTitle = termConfig.get<string>("title", "${process}");

  if (!currentTitle.includes("${sequence}")) {
    // Set to: show sequence (our title) if set, otherwise show process name
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

  // Resolve all terminal PIDs
  const terminalEntries = await Promise.all(
    terminals.map(async (t) => ({
      terminal: t,
      pid: await t.processId,
    }))
  );

  // Find which terminal this request belongs to via ancestor PID matching
  const pidSet = new Set(ancestorPids);
  let targetTerminal: vscode.Terminal | undefined;
  let matchedPid: number | undefined;

  for (const entry of terminalEntries) {
    if (entry.pid !== undefined && pidSet.has(entry.pid)) {
      targetTerminal = entry.terminal;
      matchedPid = entry.pid;
      break;
    }
  }

  // If no PID match and only one terminal, use it
  if (!targetTerminal && terminals.length === 1) {
    targetTerminal = terminals[0];
    matchedPid = terminalEntries[0]?.pid;
  }

  // If still no match, use active terminal
  if (!targetTerminal) {
    targetTerminal = vscode.window.activeTerminal;
    if (targetTerminal) {
      matchedPid = await targetTerminal.processId;
    }
  }

  if (!targetTerminal) {
    return { method: "no-terminal" };
  }

  // Write escape sequence directly to the terminal's TTY device
  const tty = await setTitleViaTty(targetTerminal, title);

  if (tty) {
    return { method: "tty-direct", matchedPid, tty };
  }

  // Fallback: use renameWithArg (only works on active terminal)
  if (targetTerminal === vscode.window.activeTerminal) {
    try {
      await vscode.commands.executeCommand(
        "workbench.action.terminal.renameWithArg",
        { name: title }
      );
      return { method: "rename-command", matchedPid };
    } catch {
      // ignore
    }
  }

  return { method: "failed", matchedPid };
}

// Get the TTY device path for a terminal
async function getTtyDevice(
  terminal: vscode.Terminal
): Promise<string | null> {
  const pid = await terminal.processId;
  if (pid === undefined) {
    return null;
  }

  try {
    // Get the TTY device from the process
    const ttyRaw = execSync(`ps -o tty= -p ${pid}`, {
      encoding: "utf8",
      timeout: 2000,
    }).trim();

    if (!ttyRaw || ttyRaw === "??" || ttyRaw === "-") {
      return null;
    }

    // Build the full device path
    // macOS: ps returns "ttys065" → /dev/ttys065
    // Linux: ps returns "pts/0" → /dev/pts/0
    let devicePath: string;
    if (ttyRaw.startsWith("/dev/")) {
      devicePath = ttyRaw;
    } else if (ttyRaw.startsWith("pts/") || ttyRaw.startsWith("tty")) {
      devicePath = `/dev/${ttyRaw}`;
    } else {
      devicePath = `/dev/${ttyRaw}`;
    }

    if (fs.existsSync(devicePath)) {
      return devicePath;
    }

    return null;
  } catch {
    return null;
  }
}

// Write OSC escape sequence directly to the terminal's TTY device
// This sets the title without switching terminals — no flicker
async function setTitleViaTty(
  terminal: vscode.Terminal,
  title: string
): Promise<string | null> {
  const devicePath = await getTtyDevice(terminal);
  if (!devicePath) {
    return null;
  }

  try {
    // Write OSC 0 (Set Window Title) escape sequence
    // \x1b]0;title\x07
    const escapeSequence = `\x1b]0;${title}\x07`;
    fs.writeFileSync(devicePath, escapeSequence, { encoding: "utf8" });
    return devicePath;
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
  if (server) {
    server.close();
    server = undefined;
  }
}
