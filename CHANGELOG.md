# Changelog

## 3.0.2 — 2026-09-18

### 稳定客户端壳与域名迁移

- Windows / Android 继续保留 Auto、浏览器房主权威、WebRTC DataChannel、TURN/doorbell/信令和 Server fallback；常规功能更新继续由 canonical 网页热发布，不要求重装客户端。
- Windows 启动入口可直接跟随 HTTPS 静态重定向；Android 在启动重定向链结束后动态锁定最终 HTTPS 游戏 origin，后续换 canonical 域名时可让旧 d1.lunarlab.uk 使用纯静态 Pages 重定向完成兼容。
- Android 麦克风权限不会因此放宽到任意网页，只允许本次启动最终确认的游戏 origin。

### 联机会话 fencing

- 新增每个标签页/壳实例独立的 client instance ID；昵称仅作为显示名，允许同名玩家并存。
- resume token 改为带实例归属的持久记录，并在当前标签页保留独立恢复副本，避免同源标签页因为同名共享 token。
- Browser-host P2P authority 与 Rust Server fallback 同时增加在线实例 fencing：只有同一 client instance 的重连能替换旧 socket；不同实例即使拿到同一个 resume token，也不能踢掉在线玩家。
- 兼容旧版纯字符串 resume token；检测到 token 正被另一实例占用时，lobby 会自动放弃该 token 并作为新的同名玩家加入。
- 重连 fencing 不牺牲恢复能力：同一实例的网络重连/刷新可直接替换旧 socket；进程重启或崩溃后，本地确认上一实例租约已失效时会携带上一 instance ID 执行 handoff，并兼容升级前尚未绑定 instance ID 的旧会话。
- Chromium/WebView 优先使用 Web Locks 持有实例所有权，避免后台标签页定时器被节流后误判为离线；旧环境继续使用短租约兼容路径。

## 3.0.1 — 2026-09-08

### 地图与渲染一致性

- 主场景墙体和完整小地图改为直接绘制 `dtam-map-150-v1` 的 150×150 权威碰撞网格，不再使用 100×100 中心点降采样；修复“障碍能碰撞、小地图存在但主画面不显示”的薄墙/窄障碍。
- 常驻小地图把静态墙层缓存到离屏 Canvas，动态刷新只绘制玩家、任务和状态标记，减少移动端与 Web 端主线程抖动。
- 主场景墙体同样预渲染为离屏权威地图层，摄像机每帧只做裁切/缩放；移除旧的 1000/72 rAF 人工帧间隔，90/120/144 Hz 屏幕不再因离散跳帧实际掉到约 45/60/72 fps。

### 联机延迟与手感

- direct WebRTC 位置更新从约 30 Hz 提升到约 50 Hz；高 RTT direct 链路不再反向降频。TURN relay 维持更保守的约 25 Hz。
- 直接读取 WebRTC selected candidate pair 的 `currentRoundTripTime` 和候选类型，HUD/预测可以区分真实直连与 TURN relay，而不是主要依赖应用层 ping 猜测链路。
- 调整远端速度估算、平滑收敛和有界外推，高 RTT 下更快跟手，同时保留最大预测窗口避免失控外推。
- browser-host 的 doorbell 继续承担即时 join 唤醒；HTTP/D1 后备 join poll 从 2200 ms 缩短到 900 ms，降低 doorbell 受阻时的额外入房等待。
- WebRTC answer/offer 后备轮询前段进一步收紧，加快常见网络条件下的建链。

### Windows / Android 客户端与自更新

- 新增 `uk.lunarlab.dtam` Android WebView APK：minSdk 26 / targetSdk 35，复用 canonical web game，支持麦克风 WebRTC 与 `dtam://join?room=NN` 深链。
- Android 客户端只对正式游戏 origin 放行音频采集，并禁止 cleartext/mixed-content/file-content WebView 访问。
- Android 更新器从 `update.lunarlab.uk` 自动检查、下载并校验大小与 SHA-256，再交给系统 `PackageInstaller`；遵守 Android 的未知来源授权和安装确认，不伪造静默安装能力。
- Windows 自包含单 EXE 启动器升级到 3.0.1：游戏先启动，更新检查在旁路进行；下载的新 EXE 通过 Cloudflare host allowlist、大小和 SHA-256 校验后，在当前进程退出后替换自身。
- 新增 Cloudflare Workers KV 分块更新源。大 EXE 按 ≤20 MiB 分块保存，Worker 流式返回；发布脚本最后才写 `latest.json`，避免中断发布暴露半成品。

## 3.0.0 — 2026-08-30

### Browser-host P2P 正式落地

- Auto 模式首选浏览器房主权威：创建房间的客户端运行与 Worker 游戏核心同源的 `GameRoom`，guest 通过 WebRTC DataChannel 直接连接房主。
- `dtam-control` 使用 ordered/reliable 通道承载关键动作；`dtam-fast` 使用 unordered + `maxRetransmits=0` 承载位置和 RTT 探针，过期位置不会因重传堵塞后续采样。
- Cloudflare signaling / doorbell 只负责建链与房间协调；受限网络可使用 Cloudflare TURN；无法建立 P2P 时 Auto 保留 Server fallback。
- 增加浏览器房主热备快照、掉线接管和 epoch fencing，降低房主异常掉线造成的房间丢失。
- Cloudflare Realtime/Calls 继续承载语音媒体，与游戏 DataChannel 分离。
- 新增玩家列表、邀请、规则预设、延迟/transport 状态、完整小地图及移动端交互修复。
- 首个正式 GitHub Release 同时提供网页和可选 Windows x64 自包含启动器。
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
