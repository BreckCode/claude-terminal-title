import * as vscode from "vscode";
import * as http from "http";

let server: http.Server | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let currentTitle = "";

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("claudeTerminalTitle");
  const enabled = config.get<boolean>("enabled", true);

  if (!enabled) {
    return;
  }

  const port = config.get<number>("port", 7890);

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
            const data = JSON.parse(body) as { title?: string };
            const title = data.title;

            if (typeof title !== "string" || title.length === 0) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "title is required" }));
              return;
            }

            currentTitle = title;
            setTerminalTitle(title);

            if (statusBarItem) {
              statusBarItem.text = `$(terminal) ${truncate(title, 30)}`;
              statusBarItem.tooltip = `Claude Terminal Title: ${title}`;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, title }));
          } catch (_err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid JSON" }));
          }
        });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            version: "1.0.0",
            currentTitle: currentTitle || null,
          })
        );
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
          value: currentTitle,
        });
        if (title) {
          currentTitle = title;
          setTerminalTitle(title);
        }
      }
    )
  );

  // Reset title command
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTerminalTitle.resetTitle", () => {
      currentTitle = "";
      if (statusBarItem) {
        statusBarItem.text = "$(terminal) CTT";
        statusBarItem.tooltip = "Claude Terminal Title: Active";
      }
      vscode.window.showInformationMessage("Terminal title reset.");
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

function setTerminalTitle(title: string) {
  const terminal = findClaudeTerminal() ?? vscode.window.activeTerminal;
  if (!terminal) {
    return;
  }
  renameTerminal(terminal, title);
}

function findClaudeTerminal(): vscode.Terminal | undefined {
  const terminals = vscode.window.terminals;

  // First pass: look for terminal with Claude-related name
  for (const terminal of terminals) {
    const name = terminal.name.toLowerCase();
    if (name.includes("claude") || name.includes("ctt")) {
      return terminal;
    }
  }

  // Second pass: look for terminal with a previous title set by us
  if (currentTitle) {
    for (const terminal of terminals) {
      if (terminal.name === currentTitle) {
        return terminal;
      }
    }
  }

  // Fall back to active terminal
  return vscode.window.activeTerminal;
}

function renameTerminal(terminal: vscode.Terminal, title: string) {
  // Focus the terminal first (required for rename command)
  terminal.show(false);

  // Use the VS Code rename command with argument
  vscode.commands
    .executeCommand("workbench.action.terminal.renameWithArg", {
      name: title,
    })
    .then(undefined, () => {
      // Fallback for older VS Code versions: send escape sequence
      // Requires terminal.integrated.tabs.title to include ${sequence}
      const escaped = title.replace(/'/g, "'\\''");
      terminal.sendText(`printf '\\033]0;${escaped}\\007'`, true);
    });
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
