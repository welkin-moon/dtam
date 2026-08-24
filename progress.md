# DTAM 联机与前端重构进度

更新时间：2026-08-24
当前分支：`p2p-browser-host-lab`
状态：核心修复已写入并通过本地静态/编译检查，尚未部署生产环境，也尚未完成双玩家浏览器实测。

## 当前目标

本轮工作集中解决以下问题：

1. 不同玩家看到的地图位置、出生点和移动状态不一致。
2. P2P 与 Server 模式的实时链路混乱，游戏中延迟过高或悄悄回退 Tunnel。
3. 一些设备不显示延迟，或显示的是错误链路/过期样本。
4. 前端信息层级、移动端布局、连接状态和操作反馈不清楚。
5. 长缓存造成不同玩家同时加载不同版本的地图和协议文件。

## 已完成

### 1. 地图与玩家状态一致性

- 增加统一地图协议标识 `dtam-map-150-v1`，客户端、浏览器房主和 Rust Server 连接时必须一致。
- 修复客户端收到权威 `state` 后始终覆盖回本地旧坐标的问题。
- 开局重新分配出生点、会议恢复、返回大厅和重连时，客户端会接受服务端权威自身坐标。
- 给玩家移动增加服务端分配的 `moveSeq`；客户端拒绝迟到、重复或倒序的位置包。
- 地图协议不一致时明确要求所有玩家刷新，避免新旧地图继续混玩。

### 2. Server 模式游戏阶段强制直连

- Server 模式会加载 v3 WebRTC DataChannel 传输，不再直接使用普通 WSS 作为游戏数据面。
- 首次连接、欢迎包和 WebRTC 协商仍可经过 Tunnel；这部分不在强制直连范围内。
- Edge 在两条 DataChannel 都打开时向 Rust Core 报告 `transport_ready=true`，任一通道断开或开始新一代协商时报告 `false`。
- Edge 会过滤客户端伪造的 `transport_ready` 消息。
- Rust Server 在大厅公开每名玩家的 `directReady`，全部在线玩家直连完成前拒绝开始游戏。
- 进入 `playing`/`meeting` 后，Edge 双向丢弃 Tunnel 上的游戏数据；仅保留建链控制、初始信封和主动离房等必要消息。
- 客户端直连中断时冻结移动和操作、显示重建状态并自动重协商；不会静默回退 Tunnel 继续游戏。
- 直连恢复超时后重建整条会话，避免长期卡在伪在线状态。

### 3. P2P 与延迟显示

- P2P 的 `ping/pong` 与位置包使用快速 DataChannel。
- 浏览器房主不再显示误导性的本机 `0 ms`；有玩家后显示最慢对等连接 RTT。
- Server 直连 RTT 来自当前 WebRTC candidate pair 的 `currentRoundTripTime`。
- 延迟样本增加序号匹配、过期清理、后台页面过滤和抖动平滑。
- `#latencyStatus` 在窄屏和横屏上保持可见，不再被 `player-shell.css` 隐藏。
- 网络诊断面板会显示当前线路、RTT、ICE 配对、直连是否经过验证及最近异常。

### 4. 协议缓存与信令代码

- 所有核心 JS/CSS 使用统一构建号 `20260824-direct-m3e1`。
- `_headers` 将核心运行时资源改为 `no-cache, max-age=0, must-revalidate`，避免四小时 immutable 缓存混用新旧协议。
- 仓库内 P2P Signal Worker 同步到 v2.2 TURN admission/credential 行为，避免后续部署把现网能力回退到旧版。

### 5. Material 3 Expressive 前端

- 使用 AGY 的 `gemini-3.7-flash-high` 生成 Material 3 Expressive 设计基础，主要覆盖 `index.html`、`styles.css`、`player-shell.css` 和 `game-polish.js`。
- 建立浅色/深色语义色、形状、层级、阴影、动效和触控状态令牌。
- 重构入口卡片、大厅、HUD、操作区、会议、Toast 和网络状态的显示层级。
- 增加键盘焦点、减少动效、按钮忙碌/禁用反馈和移动端诊断底部面板。
- 用可访问的连接诊断 Dialog/Sheet 取代原来的 alert 式信息展示，并补充焦点循环、内容转义和安全复制回退。
- 高级网络模式和 Server URL 仍只在 `debug=1` 下显示，普通玩家继续使用简化界面。

## 本地验证结果

以下检查在 2026-08-24 当前工作树通过：

