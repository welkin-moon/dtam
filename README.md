# Among Us · 东滩版

一个面向浏览器的实时多人社交推理小游戏。

> 本项目是非官方同人实现，与 Innersloth 无隶属关系；请勿将其误认为官方 Among Us 客户端或服务。

## 当前开发版本

**v3（基于 v2.8 的新一代；不是历史上的旧 v3）**

v3 保留 v2.8 已加固的 Rust 权威游戏核心，在它前面新增一个轻量 Rust Edge 网络层：浏览器先通过 Cloudflare Tunnel 完成加入房间与 WebRTC 信令，ICE/DataChannel 建链成功后，实时游戏流量优先直接到中心节点；直连失败或中断时自动回落到 Tunnel。

```text
Cloudflare Pages
      |
      v
   Browser
      |\
      | \ WebRTC DataChannel direct
      |  +----------------------------+
      |                               v
      +-- WSS / Cloudflare Tunnel --> dtam-edge v3
                                      |
                                      | loopback WebSocket
                                      v
                                 dtam-server v2.8
                                 authoritative core
```

- **不是玩家之间 mesh P2P。** Rust 中心节点仍然是唯一权威状态机。
- `dtam-control` 使用 ordered/reliable DataChannel 传输动作、聊天、任务、投票等可靠消息。
- `dtam-fast` 使用 unordered + `maxRetransmits=0` 传输位置/心跳等过期即无价值的数据。
- 同一 LAN 内的浏览器可以通过 ICE host candidate 直接使用当前 `10.x` / `172.16-31.x` / `192.168.x` 地址，不需要公网回环。
- 服务端 IPv4、IPv6、NAT 映射都视为动态路径信息：每次 RTC 协商重新枚举当前 Up 网卡地址并重新做 STUN，不把地址写入节点身份或持久配置。
- NAT/状态防火墙环境下由 ICE 双向 connectivity checks 尝试建立可用 UDP 路径，不依赖路由器 IPv4 “DMZ 主机”作为核心机制。
- DataChannel 中断但 Tunnel 仍连接时，只重建 WebRTC transport，不重新加入 Core 房间；Tunnel 在直连成功后临时掉线也不会主动杀掉仍健康的直连。
- v3 Edge 不可用时，浏览器还会最终回落到原来的 `wss://rt-d1.lunarlab.uk/ws` v2.8 路径。
- 浏览器 endpoint 列表与 Edge `node_id` 已为后续双服务端路由预留接口；v3.0 本身仍是单权威节点。
- Cloudflare Realtime/Calls SFU 继续承载现有语音媒体；v3 DataChannel 只负责游戏实时消息。
- 修复 v2.8 开局重新分配 spawn 后客户端继续保留旧 `myPos` 所造成的多客户端坐标世界不一致；普通移动仍保留本地预测。
- Windows 新增 **native Rust 托盘 companion**，显示 Core/Edge 状态、Edge 会话数和当前 IPv4/IPv6；托盘运行于登录用户会话，后台 Core/Edge 仍由 SYSTEM 自启。

完整设计见 [`docs/V3-ARCHITECTURE.md`](docs/V3-ARCHITECTURE.md)。

## v2.8 生产基线

在 v3 完成主机部署验证前，现网仍是 **Cloudflare Pages 静态前端 + Cloudflare Tunnel + 自托管 Rust v2.8 实时服务端 + Cloudflare Realtime SFU 语音**。v3 分支不会删除这条回退路径。

v2.8 已有的关键加固继续作为 v3 游戏核心基线：

- 两位数字房间号（10–99），浏览器和服务端都严格校验。
- `d1.lunarlab.uk` 由 Cloudflare Pages 托管静态页面。
- `rt-d1.lunarlab.uk` 通过 Cloudflare Tunnel 进入 Rust/Axum 核心，不再让 Workers / Durable Objects 承担生产实时消息。
- WebSocket 单消息/单帧上限 16 KiB、每连接应用消息上限 60/s、发送队列有界、总并发上限 256、同 IP 并发上限 32；90 秒无活动连接由核心回收。
- resume token 在成功恢复会话后立即轮换。
- WebSocket 与语音 API 校验网页 Origin；Calls session 与房间/玩家绑定。
- 房间快照存放在 `D:\server\data\rooms`，采用临时文件 + 备份恢复并把持久化 I/O 移出实时房间锁。

## 仓库结构

