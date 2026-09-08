# Among Us · 东滩版

一个面向浏览器与轻量原生壳的实时多人社交推理小游戏。

> 本项目是非官方同人实现，与 Innersloth 无隶属关系；请勿将其误认为官方 Among Us 客户端或服务。

## 在线游玩

正式网页：`https://d1.lunarlab.uk/`

网页是游戏的 canonical client。Windows 与 Android 客户端都复用同一套网页游戏与协议，因此规则、地图和联机修复会随线上前端同步生效。

## 当前版本：v3.0.1

v3 的默认 Auto 联机已经不是早期实验文档中的“浏览器 → Rust Edge → Rust Core”路径。当前首选路径是浏览器房主权威 + WebRTC DataChannel：创建房间的客户端承载权威 `GameRoom`，其他玩家优先与房主建立 WebRTC 数据通道；Cloudflare 负责静态站点、建链信令/doorbell、受限网络下的 TURN，以及原有 Server 路径的兜底能力。

```text
                       Cloudflare Pages
                             |
                 +-----------+-----------+
                 |                       |
                 v                       v
           Browser / APK            Windows client
                 |                       |
                 +-----------+-----------+
                             |
                             v
                    canonical web game
                             |
             create room     |     join room
                 +-----------+-----------+
                 |                       |
                 v                       v
          Browser-host authority <---- WebRTC ----> Guest
                 ^                 control + fast
                 |
       Cloudflare signaling / doorbell
       TURN only when direct ICE cannot work

       Server mode / Auto fallback remains available
       Voice remains on Cloudflare Realtime/Calls
```

联机数据面分为两条 DataChannel：

- `dtam-control`：ordered / reliable，用于任务、击杀、报告、会议、聊天、设置等需要可靠顺序的消息。
- `dtam-fast`：unordered / `maxRetransmits=0` / high priority，用于位置和 RTT 探针。过期位置不会因为重传堵住后续输入。
- Auto 首选浏览器房主 P2P；网络限制时 ICE 可以选中 TURN relay；P2P 建链不可用时仍保留 Server fallback。
- 创建/加入房间使用 Cloudflare 信令。doorbell WebSocket 是即时唤醒路径，D1/HTTP 轮询只作为后备，不参与正常游戏中的高频位置同步。
- 语音仍使用 Cloudflare Realtime/Calls，与游戏 DataChannel 分离。

v3.0.1 进一步把直接链路位置更新目标提升到约 50 Hz，并直接读取 WebRTC selected candidate pair 的 RTT/候选类型来判断真实直连还是 TURN；高 RTT 不再反向降低 direct 位置发送频率。远端角色使用有界速度外推和平滑收敛，避免高 RTT 下既慢半拍又抖动。

Web 主循环也改为每个 equestAnimationFrame 都更新/绘制，不再人为按 72 Hz 门槛跳帧；在 90/120/144 Hz 屏幕上会直接跟随显示刷新率。150×150 静态墙体先缓存到离屏 Canvas，避免高刷模式下每帧重扫碰撞格。

## 地图与碰撞

权威地图协议为 `dtam-map-150-v1`，碰撞、服务端/浏览器权威判定、主场景墙体和完整小地图现在都直接使用同一份 150×150 网络碰撞网格。

旧版曾为了显示把 150×150 地图按中心点降采样成 100×100；一格宽的障碍可能被采样漏掉，于是出现“能撞到、小地图也有，但主画面没画出来”。v3.0.1 删除了这条渲染不一致：主画面直接绘制权威格，小地图 HUD 的静态墙层也缓存到离屏 Canvas，避免每 250 ms 重画 22,500 个格子。

## 可选客户端

### Windows x64

`client/windows/` 是 .NET 8 自包含单文件启动器。它使用 Microsoft Edge app mode 打开 canonical web client；例如：

```text
DTAM.exe 45
```

会直接打开房间 `45`。Windows 客户端本身不伪装成另一套游戏实现，也不声称当前已有 native UDP 加速；WebRTC/Server 路径仍由网页 transport 负责。

