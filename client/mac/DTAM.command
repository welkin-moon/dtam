#!/usr/bin/env bash
# ==============================================================================
# DTAM (Among Us 东滩版) - macOS Terminal Launcher (.command)
# Instant-Launch Zero-Signature Client
#
# Usage:
#   1. Double-click DTAM.command in Finder
#   2. In Terminal: ./DTAM.command [room_code | url]
#      e.g.: ./DTAM.command 45
# ==============================================================================

set -o pipefail

# Switch to the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DEFAULT_URL="https://d1.lunarlab.uk/"
TARGET_URL="$DEFAULT_URL"
ROOM_CODE=""

# Parse argument ($1)
RAW_ARG="$1"

if [[ -n "$RAW_ARG" ]]; then
    CLEAN_ARG=$(echo "$RAW_ARG" | tr -d '"\r\n\\' | tr -d '[:cntrl:]')
    
    # 2-digit room code (e.g. 45)
    if [[ "$CLEAN_ARG" =~ ^[0-9]{2}$ ]]; then
        ROOM_CODE="$CLEAN_ARG"
        TARGET_URL="${DEFAULT_URL}?room=${ROOM_CODE}"
    # Deep link scheme dtam://join?room=45 or dtam://join/45
    elif [[ "$CLEAN_ARG" =~ ^dtam://join.*room=([0-9]{2}) ]]; then
        ROOM_CODE="${BASH_REMATCH[1]}"
        TARGET_URL="${DEFAULT_URL}?room=${ROOM_CODE}"
    elif [[ "$CLEAN_ARG" =~ ^dtam://join/([0-9]{2}) ]]; then
        ROOM_CODE="${BASH_REMATCH[1]}"
        TARGET_URL="${DEFAULT_URL}?room=${ROOM_CODE}"
    # HTTPS URL
    elif [[ "$CLEAN_ARG" =~ ^https://(d1\.lunarlab\.uk|.*\.dtam\.pages\.dev)(/.*)?$ ]]; then
        TARGET_URL="$CLEAN_ARG"
        if [[ "$CLEAN_ARG" =~ [?&]room=([0-9]{2}) ]]; then
            ROOM_CODE="${BASH_REMATCH[1]}"
        fi
    fi
fi

# Visual Banner
echo "================================================================="
echo "        DTAM · Among Us 东滩版 (macOS 免证书独立客户端)         "
echo "================================================================="
if [[ -n "$ROOM_CODE" ]]; then
    echo "  >> 目标房间号 : [ $ROOM_CODE ]"
fi
echo "  >> 启动目标   : $TARGET_URL"

# Detect best available browser
BROWSER_NAME=""
BROWSER_BIN=""

CANDIDATES=(
    "Microsoft Edge|/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "Microsoft Edge|$HOME/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "Google Chrome|/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "Google Chrome|$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "Brave Browser|/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    "Brave Browser|$HOME/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    "Chromium|/Applications/Chromium.app/Contents/MacOS/Chromium"
    "Chromium|$HOME/Applications/Chromium.app/Contents/MacOS/Chromium"
)

for item in "${CANDIDATES[@]}"; do
    NAME="${item%%|*}"
    BIN="${item##*|}"
    if [[ -x "$BIN" ]]; then
        BROWSER_NAME="$NAME"
        BROWSER_BIN="$BIN"
        break
    fi
done

# Launching
if [[ -n "$BROWSER_BIN" ]]; then
    echo "  >> 容器引擎   : $BROWSER_NAME (独立 App 模式，极速硬件加速)"
    echo "================================================================="
    echo "正在启动独立窗口..."
    nohup "$BROWSER_BIN" \
        --app="$TARGET_URL" \
        --start-maximized \
        --no-first-run \
        --no-default-browser-check \
        --autoplay-policy=no-user-gesture-required >/dev/null 2>&1 &
    PID=$!
    disown "$PID" 2>/dev/null || true
    echo "✓ DTAM 已成功启动！"
elif [[ -d "/Applications/Safari.app" || -d "/System/Cryptexes/OS/System/Applications/Safari.app" ]]; then
    echo "  >> 容器引擎   : Apple Safari"
    echo "================================================================="
    echo "正在以 Safari 启动..."
    open -a Safari "$TARGET_URL"
    echo "✓ DTAM 已成功在 Safari 中开启！"
else
    echo "  >> 容器引擎   : 系统默认浏览器"
    echo "================================================================="
    open "$TARGET_URL"
    echo "✓ DTAM 已启动！"
fi

# Clean exit for Finder double-clicks
if [[ -n "$TERM_PROGRAM" && "$TERM_PROGRAM" == "Apple_Terminal" && -z "$1" ]]; then
    echo ""
    echo "本终端窗口将在 2 秒后自动退出..."
    sleep 2
    # Gracefully close terminal window if AppleScript is permitted
    osascript -e 'tell application "Terminal" to close (every window whose name contains "DTAM")' 2>/dev/null || exit 0
fi

exit 0
