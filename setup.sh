#!/usr/bin/env bash
# setup.sh - One-click installer for Claude Terminal Title
# Installs: VS Code extension, ctt CLI command, Claude Code rule + hook
#
# Usage: bash setup.sh
# Uninstall: bash setup.sh --uninstall

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSIX_FILE="${SCRIPT_DIR}/claude-terminal-title.vsix"
CTT_BIN="${SCRIPT_DIR}/bin/ctt"
RULE_FILE="${SCRIPT_DIR}/skill/terminal-title.md"
INSTALL_BIN="/usr/local/bin/ctt"
CLAUDE_RULES_DIR="${HOME}/.claude/rules"
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"

# --- Uninstall ---
if [[ "${1:-}" == "--uninstall" ]]; then
  echo -e "${BOLD}Uninstalling Claude Terminal Title...${NC}"
  echo ""

  # Remove CLI
  if [[ -f "$INSTALL_BIN" ]]; then
    sudo rm -f "$INSTALL_BIN"
    success "Removed ctt from $INSTALL_BIN"
  fi

  # Remove rule
  if [[ -f "${CLAUDE_RULES_DIR}/terminal-title.md" ]]; then
    rm -f "${CLAUDE_RULES_DIR}/terminal-title.md"
    success "Removed Claude rule"
  fi

  # Uninstall extension from editors
  for editor_cmd in code cursor codium; do
    if command -v "$editor_cmd" &>/dev/null; then
      "$editor_cmd" --uninstall-extension srcnexus.claude-terminal-title 2>/dev/null && \
        success "Uninstalled extension from $editor_cmd" || true
    fi
  done

  # Remove hook from settings
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Simple removal - user may need to clean up manually
    warn "Check ${CLAUDE_SETTINGS} and remove the SessionStart hook for ctt if present."
  fi

  echo ""
  success "Uninstall complete!"
  exit 0
fi

