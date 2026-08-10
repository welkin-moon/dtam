# Among Us · 东滩版（dtam）

一个运行在 Cloudflare 上的轻量实时联机游戏：静态客户端由 Pages 提供，房间状态与 WebSocket 连接由一个 SQLite-backed Durable Object 管理。

## 线上结构

- Pages 项目：`dtam`，生产分支 `main`
- 站点：`https://d1.lunarlab.uk`（另有 `dtam.pages.dev`）
- Worker：`d1-realtime`
- Worker 域名：`https://rt-d1.lunarlab.uk`
- 健康检查：`GET https://rt-d1.lunarlab.uk/health`
- WebSocket：`GET /ws?room=<6位房间号>&name=<昵称>&create=0|1`

Pages 与 Worker 是两个独立部署单元。`worker/wrangler.jsonc` 不声明 Custom Domain，避免代码部署意外改动已经存在的域名绑定。

## 仓库布局

```text
index.html、*.css       Pages 静态页面
src/game.b64.*          gzip 后的 game.js，按 Base64 分片保存
worker/src/index.js     当前 d1-realtime Worker 源码
worker/wrangler.jsonc   Durable Object 与部署配置
tests/                  前端包和 Worker 回归测试
```

Pages 当前构建命令会拼接四个 Base64 分片，解码并解压为 `game.js`：

```sh
cat src/game.b64.001 src/game.b64.002 src/game.b64.003 src/game.b64.004 | base64 -d | gzip -dc > game.js
```

## 本地校验

需要 Node.js 20 或更高版本：

```sh
npm install
npm run check
npm run worker:dry-run
```

测试会直接解码前端分片并进行 JavaScript 语法检查，同时验证移动路径不能穿墙、旧版“一条消息直接完成任务”协议保持禁用，以及 WebSocket 消息大小上限仍然存在。

## 部署

Pages 由 Cloudflare Git 集成在 `main` 更新后自动构建。Worker 可单独部署：

```sh
npm run worker:deploy
```

首次在新账号部署时必须保留 `v1-room-sqlite` Durable Object migration；不要修改已经发布的 migration tag。部署后分别检查 `/health`、创建房间、第二个浏览器加入、开始游戏、任务挑战与断线重连。

## 协议与安全边界

- 房间号仅用于寻址，不是访问密码；拿到房间号的人可以在大厅阶段加入。
- 重连依赖服务端签发的玩家 token，客户端不能选择身份或角色。
- 任务必须走 `task_begin` → 服务端 challenge → `task_complete`，旧版 `task` 快捷消息不会计入进度。
- 活着的玩家移动会校验完整路径和碰撞，不能只靠合法终点穿过一格墙。
- 单条 WebSocket 客户端消息限制为 16 KiB；昵称、聊天和设置还会分别做更严格的字段限制。
