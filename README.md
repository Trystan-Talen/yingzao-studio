# 映造工作室

面向电商图片与视频创作的本地应用，包含创作工作台、画布编辑、素材管理、团队协作与持久任务队列。

支持本机图片和视频处理，并提供外部模型、支付、登录及邮件服务的适配。当前实现、验证与未完成项见[本轮状态](reviews/takeover/STATUS.md)和[逐项范围台账](reviews/takeover/scope-ledger.json)。外部服务需要自行配置和联调；[旧交付说明](交付说明.md)与[旧功能矩阵](delivery-feature-matrix.md)保留为历史材料，不代表本轮已通过验收。

## 本轮前端体验

新版以“图片创作、视频创作、商品详情页”三入口开始；详情页分为“准备商品 → 确认方案 → 生成与导出”。任务、项目与素材可以找回、复用与下载。使用入口、测试顺序和验收边界见[本轮交付记录](reviews/frontend-rebuild-20261030/DELIVERY.md)，过程见[执行记录](reviews/frontend-rebuild-20261030/PLAN.md)。

仅体验交互、无需真实模型时，可在 `platform/` 运行 `pnpm dev:experience`，打开终端显示的本机地址（默认53820）。账号为 `preview@example.local`，密码为 `PreviewStudio2026!`。每次启动创建独立测试数据库，所有生成服务均替换为本机模拟，明确标记的模拟产物用于验证流程，不代表真实模型效果。该模式不会加载正式模型配置。

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

如果启动文件经下载或系统共享传入，首次双击可能出现无法验证开发者的提示。这是系统对外部来源可执行文件的检查，与网页应用架构无关。确认文件来源后，可按[苹果官方首次打开说明](https://support.apple.com/zh-cn/102445)允许该文件运行；系统通常会记住这次授权。

使用自己的数据和模型前，请阅读[配置与运行说明](platform/README.md)。

## 项目内容

- [应用源码与启动说明](platform/README.md)：前后端、任务执行器、数据库迁移和测试。
- [架构设计](specs/architecture.md)：技术选型与模块边界。
- [原创素材说明](design-assets/README.md)：演示图库的素材来源。
- [本轮验收状态](reviews/takeover/STATUS.md)：当前进度、逐项证据与真实阻塞；[旧验收记录](reviews/phase-6.md)仅供追溯。

本仓库保留项目提交历史。数据库、私有媒体、真实密钥、依赖、构建产物、本机压缩包及第三方调查材料不纳入版本管理。
