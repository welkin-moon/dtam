# Among Us · 东滩版

一个面向浏览器的实时多人社交推理小游戏。v2.8 的生产架构为 **Cloudflare Pages 静态前端 + Cloudflare Tunnel + 自托管 Rust 实时服务端 + Cloudflare Realtime SFU 语音**。

> 本项目是非官方同人实现，与 Innersloth 无隶属关系；请勿将其误认为官方 Among Us 客户端或服务。

## 当前版本

**v2.8**

- 两位数字房间号（10–99），浏览器和服务端都严格校验。
- `d1.lunarlab.uk` 继续由 Cloudflare Pages 托管静态页面。
- `rt-d1.lunarlab.uk` 通过 Cloudflare Tunnel 进入 Rust/Axum 服务端，不再让 Workers / Durable Objects 承担生产实时消息。
- Cloudflare Realtime SFU 继续承载 WebRTC 语音媒体；Calls API secret 只保存在服务端本机。
- 前端实时显示 WebSocket RTT，并计算平滑 RTT/抖动；远端角色使用有界预测 + 更快平滑降低视觉滞后。
- 击杀、报告、任务、紧急会议、通风管等关键动作会在动作包前强制同步最新位置，减少高延迟下的距离判定错位。
- WebSocket 单消息/单帧上限 16 KiB、每连接应用消息上限 60/s、发送队列有界、总并发 WebSocket 上限 256。
- WebSocket 与语音 API 均校验网页 Origin；语音 session 与房间/玩家绑定，并有本地 API / session 创建限速。
- 房间快照写入 `D:\server\data\rooms`，采用临时文件 + 备份恢复；v2.8 将磁盘持久化移出房间锁并降为约 5 秒 checkpoint，减少实时消息抖动。

## 仓库结构

```text
.
├── index.html
├── game.js
├── styles.css
├── _headers
├── server/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── config.example.json
│   └── src/main.rs       # v2.8 生产 Rust 后端
├── worker.js             # v2.7 legacy rollback，不在生产请求路径
├── scripts/test.cjs
├── CHANGELOG.md
├── LICENSE
└── .github/workflows/ci.yml
```

## 本地检查

前端：

```bash
node --check game.js
cp worker.js /tmp/dtam-worker.mjs && node --check /tmp/dtam-worker.mjs
node scripts/test.cjs
```

Rust 服务端：

```bash
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path server/Cargo.toml --locked
cargo build --manifest-path server/Cargo.toml --release --locked
```

## 部署

### Cloudflare Pages

Pages 根目录仍为仓库根目录，输出目录 `.`。静态资源 URL 使用版本 query 做 cache busting，因此 `game.js` / `styles.css` 可安全使用 immutable cache；HTML 保持 `no-cache`。

### Rust 实时服务

复制 `server/config.example.json` 为本机配置文件并填写 Calls App ID/Secret。生产机当前默认读取：

```text
D:\server\config\server.json
```

生产监听：

```text
127.0.0.1:28727
```

再由 Cloudflare Tunnel 把 `rt-d1.lunarlab.uk` 转发到该地址。服务端只监听 loopback，不需要在路由器/Windows 防火墙公开游戏端口。

`calls_secret` **禁止提交到仓库**。

## Cloudflare 使用边界

纯 Pages 静态资源请求属于免费且不限请求量的静态资产流量；Pages Functions 才会计入 Workers 配额。v2.8 的实时游戏 WebSocket 已不经过 Worker/DO，所以之前 Durable Objects Free 的 100,000 requests/day 不再约束游戏实时同步。

仍需关注 Cloudflare Realtime SFU 的独立用量。Cloudflare 当前为 Realtime SFU 提供每账户每月前 1,000 GB 下行免费额度，超过后按 Realtime 定价计算。Tunnel 是当前自托管入口，不应把它理解成 Durable Objects 那种按 WebSocket 消息计数的额度。

## 隐私与信任边界

普通游戏中的死亡玩家文字只投递给死亡连接；语音目录按接收者过滤，Calls 远端音轨订阅还会在 Rust 代理重新校验。v2.8 进一步把 Calls session 绑定到创建它的房间玩家，阻止合法房间 token 操作其他 session。

## License

Copyright © 2026 welkin-moon.

本项目以 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）** 发布。完整条款见 [`LICENSE`](LICENSE)。通过网络向用户提供修改版服务时，请同时遵守 AGPL 对对应源代码提供的要求。