v3.0.1 起启动器会在不阻塞游戏启动的前提下检查 `https://update.lunarlab.uk/latest.json`。发现新版本后，从 Cloudflare 下载新的 EXE，校验大小与 SHA-256，通过后在当前进程退出后替换自身。更新服务不可用时直接继续游戏。

### Android

`client/android/` 是无第三方运行时依赖的系统 WebView APK：

- package：`uk.lunarlab.dtam`
- minSdk 26，targetSdk 35
- 仅在 `https://d1.lunarlab.uk` 原点允许 WebRTC 麦克风请求
- 支持网页链接与 `dtam://join?room=45` 深链
- 禁止明文网络、file/content WebView 访问和 mixed content

APK 同样从 `update.lunarlab.uk` 检查新版本，下载后验证 SHA-256，再交给 Android `PackageInstaller`。普通侧载 APK 无权静默安装更新；首次需要允许“安装未知应用”，每次系统认为需要用户确认时也会进入 Android 自己的安装确认界面。

Android 构建不依赖 Android Gradle Plugin：`scripts/build-android.ps1` 直接使用已安装的 `aapt2`、`javac`、`d8`、`zipalign` 与 `apksigner`，并使用项目维护者机器上独立保存、不会进入仓库的发布签名密钥。

## Cloudflare 自更新服务

更新入口：`https://update.lunarlab.uk/latest.json`

客户端只信任 `update.lunarlab.uk` 的 HTTPS 下载地址，并在安装/替换前再次验证清单中的 SHA-256 与文件大小。大文件以固定版本 key 分块保存在 Cloudflare Workers KV，Worker 流式拼接返回；`latest.json` 最后写入，作为原子的“当前版本指针”。

发布新客户端资产使用 `scripts/publish-update-assets.ps1`。脚本先上传所有版本化分块，最后才覆盖 `latest.json`，因此上传中断不会让用户拿到半个新版本。

## 仓库结构

```text
.
├── index.html
├── game.js                         # canonical gameplay / rendering / client prediction
├── hybrid-transport.js             # Auto / browser-host P2P / Server transport
├── p2p-doorbell-bootstrap.js
├── p2p-doorbell-host.js
├── minimap-hud.js
├── worker.js                       # browser-host authoritative GameRoom implementation
├── client/
│   ├── windows/                    # optional self-contained Windows launcher
│   └── android/                    # optional Android WebView APK
├── workers/
│   ├── update-proxy.js             # update.lunarlab.uk Worker
│   └── wrangler.update.jsonc
├── scripts/
│   ├── test.cjs
│   ├── build-android.ps1
│   └── publish-update-assets.ps1
├── server/                         # retained Server-mode Rust core
├── edge/                           # retained native Edge experiments / Server infrastructure
├── tray/                           # Windows server-side tray companion
├── CHANGELOG.md
└── LICENSE
```

## 本地检查

前端：

```bash
node --check game.js
node --check hybrid-transport.js
node --check minimap-hud.js
node --check minimap-hud-late.js
node scripts/test.cjs
```

Windows 客户端：

```powershell
dotnet publish client\windows\DTAM.Client.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Android 客户端：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
```

Server/Edge 代码仍可独立使用各自 Cargo manifest 执行 `cargo fmt`、`cargo clippy`、`cargo test` 与 release build。

## 信任边界

浏览器房主模式的房主是该房间的实时权威状态机；客户端仍会执行地图碰撞、速度、视线、任务、击杀、投票与角色状态校验，而普通 guest 不能直接修改权威状态。需要不信任房主的部署场景时应使用 Server 模式。

无论哪种游戏数据路径，客户端自更新都不会直接执行未经验证的下载：Windows 与 Android 均限制为 Cloudflare 更新域名，并校验版本清单提供的 SHA-256/大小。

Calls/Realtime、Server 配置和任何凭据都不得提交到仓库。Android 发布签名私钥同样只保存在维护者机器的仓库外目录。

## License

Copyright © 2026 welkin-moon.

本项目以 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）** 发布。完整条款见 [`LICENSE`](LICENSE)。通过网络向用户提供修改版服务时，请同时遵守 AGPL 对对应源代码提供的要求。
