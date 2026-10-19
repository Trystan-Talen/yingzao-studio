# 映造 Studio

面向电商图片与视频创作的本地应用。业务和文件真实保存，数据库继续使用 SQLite（嵌入式数据库）。2026-10-19 接手交付的当前事实见 [本轮状态](../reviews/takeover/STATUS.md) 与 [逐项范围台账](../reviews/takeover/scope-ledger.json)；上一级 `交付说明.md`、`delivery-feature-matrix.md` 保留为历史交付，不能代替本轮验收。外部模型效果和运营服务尚未全部验证。

## 本机快速体验

macOS 可直接双击项目上一级目录中的 **`启动映造.command`**，自动检查依赖、启动前端/API/任务服务并打开浏览器。已有服务正常运行时会直接复用。请保持启动窗口打开；按 Ctrl+C 或关闭窗口可停止本次启动的服务，SQLite 数据会保留。

需要 Node.js（运行时）22.12 至 22.x 或 24 以上版本、pnpm（包管理器）11，以及视频处理用的 FFmpeg/ffprobe（媒体处理工具）。本轮本机使用 22.23.1、11.25.0；准确支持范围以 `package.json` 为准。默认前端 **5174**、接口服务 **4310**。

```sh
cd platform
pnpm install --frozen-lockfile
pnpm seed-demo
pnpm seed-demo-assets
pnpm dev:demo
```

打开 <http://127.0.0.1:5174>。演示账户：`demo@example.local`，密码：`DemoStudio2026!`。演示数据独立保存在 `var/demo.sqlite` 与 `var/demo-media`，上述种子可重复运行。页面中的八张原创灵感是明确标记的示例，不是应用已调用模型生成的结果。演示额度是本地测试预算，不是现金或外部供应商余额。

`pnpm dev:demo` 同时启动 API、任务 worker 与前端；Ctrl+C 关闭这三个进程。前端与 API 支持开发热更新，worker 代码变更后需重启命令。

上述种子与演示启动只用于演示数据。对已有用户库先做一致性备份，不运行种子来修复问题。`scripts/dev.ts` 会选择自己的数据路径；验证恢复副本或自定义隔离目录时，直接以明确的 `DATABASE_PATH`、`STORAGE_DIR` 启动 `node --import tsx src/server/main.ts` 与 `node --import tsx src/worker/main.ts`，不要经演示启动器覆盖路径。

## 使用自己的数据与模型

```sh
cp .env.example .env
pnpm dev
```

保持 `DEMO_MODE=false`，首次从本机浏览器注册管理员，默认使用 `var/app.sqlite` 和 `var/media`。之后的注册遵循邀请或管理员启用的推荐规则。空间之间独立隔离。默认没有现金订单、模型密钥、赠送额度或伪造任务结果。

在「设置 → 模型服务」配置该空间的 OpenAI / fal / Flyelep（模型供应商）或 Tikhub（视频链接解析供应商）密钥，或在 `.env` 配置安装级密钥；工作空间配置优先。密钥保存在后端，经 AES-256-GCM（认证加密算法）加密，前端只能看到末尾提示。模型可用性由实际适配能力和密钥共同决定；“已连接”不代表外部生成质量已验收。

- OpenAI：图片生成/编辑、白底与电商物料、局部重绘、图片翻译、OCR、文案帮写等。
- fal：Wan 视频生成、Kling 首尾帧和多参考生成、视频编辑、延长/放大/口播翻译、抠图、4×放大和透明图层拆分。具体模型约束显示在表单中。
- Flyelep：已按公开 API 文档实现相应图片任务；引用素材时需要外部可访问的 HTTPS `PUBLIC_ORIGIN`。
- 本机：真实图片缩放、格式转换、长图拼接、视频裁剪；不依赖外部模型。
- 抖音与国际版抖音链接：通过明确配置的解析供应商导入视频，另行确认内容授权及解析费用；解析成功但媒体下载失败也可能收费。小红书解析缺少可核验服务合同，当前明确拒绝，用户可上传有权使用的文件。

创作草稿按用户、空间、项目、图片/视频分别保留；提交结果未知时先点“核对提交结果”，避免再次调用模型。进入画布默认收起创作区，可展开找回需求；画布自动保存、历史版本和创作草稿分别记录。生成产物可在作品区查看、对比或作为参考继续创作。

所有外部模型的合同测试与真实联调是分开的。当前交付的外部模型未使用付费密钥实际生成，详见上级目录的功能验收矩阵。配置密钥后提交会请求相应供应商，费用以供应商为准；应用显示的额度是部署者制定的内部预算单位。

## 支付、额度与正式运营配置

Stripe Checkout、订阅和签名 Webhook 已实现。需要同时配置 `STRIPE_SECRET_KEY` 与 `STRIPE_WEBHOOK_SECRET`，回调地址为 `/api/v1/billing/stripe/webhook`。只以服务端验签的付款事件入账，浏览器跳转不能将订单变成已付款。演示模式仅接受 Stripe 测试密钥，真实付款只允许正式批准的套餐。事件、重复回调、退款及争议保留审计；争议冻结后续付费任务，需要运维人工核对解除。

额度按来源和有效期分桶；会员到期封存、有效续费恢复、额度包延长和原来源退款有独立审计。无文字图片翻译保留原件并释放平台预留，可选强制翻译；文字预检本身可能产生供应商费用。导出水印通过 `EXPORT_WATERMARK_MODE=off|all|non-subscribers` 配置，会员豁免由服务端当前订阅决定，演示空间豁免。水印作用于应用导出，不是防止修改客户端的保护措施。

