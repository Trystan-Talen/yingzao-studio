# 映造 Studio

面向电商图片与视频创作的本地应用。重新设计了导航、灵感、创作工作台、素材、工具、团队与账户界面；业务和文件真实保存，数据库为 SQLite。当前交付及尚未完成的原站对等功能见上一级 `交付说明.md` 与 `delivery-feature-matrix.md`，不是所有外部服务均已开通的商业运营实例。

## 本机快速体验

macOS 可直接双击项目上一级目录中的 **`启动映造.command`**，自动检查依赖、启动前端/API/任务服务并打开浏览器。已有服务正常运行时会直接复用。请保持启动窗口打开；按 Ctrl+C 或关闭窗口可停止本次启动的服务，SQLite 数据会保留。

需要 Node.js 22.12+（已使用 22.22.3 验证）、pnpm 11，以及视频处理用的 FFmpeg/ffprobe。本项目不占用 5173，默认前端 **5174**、API **4310**。

```sh
cd platform
pnpm install --frozen-lockfile
pnpm seed-demo
pnpm seed-demo-assets
pnpm dev:demo
```

打开 <http://127.0.0.1:5174>。演示账户：`demo@example.local`，密码：`DemoStudio2026!`。演示数据独立保存在 `var/demo.sqlite` 与 `var/demo-media`，上述种子可重复运行。页面中的八张原创灵感是明确标记的示例，不是应用已调用模型生成的结果。演示额度是本地测试预算，不是现金或外部供应商余额。

`pnpm dev:demo` 同时启动 API、任务 worker 与前端；Ctrl+C 关闭这三个进程。前端与 API 支持开发热更新，worker 代码变更后需重启命令。

## 使用自己的数据与模型

```sh
cp .env.example .env
pnpm dev
```

保持 `DEMO_MODE=false`，首次从本机浏览器注册管理员，默认使用 `var/app.sqlite` 和 `var/media`。之后的注册遵循邀请或管理员启用的推荐规则。空间之间独立隔离。默认没有现金订单、模型密钥、赠送额度或伪造任务结果。

在「设置 → 模型服务」配置该空间的 OpenAI / fal / Flyelep 密钥，或在 `.env` 配置安装级密钥；工作空间配置优先。密钥保存在后端，经 AES-256-GCM 加密，前端只能看到末尾提示。模型可用性由实际适配能力和密钥共同决定；缺配置时在报价前拒绝，不模拟生成。

- OpenAI：图片生成/编辑、白底与电商物料、局部重绘、图片翻译、OCR、文案帮写等。
- fal：Wan 视频生成、Kling 首尾帧和多参考生成、视频编辑、延长/放大/口播翻译、抠图、4×放大和透明图层拆分。具体模型约束显示在表单中。
- Flyelep：已按公开 API 文档实现相应图片任务；引用素材时需要外部可访问的 HTTPS `PUBLIC_ORIGIN`。
- 本机：真实图片缩放、格式转换、长图拼接、视频裁剪；不依赖外部模型。

所有外部模型的合同测试与真实联调是分开的。当前交付的外部模型未使用付费密钥实际生成，详见上级目录的功能验收矩阵。配置密钥后提交会请求相应供应商，费用以供应商为准；应用显示的额度是部署者制定的内部预算单位。

## 支付、额度与正式运营配置

Stripe Checkout、订阅和签名 Webhook 已实现。需要同时配置 `STRIPE_SECRET_KEY` 与 `STRIPE_WEBHOOK_SECRET`，回调地址为 `/api/v1/billing/stripe/webhook`。只以服务端验签的付款事件入账，浏览器跳转不能将订单变成已付款。演示模式仅接受 Stripe 测试密钥，真实付款只允许正式批准的套餐。事件、重复回调、退款及争议保留审计；争议冻结后续付费任务，需要运维人工核对解除。

额度按来源和有效期分桶；会员到期封存、有效续费恢复、额度包延长和原来源退款有独立审计。无文字图片翻译保留原件并释放平台预留，可选强制翻译；文字预检本身可能产生供应商费用。导出水印通过 `EXPORT_WATERMARK_MODE=off|all|non-subscribers` 配置，会员豁免由服务端当前订阅决定，演示空间豁免。水印作用于应用导出，不是防止修改客户端的保护措施。

已经由验签回调绑定的 Stripe 订阅订单可查看服务商账单及 PDF；它是支付账单，不代表本地税务发票已开具。

