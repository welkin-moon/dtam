# Among Us · 东滩版

一个面向浏览器的实时多人社交推理小游戏。v2.7 起仓库直接保存可部署源代码，不再通过 Base64 分片和逐版本补丁在构建时重建生产文件。

> 本项目是非官方同人实现，与 Innersloth 无隶属关系；请勿将其误认为官方 Among Us 客户端或服务。

## 当前版本

**v2.7**

- 两位数字房间号（10–99），客户端和实时后端都严格校验。
- Cloudflare Pages 静态前端 + Cloudflare Workers / Durable Objects 实时房间。
- Cloudflare Calls WebRTC 语音。
- 100×100 客户端视图与 150×150 服务端碰撞坐标转换。
- 任务、紧急会议、投票、通风管、破坏、信息设备和多种职业能力。
- 幽灵文字频道由 Worker 只投递给死亡玩家；语音订阅同时由目录和 `/voice` 代理在服务端限制。
- 头像使用 WebP 压缩后持久化，支持断线重连。

## 仓库结构

```text
.
├── index.html       # 页面骨架
├── game.js          # 前端游戏逻辑（canonical source）
├── styles.css       # 唯一生产样式表
├── worker.js        # 当前生产 Worker / Durable Object 源码
├── _headers         # Cloudflare Pages 响应头
├── scripts/test.cjs # 协议、地图、交互和隐私断言
├── CHANGELOG.md
├── LICENSE
└── .github/workflows/ci.yml
```

旧版 `src/game.b64.*`、`src/game-2.6.br.*`、`build/patch-game-*` 和多层 `gameplay-*.css` 已在 v2.7 移除。生产构建不再依赖历史补丁链。

## 本地运行

前端没有打包器依赖，可直接用静态 HTTP 服务：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。多数浏览器把 `localhost` 视为安全上下文；部署到其他主机时，麦克风需要 HTTPS。

执行静态和地图协议测试：

```bash
node --check game.js
cp worker.js /tmp/dtam-worker.mjs && node --check /tmp/dtam-worker.mjs
node scripts/test.cjs
```

## 部署

### Cloudflare Pages

Pages 根目录就是仓库根目录，不需要生成生产 JS。推荐构建命令：

```bash
node --check game.js && cp worker.js /tmp/dtam-worker.mjs && node --check /tmp/dtam-worker.mjs && node scripts/test.cjs
```

输出目录为 `.`。

### Worker

`worker.js` 使用模块语法，并导出 `GameRoom` Durable Object。生产环境至少需要以下绑定：

- `ROOMS`：Durable Object namespace，class 为 `GameRoom`。
- `CALLS_APP_ID`：Cloudflare Calls 应用 ID。
- `CALLS_APP_SECRET`：Cloudflare Calls 密钥，必须作为 secret 配置，**不要提交到仓库**。

前端当前通过 `rt-d1.lunarlab.uk` 连接实时服务和语音代理；自托管时可在 `game.js` 顶部修改 `REALTIME_ORIGIN` 与 `VOICE_API`。

## 隐私与信任边界

v2.7 不再只依赖前端隐藏幽灵信息。普通游戏中的死亡玩家文字只在 Durable Object 内发往死亡连接；语音目录按接收者过滤，Calls 的远端音轨订阅还会在 Worker 代理层重新校验。客户端仍保留防御性过滤，用来处理旧消息或异常状态。

## License

Copyright © 2026 welkin-moon.

本项目以 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）** 发布。完整条款见 [`LICENSE`](LICENSE)。通过网络向用户提供修改版服务时，请同时遵守 AGPL 对对应源代码提供的要求。
