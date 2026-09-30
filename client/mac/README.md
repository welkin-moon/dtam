# DTAM macOS 客户端 (免证书 / 免 Apple 开发者账号版)

适用于 macOS (10.15 Catalina ~ macOS 14/15 Sonoma/Sequoia) 的免证书、即开即用独立客户端。

---

## 目录
- [设计理念与免证书说明](#设计理念与免证书说明)
- [双模运行方式](#双模运行方式)
  - [方式 A：DTAM.command (原生终端双击启动器)](#方式-adtamcommand-原生终端双击启动器)
  - [方式 B：DTAM.app (标准免公证 App 模式)](#方式-bdtamapp-标准免公证-app-模式)
- [Gatekeeper 安全拦截豁免指南 (即开即用三重保障)](#gatekeeper-安全拦截豁免指南-即开即用三重保障)
- [带房间号快速加入与 Deep Link](#带房间号快速加入与-deep-link)
- [Safari / WebKit 浏览器兼容性说明](#safari--webkit-浏览器兼容性说明)
- [自动化构建与打包](#自动化构建与打包)

---

## 设计理念与免证书说明

> [!NOTE]
> **无需付费 Apple 开发者订阅（每年 $99 / 688 元）**  
> DTAM 坚持开放轻量的工程原则：游戏核心运行在安全隔离的 Web 容器与云端权威架构（`https://d1.lunarlab.uk/`）之上，无需编译笨重、易受苹果 notarization 阻断的专有二进制，用户在任何 Mac 设备上均可零成本免签名运行。

- **独立 App 沉浸体验**：自动探测 Edge / Chrome / Brave，以 `--app` 模式启动纯净无地址栏、无标签页的独立游戏窗口，配备 Dock 独立图标与高分辨率专属应用图标。
- **免二次打包更新**：游戏内容跟随 `d1.lunarlab.uk` 自动云端实时升级，客户端外壳永远保持极简与长效可用。
- **零依赖环境**：不强制依赖 Node、Electron 或额外运行时，开箱即用。

---

## 双模运行方式

DTAM 为 macOS 提供了两种形态，满足不同用户习惯：

### 方式 A：`DTAM.command` (原生终端双击启动器)

- **适用场景**：下载即玩，无需移动到 Applications 目录。
- **运行方法**：
  1. 在 Finder 中直接**双击 `DTAM.command`**；
  2. 脚本会自动检测系统最佳浏览器（Edge > Chrome > Brave > Chromium > Safari），拉起独立游戏窗口；
  3. 后台进程独立运行，启动完成后终端窗口自动退出。

### 方式 B：`DTAM.app` (标准免公证 App 模式)

- **适用场景**：希望作为正式应用常驻系统 Dock 栏或 `/Applications`。
- **结构**：
  ```text
  DTAM.app/
  └── Contents/
      ├── Info.plist              # Bundle 元数据、URL Scheme (dtam://) 与麦克风权限描述
      ├── PkgInfo                 # APPL????
      ├── MacOS/
      │   └── DTAM                # 独立启动执行体 (自动过滤 -psn，拉起应用模式)
      └── Resources/
          ├── AppIcon.icns        # 高分辨率应用图标 (支持 Retina 512@2x)
          └── icon.png
  ```
- **运行方法**：直接双击 `DTAM.app` 或将其拖入 `/Applications`。

---

## Gatekeeper 安全拦截豁免指南 (即开即用三重保障)

由于未加入 Apple 付费开发者计划，macOS Gatekeeper 安全机制会对从网络下载的未公证（unnotarized）文件附加 `com.apple.quarantine` 隔离标记。遇到“无法打开”或“无法验证开发者”时，可通过以下三种任意一种方式秒级解开：

### 选项 1：右键“打开”（最简单，图形化操作，推荐 ⭐⭐⭐⭐⭐）
1. 在 Finder 中按住 `Control` 键并右键点击 `DTAM.app`（或 `DTAM.command`）。
2. 在弹出菜单中选择 **“打开” (Open)**。
3. 弹出确认框后，点击 **“打开” (Open)** 按钮。
4. *只需首次运行操作一次，之后双击即可直接秒开。*

### 选项 2：终端一键清除隔离标记（极客推荐 ⭐⭐⭐⭐⭐）
打开 macOS 终端，执行以下一行命令即可永久解除 Gatekeeper 拦截：
```bash
# 解除 DTAM.app 隔离
xattr -cr /Applications/DTAM.app

# 若在项目目录中运行：
xattr -cr client/mac/DTAM.app client/mac/DTAM.command
```

### 选项 3：系统设置安全性放行（系统级面板 ⭐⭐⭐⭐）
1. 打开 macOS **“系统设置” (System Settings)** -> **“隐私与安全性” (Privacy & Security)**。
2. 向下滚动至 **“安全性” (Security)** 区域。
3. 会看到提示：*“已阻止使用 DTAM，因为来自身份不明的开发者”*。
4. 点击右侧的 **“仍要打开” (Open Anyway)** 并输入开机密码即可。

> [!TIP]
> **可执行权限修复**：若从 Zip 解压后双击提示权限不足，在终端运行一次赋予可执行权限：
> ```bash
> chmod +x client/mac/DTAM.command client/mac/DTAM.app/Contents/MacOS/DTAM
> ```

---

## 带房间号快速加入与 Deep Link

### 1. 终端命令行带房号启动
```bash
# 启动并直接加入 45 号房间
./DTAM.command 45

# 或通过 open 打开 App Bundle
open client/mac/DTAM.app --args 45
```

### 2. 系统 Deep Link (dtam://)
应用已注册 `dtam://` 协议，可在聊天软件、浏览器或终端直接唤起：
```bash
open "dtam://join?room=45"
```

---

## Safari / WebKit 浏览器兼容性说明

DTAM 针对 macOS Safari / WebKit 引擎进行了专项兼容性加固：

1. **WebRTC 音频与对讲**：
   - Safari 要求在用户手势下激活音频与麦克风。DTAM 内置自动捕获与“解锁音频”机制，当 AirPods 或外接音频设备插拔导致音频上下文（`AudioContext`）被挂起（`interrupted`）时，下一次用户点击或按键将自动恢复音频通道。
2. **WebKit 全屏支持**：
   - 适配了 WebKit 前缀全屏 API（`webkitRequestFullscreen` / `webkitExitFullscreen`）。
   - 支持快捷键 `F11` 以及 macOS 习惯的 `Ctrl + Cmd + F` 切换全屏，并在右上角更多菜单中提供了全屏切换按钮。
3. **快捷键与防滚动穿透**：
   - 游戏移动按键（WASD / 方向键 / 空格）阻止 Safari 默认页面滚动与橡皮筋反弹，同时保留 Mac 原生快捷键（如 `Cmd + Q` 退出、`Cmd + W` 关窗、`Cmd + M` 最小化）。

---

## 自动化构建与打包

在 macOS 上一键检查权限、清理隔离标记并打包发布压缩包：

```bash
# 在项目根目录或 client/mac 下执行：
./client/mac/build-mac.sh
```

生成的发布包位于 `dist/DTAM-macOS-v3.0.2.zip`，可直接分发给所有 Mac 用户免证书解压运行。
