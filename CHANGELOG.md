# Changelog

## 3.0 — 开发中

> 新 v3 以 2.8 为游戏逻辑与权威服务端基线，不继承历史旧 v3 实现。

### 直连中心节点网络层

- 新增独立 Rust `dtam-edge` 网关；浏览器先通过 Cloudflare Tunnel 建立信令与兼容通道，再尝试 WebRTC ICE/DataChannel 直达中心节点。
- v3 不是玩家 mesh P2P：v2.8 Rust Core 继续作为唯一权威状态机，Edge 只替换/复用消息传输路径。
- 新增 `dtam-control` ordered/reliable 与 `dtam-fast` unordered/no-retransmit 两条 DataChannel；位置与心跳可丢弃旧包，动作/聊天/任务继续可靠传输。
- 同一 LAN 的客户端可通过 ICE host candidate 使用 `10/8`、`172.16/12`、`192.168/16` 私网地址直连，不需要通过公网或 Cloudflare hairpin。
- NAT2/状态防火墙场景通过双方 ICE connectivity check 主动打洞，不把公网 IPv6 首包可达或路由器 IPv4 DMZ 作为前提。
- DataChannel 失败/断开自动回到 Edge WSS/Tunnel；Edge 本身不可用时继续回到原 `rt-d1` v2.8 WebSocket。
- 浏览器 endpoint 列表与 Edge `node_id` 为后续双服务端路由预留接口；3.0 仍保持单权威房间节点。

### 坐标一致性

- 修复 v2.8 开局服务端重新分配 spawn 后，客户端普通 `state` 路径刻意保留旧 `myPos` 导致各客户端世界坐标不一致的问题。
- v3 仅在 `game_start` / `lobby_reset` 等权威跃迁后接受服务端 self position，普通移动仍保留本地预测与原服务端 `correct` 校正机制。

### Windows 服务端体验

- 新增 `scripts/dtam-tray.ps1` Windows 通知区 companion，显示 Core/Edge 在线状态、Edge 会话数和 LAN 地址，并可打开游戏、`D:\server` 与日志目录。
- 托盘与 SYSTEM 后端进程分离，计划以登录用户任务启动，避免 Windows Session 0 隔离导致后台服务无法正常显示通知区图标。
- CI 新增 Windows x64 `dtam-edge.exe` release build 和托盘 PowerShell 语法检查。

### 部署安全

- v2.8 Core `127.0.0.1:28727` 继续保持 loopback-only；v3 Edge HTTP/WSS 信令端口也计划只监听 loopback，由现有 Cloudflared 转发。
- 直连仅需要按 `dtam-edge.exe` 程序放行 WebRTC UDP，不公开 Core TCP 游戏端口。
- Calls/Realtime 语音 Secret 继续只保存在原锁定的 `server.json`，Edge 配置不复制语音 Secret。

## 2.8 — 2026-08-14

### 后端迁移与额度

- 生产实时服务从 Cloudflare Worker + Durable Objects 迁移到 Windows 主机上的 Rust/Axum 服务，通过 `rt-d1.lunarlab.uk` → Cloudflare Tunnel → `127.0.0.1:28727` 提供服务。
- Pages 静态前端保持不变；旧 `worker.js` 仅作为 v2.7 legacy rollback 保留。
- Rust 服务端源码、Cargo lockfile 和无 secret 的配置模板进入仓库和 CI。
- 房间状态持久化到 `D:\server\data\rooms`；checkpoint 从锁内同步写盘改为约 5 秒一次的锁外阻塞任务，降低实时线程抖动。

### 延迟与手感

- HUD 新增实时 RTT 显示，并对 RTT 与抖动做指数平滑。
- heartbeat/RTT 采样调整为 3 秒；页面从后台恢复时立即重新采样。
- WebSocket 首次握手容忍度从 10 秒提高到 20 秒，避免国内到 Cloudflare 边缘线路抖动时误判为服务不可用。
- 远端移动从“只追最后坐标”升级为有界速度预测 + 平滑追踪，预测窗口最多 80 ms，避免过度外推。
- 击杀、报告、任务、修复、紧急会议、能力和通风管等关键动作会先强制发送最新坐标再发送动作，减少服务端距离判定使用旧坐标的问题。
- 前端对实时域名增加 `preconnect` / `dns-prefetch`；JS/CSS 使用独立的 `2.8.1` 资源指纹后再启用 immutable cache，避免同版本热修被旧缓存吞掉。

### 安全与稳定性

- WebSocket message/frame 最大 16 KiB；单连接应用层消息最多 60 条/秒。
- 服务端发送队列由 unbounded 改为有界队列，降低慢客户端造成的内存放大。
- 总并发 WebSocket 上限 256，保护低内存主机免受连接洪泛。
- 同一 `CF-Connecting-IP` 最多 32 条并发 WebSocket；服务端对 90 秒无任何活动的连接主动回收。
- 成功恢复会话后立即轮换 resume token，降低旧 token 泄露后的长期重放价值。
- WebSocket 与 `/voice` 只接受配置中的正式网页 Origin。
- `/voice` 请求体限制 64 KiB；Calls API 操作只允许白名单路径和合法 session id。
- Calls session 绑定到创建它的房间与玩家；`voice_publish` 也验证 session 所有权，阻止跨玩家 session 冒用。
- 每玩家语音 API 与 session 创建均有本地限速；上游错误不再把内部错误细节原样返回浏览器。
- 快照写盘改用 `.tmp` + `.bak` 恢复策略，避免异常中断留下空/半写 JSON。
- Pages 增加 CSP、`X-Frame-Options: DENY`，并继续限制摄像头/定位权限。

## 2.7 — 2026-08-13

### 发布与结构

- 将仓库改为直接保存 `game.js`、`styles.css` 和 `worker.js` 的 canonical source。
- 移除 Base64/Brotli 分片、2.3→2.6 补丁链和多代叠加 CSS。
- Cloudflare Pages 构建改为纯校验，不再重建旧版本生产文件。
- 新增 README、AGPL-3.0-only license 与统一 CI。

### 房间与联机

- 新建/加入房间恢复为两位数字（10–99）。
- 客户端和 Worker 都严格拒绝非两位房间号。
- 创建房间会随机遍历 90 个候选，遇到占用自动换号。

### 会议、聊天与隐私

- 修复会议期间 `state` 包把 UI phase 覆盖回 `playing` 导致的状态混乱。
- 会议期间冻结移动和场景操作，玩家列表/状态显示以真实 meeting 状态为准。
- Worker 恢复会议文字聊天。
- 幽灵文字由服务端只投递给死亡玩家。
- 语音目录按接收者过滤，Worker 的 Calls 代理拒绝订阅无权接收的死亡玩家远端音轨。

### 继承自 2.6 并正式上线

- 恢复任务、紧急会议、通风管、信息设备、破坏、跳过投票、返回大厅等交互绑定。
- 击杀后 900 ms 报告保护与动作节流，避免同一触摸误触“报告尸体”。
- 100×100 客户端地图、26 格视野，与 150×150 Worker 协议坐标兼容。
- 头像 WebP 压缩/全局持久化；麦克风 Permissions-Policy 与错误分类修复。
- 远端 `<audio>` 保留在渲染树，并保留移动端手动解锁播放。

## 2.6 — 2026-08-13

2.6 的 GitHub 源码包含上述前端修复，但当时 Cloudflare Pages 项目的构建命令仍只执行到 2.5 patch，导致线上前端没有真正应用 2.6。2.7 移除了该构建链并将这一发布错位彻底修正。
