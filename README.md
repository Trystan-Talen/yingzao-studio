# 映造工作室

面向电商图片与视频创作的本地应用，包含创作工作台、画布编辑、素材管理、团队协作与持久任务队列。

支持本机图片和视频处理，并提供外部模型、支付、登录及邮件服务的适配。2026-10-16 接手版本的当前实现、验证与未完成项见[本轮状态](reviews/takeover/STATUS.md)和[逐项范围台账](reviews/takeover/scope-ledger.json)。外部服务需要自行配置和联调；[旧交付说明](交付说明.md)与[旧功能矩阵](delivery-feature-matrix.md)保留为历史材料，不代表本轮已通过验收。

## 快速体验

需要 Node.js（脚本运行环境）22.12 及以上的 22 系列版本，或 24 及以上版本，以及 pnpm（依赖管理工具）11。视频处理另需 FFmpeg（音视频处理工具）和 ffprobe（媒体探测工具）。

在仓库根目录执行：

```sh
cd platform
pnpm install --frozen-lockfile
pnpm seed-demo
pnpm seed-demo-assets
pnpm dev:demo
```

打开 <http://127.0.0.1:5174>。演示账号为 `demo@example.local`，密码为 `DemoStudio2026!`。演示数据与正式数据分开保存。

macOS（苹果桌面操作系统）也可双击根目录的 `启动映造.command`，保持启动窗口打开即可。

使用自己的数据和模型前，请阅读[配置与运行说明](platform/README.md)。

## 项目内容

- [应用源码与启动说明](platform/README.md)：前后端、任务执行器、数据库迁移和测试。
- [架构设计](specs/architecture.md)：技术选型与模块边界。
- [原创素材说明](design-assets/README.md)：演示图库的素材来源。
- [本轮验收状态](reviews/takeover/STATUS.md)：当前进度、逐项证据与真实阻塞；[旧验收记录](reviews/phase-6.md)仅供追溯。

本仓库保留项目提交历史。数据库、私有媒体、真实密钥、依赖、构建产物、本机压缩包及第三方调查材料不纳入版本管理。