管理员可用 `pnpm create-redemption <额度>` 创建一次性本地额度兑换码。正式套餐、推荐计划、权益、申诉及支付风险管理使用 `pnpm exec tsx scripts/commerce-admin.ts --help`，完整命令、输入 schema 与流程见 [OPERATIONS-COMMERCE.md](OPERATIONS-COMMERCE.md)。管理命令要求显式选择 `DATABASE_PATH`。这些命令只适用于管理自己的部署，不能修改外部供应商余额。

正式发票、短信/微信登录、人物身份核验、部分社交链接解析需要相应运营服务。普通人物参考的自述授权记录不能替代身份核验；本地发票申请不能替代正式税务发票。未连接的服务不会返回假成功。

Google OIDC 登录和显式账户关联已实现，默认关闭，配置与真实联调步骤见 [OPERATIONS-GOOGLE.md](OPERATIONS-GOOGLE.md)。不会自动把同邮箱的 Google 身份并入本地账户；Google-only 账户不能解除唯一登录方式。

SMTP 持久邮件队列已实现，默认关闭；实际邀请、工单回复与站内通知在来源事务内入队，由独立 worker 投递。状态页区分排队、SMTP 接受、失败与待核对；接受不等于最终送达。配置、重试和人工核对见 [OPERATIONS-MAIL.md](OPERATIONS-MAIL.md)。本轮只用本机假 SMTP 验证，没有真实外发。

## 构建与运行

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:runtime
# 两个终端分别启动；均在 platform 目录执行
NODE_ENV=production pnpm start
NODE_ENV=production pnpm start:worker
```

生产环境必须设置独立高熵 `SESSION_SECRET`、`ENCRYPTION_KEY`，禁止 `DEMO_MODE=true`。将 `PUBLIC_ORIGIN` 设置为用户访问的完整 HTTPS 源站；API 进程同时服务 `dist/web`。在本机验收构建时可设为 `http://127.0.0.1:4310`。公网部署需要正确的 HTTPS 反向代理与 FFmpeg 安装，本交付没有自动发布到公网。

数据库迁移在 API/worker 启动时自动执行，也可执行 `pnpm migrate`。迁移有校验和与事务锁；不要改动已经应用的 SQL 文件，新增后续迁移。两进程同启、迁移冲突、幂等与恢复均有回归测试。

## 数据备份与恢复

```sh
pnpm backup
# 演示数据库请使用 DEMO_MODE=true pnpm backup
pnpm restore /完整/备份目录 /新的/恢复目录
```

备份包含 SQLite 一致性快照、原件与预览、密钥及清单。恢复检查数据库完整性、外键和文件存在性，并拒绝覆盖已有目录。停止目标实例后，将 `DATABASE_PATH`、`STORAGE_DIR` 和恢复目录 `keys.json` 中的两个密钥配置到新实例。备份含私有媒体与解密密钥，应按私有数据保管；不要提交 `var`、`.env` 或备份到 Git。

## 代码结构与约束

- `src/contracts`：Zod 输入/数据契约、能力枚举、画布模型。
- `src/web`：React 页面、公共交互、三语字典与 Fabric 编辑器。
- `src/server/core`：身份、空间权限、文件、项目/版本、素材、团队、商业与分享业务。
- `src/server/tasks`：报价、预算、持久队列、恢复、事件流与待应用结果。
- `src/server/providers`：按真实协议分离的模型与本地处理适配器。
- `src/server/billing`：Stripe、回调幂等、套餐与支付风险管理。
- `src/server/auth/google`：OIDC 发现、PKCE/JWKS、一次性流程及账户关联。
- `src/server/notifications`：加密 outbox、SMTP 投递、来源复核与退避恢复。
- `src/worker`：独立执行器，租约与 fencing 防止旧进程重复回写。
- `migrations`：只追加的 SQLite 迁移；`scripts`：种子、启动、备份与管理命令。
- `tests`：隔离临时数据库、真实文件处理与显式外部服务协议夹具。

TypeScript 严格模式，服务端重复校验权限和输入。异步结果记录画布版本，发生冲突时进入待应用区；不能覆盖用户正在编辑的内容。任务报价一次性消费，成功项结算、失败项释放，未知外部状态保留待核对，不盲目重提。

登录后可在 `/api/docs` 查看 OpenAPI；API Key 支持空间和权限范围、到期/撤销、额度上限。健康检查使用 `pnpm health`。

`pnpm verify:runtime` 使用临时数据库、随机端口和临时密钥启动实际构建产物，检查 HTML/JS、首次注册、生产 Cookie、API/worker 共同迁移，并关闭进程和清理临时数据。它不会读取模型密钥、调用供应商或修改演示数据库。`pnpm test` 的合同夹具也不是实际模型效果证明。