# --- Install ---
echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  Claude Terminal Title - Setup${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# Step 1: Check prerequisites
info "Checking prerequisites..."

if ! command -v npm &>/dev/null; then
  error "npm is required but not installed. Install Node.js first."
  exit 1
fi

# Step 2: Build extension if .vsix doesn't exist
if [[ ! -f "$VSIX_FILE" ]]; then
  info "Building VS Code extension..."
  cd "${SCRIPT_DIR}/extension"
  npm install --silent 2>/dev/null
  npm run compile 2>/dev/null
  npm run package 2>/dev/null

  # Move .vsix to project root
  mv ./*.vsix "$VSIX_FILE" 2>/dev/null || true
  cd "$SCRIPT_DIR"

  if [[ -f "$VSIX_FILE" ]]; then
    success "Extension built: $(basename "$VSIX_FILE")"
  else
    error "Failed to build extension"
    exit 1
  fi
else
  success "Extension already built: $(basename "$VSIX_FILE")"
fi

# Step 3: Install extension in detected editors
echo ""
info "Detecting editors..."

INSTALLED_EDITORS=()

for editor_cmd in code cursor codium; do
  if command -v "$editor_cmd" &>/dev/null; then
    info "Installing extension in ${editor_cmd}..."
    if "$editor_cmd" --install-extension "$VSIX_FILE" --force 2>/dev/null; then
      INSTALLED_EDITORS+=("$editor_cmd")
      success "Installed in ${editor_cmd}"
    else
      warn "Failed to install in ${editor_cmd}"
    fi
  fi
done

if [[ ${#INSTALLED_EDITORS[@]} -eq 0 ]]; then
  warn "No VS Code-based editors found (code, cursor, codium). Extension not installed."
  warn "You can manually install later: <editor> --install-extension ${VSIX_FILE}"
fi

# Step 4: Install CLI command
echo ""
info "Installing ctt command..."

if [[ -d "/usr/local/bin" ]]; then
  if [[ -w "/usr/local/bin" ]]; then
    cp "$CTT_BIN" "$INSTALL_BIN"
    chmod +x "$INSTALL_BIN"
  else
    info "Requires sudo to install to /usr/local/bin"
    sudo cp "$CTT_BIN" "$INSTALL_BIN"
    sudo chmod +x "$INSTALL_BIN"
  fi
  success "Installed ctt to ${INSTALL_BIN}"
else
  # Fallback: install to ~/.local/bin
  mkdir -p "${HOME}/.local/bin"
  cp "$CTT_BIN" "${HOME}/.local/bin/ctt"
  chmod +x "${HOME}/.local/bin/ctt"
  INSTALL_BIN="${HOME}/.local/bin/ctt"
  success "Installed ctt to ${INSTALL_BIN}"
  warn "Make sure ${HOME}/.local/bin is in your PATH"
fi

# Step 5: Install Claude Code rule
echo ""
info "Installing Claude Code rule..."

mkdir -p "$CLAUDE_RULES_DIR"
cp "$RULE_FILE" "${CLAUDE_RULES_DIR}/terminal-title.md"
success "Installed rule to ${CLAUDE_RULES_DIR}/terminal-title.md"

# Step 6: Add SessionStart hook to Claude settings
echo ""
info "Configuring Claude Code hook..."

mkdir -p "$(dirname "$CLAUDE_SETTINGS")"

CTT_HOOK_ENTRY='{"hooks":[{"type":"command","command":"ctt '\''Claude: Ready'\''"}]}'

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  # Create new settings file with the hook
  cat > "$CLAUDE_SETTINGS" <<'SETTINGS'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ctt 'Claude: Ready'"
          }
        ]
      }
    ]
  }
}
SETTINGS
  success "Created Claude settings with SessionStart hook"
elif grep -q "ctt" "$CLAUDE_SETTINGS" 2>/dev/null; then
  success "SessionStart hook already configured"
elif command -v jq &>/dev/null; then
  # Use jq to safely merge the hook into existing settings
  TEMP_SETTINGS=$(mktemp)
  jq '
    .hooks //= {} |
    .hooks.SessionStart //= [] |
    .hooks.SessionStart += [{"hooks":[{"type":"command","command":"ctt '\''Claude: Ready'\''"}]}]
  ' "$CLAUDE_SETTINGS" > "$TEMP_SETTINGS" && mv "$TEMP_SETTINGS" "$CLAUDE_SETTINGS"
  success "Added SessionStart hook to existing Claude settings"
elif command -v python3 &>/dev/null; then
  # Fallback: use python3 to merge JSON
  python3 -c "
import json
with open('$CLAUDE_SETTINGS', 'r') as f:
    settings = json.load(f)
hook_entry = {'hooks': [{'type': 'command', 'command': \"ctt 'Claude: Ready'\"}]}
settings.setdefault('hooks', {})
settings['hooks'].setdefault('SessionStart', [])
settings['hooks']['SessionStart'].append(hook_entry)
with open('$CLAUDE_SETTINGS', 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
"
  success "Added SessionStart hook to existing Claude settings"
else
  warn "Neither jq nor python3 found. Add this to ${CLAUDE_SETTINGS} manually:"
  echo ''
  echo '  "hooks": {'
  echo '    "SessionStart": [{ "hooks": [{ "type": "command", "command": "ctt '\''Claude: Ready'\''" }] }]'
  echo '  }'
fi

# --- Summary ---
echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  Setup Complete!${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} CLI command:  ${INSTALL_BIN}"
echo -e "  ${GREEN}✓${NC} Claude rule:  ${CLAUDE_RULES_DIR}/terminal-title.md"

if [[ ${#INSTALLED_EDITORS[@]} -gt 0 ]]; then
  for editor in "${INSTALLED_EDITORS[@]}"; do
    echo -e "  ${GREEN}✓${NC} Extension:    ${editor}"
  done
fi

echo ""
echo -e "${BOLD}Usage:${NC}"
echo "  ctt \"My Task: Planning\"     # Set terminal title"
echo "  ctt --status                # Check if extension is running"
echo "  ctt --help                  # Show help"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "  1. Reload your editor window (Cmd+Shift+P → Reload Window)"
echo "  2. Start a Claude Code session — the title will update automatically"
echo ""
echo -e "  To uninstall: ${YELLOW}bash setup.sh --uninstall${NC}"
echo ""
