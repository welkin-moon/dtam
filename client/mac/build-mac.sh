#!/usr/bin/env bash
# ==============================================================================
# DTAM (Among Us 东滩版) - macOS Client Build & Packaging Script
# Assembles and packages zero-signature DTAM.app and DTAM.command for macOS
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="3.0.2"
DIST_DIR="$ROOT_DIR/dist"

echo "================================================================="
echo "       DTAM macOS Client 打包与环境就绪检查 (v${VERSION})        "
echo "================================================================="

cd "$SCRIPT_DIR"

# 1. Ensure executable permissions
echo "[1/4] 修复并确保可执行脚本权限..."
chmod +x "$SCRIPT_DIR/DTAM.command"
chmod +x "$SCRIPT_DIR/DTAM.app/Contents/MacOS/DTAM"
echo "✓ 权限已配置 (chmod +x 完成)"

# 2. Gatekeeper quarantine removal (if on macOS)
echo "[2/4] 清除本地 Gatekeeper 隔离标识 (xattr -cr)..."
if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$SCRIPT_DIR/DTAM.app" || true
    xattr -cr "$SCRIPT_DIR/DTAM.command" || true
    echo "✓ 已成功清除隔离属性"
else
    echo "- 当前非 macOS 环境，跳过 xattr 清理"
fi

# 3. Verify bundle structure
echo "[3/4] 校验 DTAM.app Bundle 完整性..."
REQUIRED_FILES=(
    "DTAM.app/Contents/Info.plist"
    "DTAM.app/Contents/PkgInfo"
    "DTAM.app/Contents/MacOS/DTAM"
    "DTAM.app/Contents/Resources/AppIcon.icns"
    "DTAM.command"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
        echo "❌ 缺少关键文件: $file"
        exit 1
    fi
    echo "  ✓ 存在: $file"
done

# 4. Packaging distribution ZIP
echo "[4/4] 打包发布产物 (DTAM-macOS-v${VERSION}.zip)..."
mkdir -p "$DIST_DIR"
ZIP_TARGET="$DIST_DIR/DTAM-macOS-v${VERSION}.zip"
rm -f "$ZIP_TARGET"

if command -v zip >/dev/null 2>&1; then
    # -y preserves symlinks, -r recursive
    zip -qry "$ZIP_TARGET" DTAM.app DTAM.command README.md
    echo "✓ 已生成发布包: $ZIP_TARGET ($(du -h "$ZIP_TARGET" | cut -f1))"
else
    echo "⚠ 系统未找到 zip 命令，请在 macOS 环境或通过构建流水线打包。"
fi

echo ""
echo "================================================================="
echo "🎉 macOS 免证书客户端构建就绪！"
echo "  - 原生终端启动器 : client/mac/DTAM.command"
echo "  - 独立 App 模式  : client/mac/DTAM.app"
echo "  - 运行方式       : 直接双击打开即可，无需 Apple 开发者账号与证书"
echo "================================================================="