网页与开放接口使用独立额度账户：旧余额保留在网页渠道，接口渠道从 0 开始，不能因网页有余额就视为接口可用。新增固定期会员、活动价格及推荐规则必须显式配置并批准；当前规则、迁移冻结状态和外部未验范围见本轮状态，不复制原站价格作为本部署承诺。测试与正式支付须使用不同数据库，启用支付后的环境绑定用于防止测试付款污染正式权益。

已经由验签回调绑定的 Stripe 订阅订单可查看服务商账单及 PDF；它是支付账单，不代表本地税务发票已开具。

管理员可用 `pnpm create-redemption <额度>` 创建一次性本地额度兑换码。正式套餐、推荐计划、权益、申诉及支付风险管理使用 `pnpm exec tsx scripts/commerce-admin.ts --help`，完整命令、输入 schema 与流程见 [OPERATIONS-COMMERCE.md](OPERATIONS-COMMERCE.md)。管理命令要求显式选择 `DATABASE_PATH`。这些命令只适用于管理自己的部署，不能修改外部供应商余额。

正式税务开票尚无服务商适配及可核验协议，本地申请记录不能代替开票。短信/微信登录已接通协议、账户流程及隔离测试，默认关闭，配置与未完成的真实服务验收见 [身份服务运维](OPERATIONS-IDENTITY.md)。普通人物参考的自述授权记录不能替代身份核验。

帮助页的本实例客服与外部问卷在环境配置中设置：`SUPPORT_PHONE`（联系电话）、`SUPPORT_HOURS`（服务时间）、`SUPPORT_WECHAT_QR_URL`（微信二维码图片）、`SUPPORT_FEEDBACK_URL`（反馈问卷）、`SUPPORT_GUIDE_URL`（使用指南）。默认留空并显示未配置，不使用原站联系方式。链接必须使用不含账户凭据的加密网页地址；这些字段会展示给登录用户，不可填入秘密。二维码只在用户点击查看后加载，问卷在新标签页打开；本地工单仍是独立记录，不代表已联系外部客服。

Google OIDC 登录和显式账户关联已实现，默认关闭，配置与真实联调步骤见 [OPERATIONS-GOOGLE.md](OPERATIONS-GOOGLE.md)。不会自动把同邮箱的 Google 身份并入本地账户；Google-only 账户不能解除唯一登录方式。

密码找回和仅谷歌账户设置本地密码见 [密码服务运维](OPERATIONS-PASSWORD.md)。找回默认关闭，使用一次性令牌与加密邮件队列；敏感修改会撤销旧会话。安装管理员在第 0027 号迁移后固定为不可变记录，不再随用户创建时间或编号排序改变；旧库的首用户推导来源保留标记。

SMTP 持久邮件队列已实现，默认关闭；实际邀请、工单回复与站内通知在来源事务内入队，由独立 worker 投递。状态页区分排队、SMTP 接受、失败与待核对；接受不等于最终送达。配置、重试和人工核对见 [OPERATIONS-MAIL.md](OPERATIONS-MAIL.md)。本轮只用本机假 SMTP 验证，没有真实外发。

## 构建与运行

```sh
pnpm typecheck
pnpm lint
pnpm format:check
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
# 演示数据库必须显式指定路径，避免现有环境配置指向其他库
DATABASE_PATH=var/demo.sqlite STORAGE_DIR=var/demo-media DEMO_MODE=true pnpm backup
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
- `src/server/auth/password`、`src/server/auth/identity`：一次性密码恢复、短信挑战、微信关联与独立加密发送队列。
- `src/server/notifications`：加密 outbox、SMTP 投递、来源复核与退避恢复。
- `src/worker`：独立执行器，租约与 fencing 防止旧进程重复回写。
- `migrations`：只追加的 SQLite 迁移；`scripts`：种子、启动、备份与管理命令。
- `tests`：隔离临时数据库、真实文件处理与显式外部服务协议夹具。

TypeScript 严格模式，服务端重复校验权限和输入。异步结果记录画布版本，发生冲突时进入待应用区；不能覆盖用户正在编辑的内容。任务报价一次性消费，成功项结算、失败项释放，未知外部状态保留待核对，不盲目重提。

登录后可在 `/api/docs` 查看 OpenAPI；API Key 支持空间和权限范围、到期/撤销、额度上限。健康检查使用 `pnpm health`。

`pnpm verify:runtime` 使用临时数据库、随机端口和临时密钥启动实际构建产物，检查 HTML/JS、首次注册、生产 Cookie、API/worker 共同迁移，并关闭进程和清理临时数据。它不会读取模型密钥、调用供应商或修改演示数据库。`pnpm test` 的合同夹具也不是实际模型效果证明。

浏览器验收执行 `pnpm test:e2e`。首次需要将测试浏览器安装到独立目录：`PLAYWRIGHT_BROWSERS_PATH=var/tools/playwright pnpm exec playwright install chromium`，并确保媒体工具在命令搜索路径中。脚本先构建，再为每个用例建立临时数据库、媒体与本机端口，阻止浏览器外网请求，报告保存在忽略的 `var/e2e/`。失败追踪可能含隔离测试会话；公开证据只归档审阅过的报告、诊断和虚构样本截图，不提交配置、数据库或私有媒体。