- `node --check`：`game.js`、`game-polish.js`、`hybrid-transport.js`、`v3-bootstrap.js`、`v3-resilience.js`、`worker.js`、`workers/p2p-signal-v2.js`。
- `node scripts/test.cjs`：通过地图缩放、连通性、权威同步、移动序号、缓存策略、延迟显示和 Server 直连静态断言。
- `cargo fmt --check`：Server 与 Edge 均通过。
- `cargo test --manifest-path server/Cargo.toml`：编译通过；当前 Rust 测试数为 0。
- `cargo test --manifest-path edge/Cargo.toml`：编译通过；当前 Rust 测试数为 0。
- `index.html` 重复 ID 检查：通过。
- `git diff --check`：通过。

## 尚未完成 / 不能视为已上线

- [ ] 在 375×667、844×390、平板和 1440×900 上完成最终视觉截图验收。
- [ ] 使用两个独立浏览器上下文完成 Auto/P2P 房间创建、加入、开局、移动、会议、返回大厅测试。
- [ ] 使用两个独立浏览器上下文完成 Server 模式测试，并确认双方 `directReady=true` 后才能开始。
- [ ] 对局中主动断开 DataChannel，确认游戏冻结、Tunnel 游戏包被丢弃、直连恢复后由权威状态校正。
- [ ] 验证两个玩家开局、重置和重连后的自身/对方坐标完全一致。
- [ ] 在多台真实设备上对比 RTT、抖动、可见性和休眠恢复行为。
- [ ] 为 Rust Core/Edge 增加真正的协议单元测试；目前 `cargo test` 只有编译检查。
- [ ] 构建 release 二进制并更新自托管 Server/Edge 服务。
- [ ] 部署 Pages 前端和必要的 Worker 更新，并在 `https://d1.lunarlab.uk` 做生产验收。

## 给下一位 Agent 的接手说明

- 这是可编译、静态检查通过的阶段性半成品，不是已经完成联机验收的版本。接手后应先复跑本文件中的检查，再从双浏览器实测开始。
- 必须保持的产品约束：连接首包、欢迎包和 WebRTC 协商可以经过 Tunnel；一旦进入游戏，移动、交互、会议等游戏数据必须使用直连 DataChannel。
- 游戏中直连丢失时应冻结操作并重建连接，不能为了“看起来还能玩”而静默回退 Tunnel。不要通过移除 `directReady` 开局门禁来绕开故障。
- Server 模式无法开始时，优先沿 `Edge transport_ready → Rust directReady → 客户端房间状态` 排查，不要先放宽直连要求。
- 第一优先级是两个独立浏览器的 P2P/Server 完整对局与断链测试；第二优先级才是视觉细节收尾；通过后再按下方顺序部署。
- 每完成一项真实设备或双端验证，请在本文件勾选并记录测试环境、结果和剩余异常，避免后续把静态检查误认为真实联机通过。

## 建议部署顺序

1. 先构建并替换 Rust Server 与 v3 Edge，确认健康检查和 Edge→Core `transport_ready` 流程正常。
2. 如需更新 Signal Worker，先验证 v2.2 TURN 配置和 admission 响应未回退。
3. 再部署 Pages 前端；新前端会携带地图协议标识，并要求 Server 游戏阶段直连。
4. 清理/复核 CDN 缓存，使用两个全新浏览器上下文完成一局完整测试。
5. 最后测试直连中断、页面后台、网络切换和旧客户端刷新提示。

## 兼容性与风险提示

- 新客户端与旧 Server/旧浏览器房主不能混用；地图协议门禁会主动拒绝不匹配版本。
- 新 Rust Server 如果没有配套的新 Edge，玩家不会获得 `directReady=true`，因此无法开始 Server 对局。
- 当前提交是实验分支上的阶段性同步，不代表生产部署已经完成。
- `node_modules/` 和本地构建目录不会提交到 GitHub。

## 主要改动文件

- 游戏与地图同步：`game.js`、`worker.js`、`server/src/main.rs`
- P2P/Server 传输：`hybrid-transport.js`、`v3-bootstrap.js`、`v3-resilience.js`、`edge/src/main.rs`
- 信令：`workers/p2p-signal-v2.js`、`p2p-game-room-patch.js`
- 前端 UX：`index.html`、`styles.css`、`player-shell.css`、`game-polish.js`
- 缓存与验证：`_headers`、`scripts/test.cjs`