```text
.
├── index.html
├── game.js                    # v2.8 gameplay client / protocol
├── v3-bootstrap.js            # v3 WebSocket/DataChannel transport facade
├── v3-resilience.js           # fallback、动态网络/ICE replacement
├── styles.css
├── _headers
├── server/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── config.example.json
│   └── src/main.rs            # v2.8 authoritative Rust core
├── edge/
│   ├── Cargo.toml
│   ├── config.example.json
│   └── src/main.rs            # v3 WebRTC Edge / Tunnel gateway
├── tray/
│   ├── Cargo.toml
│   └── src/main.rs            # native Windows notification-area companion
├── scripts/
│   ├── test.cjs
│   └── install-v3.ps1         # one-shot Windows install/upgrade helper
├── docs/V3-ARCHITECTURE.md
├── worker.js                   # v2.7 legacy rollback，不在生产请求路径
├── CHANGELOG.md
├── LICENSE
└── .github/workflows/ci.yml
```

## 本地检查

前端：

```bash
node --check game.js
node --check v3-bootstrap.js
node --check v3-resilience.js
cp worker.js /tmp/dtam-worker.mjs && node --check /tmp/dtam-worker.mjs
node scripts/test.cjs
```

v2.8 权威 Core：

```bash
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path server/Cargo.toml --locked
cargo build --manifest-path server/Cargo.toml --release --locked
```

v3 Edge：

```bash
cargo generate-lockfile --manifest-path edge/Cargo.toml
cargo fmt --manifest-path edge/Cargo.toml -- --check
cargo clippy --manifest-path edge/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path edge/Cargo.toml --locked
cargo build --manifest-path edge/Cargo.toml --release --locked
```

v3 Windows 托盘在 Windows x64 CI 上执行 `rustfmt --check` 与 release build；Linux CI 同时生成其 lockfile 并执行 RustSec。

## v3 部署目标

生产机目标目录仍全部放在 `D:\server`：

```text
D:\server\bin\dtam-server.exe
D:\server\bin\dtam-edge.exe
D:\server\bin\dtam-tray.exe
D:\server\config\server.json
D:\server\config\edge.json
D:\server\data\rooms\
D:\server\logs\
```

建议进程模型：

- `DTAM Rust Server`：SYSTEM / AtStartup，现有权威 Core。
- `DTAM v3 Edge`：SYSTEM / AtStartup，新 WebRTC Edge。
- `DTAM v3 Tray`：登录用户 `meteo` / AtLogOn，native Rust 通知区 companion；使用 Win32 GUI subsystem，不常驻 PowerShell/CLR。
- `Cloudflared`：继续作为 Windows Automatic service。

Core TCP 端口 `28727` 继续只监听 loopback。Edge 的 HTTP/WSS 信令入口 `28729` 也只给本机 Cloudflared；真正的直连使用 Edge 的 WebRTC UDP sockets，因此 Windows 防火墙按 **`dtam-edge.exe` 程序**允许入站 UDP，而不是公开 Core TCP 端口或绑定某个会变化的 IP。

`edge-d1.lunarlab.uk` 计划由现有 Cloudflare Tunnel 转发到 `http://127.0.0.1:28729`。浏览器始终保留 `rt-d1.lunarlab.uk` 最终回退。

## Cloudflare 使用边界

纯 Pages 静态资源请求属于免费且不限请求量的静态资产流量；Pages Functions 才会计入 Workers 配额。v2.8/v3 的生产实时游戏消息不经过 Worker/DO，因此旧 Durable Objects Free 请求额度不再是实时同步瓶颈。

Cloudflare Realtime SFU 的语音用量仍是独立额度。Tunnel 在 v3 中主要承担信令和 fallback；当 DataChannel 直连成功后，高频位置数据不再必须经过 Cloudflare Tunnel。

## 隐私与信任边界

游戏 Core 继续负责位置合法性、墙体/速度校验、击杀/任务/投票状态以及幽灵隐私。WebRTC 直连只替换传输路径，不扩大浏览器的游戏权限。普通游戏中的死亡玩家文字只投递给死亡连接；语音目录按接收者过滤，Calls 远端音轨订阅仍由 Rust 代理重新校验。

Calls App secret 只保存在本机锁定的 `server.json`，**禁止提交到仓库**。`edge.json` 只包含节点与网络策略，不保存探测到的公网/内网 IPv4 或 IPv6，也不需要复制 Calls secret。

## License

Copyright © 2026 welkin-moon.

本项目以 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）** 发布。完整条款见 [`LICENSE`](LICENSE)。通过网络向用户提供修改版服务时，请同时遵守 AGPL 对对应源代码提供的要求。
