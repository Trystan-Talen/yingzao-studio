# 最终后端独立复核

本轮只读生产代码并运行既有定向测试，没有修改生产实现、数据库或迁移。结论：本次复核范围内未发现 P0/P1；不是所有外部功能已实现或模型质量已真实验证的声明。

## 验证结果

`pnpm exec vitest run tests/tasks.test.ts tests/openai-provider.test.ts tests/export-policy.test.ts tests/entitlements-appeals.test.ts tests/app.test.ts tests/credit-lots.test.ts src/web/editor/export-bundle.test.ts`：7 files，86 tests 通过，28.95 秒。

- F15：OpenAI 的严格布尔预检拒绝错误结构；无文字结果保存原图和明确说明。缓存按 workspace、原图 SHA256、detector 版本隔离。同 worker 的多语言复用与重启后持久缓存都有测试。`StoredResult.billingDisposition` 写入 result_json，downloading 恢复保留免扣费语义。finish 仅允许 OpenAI 图片翻译使用该标记，成功记录与 release、资产、审计同一事务；重复恢复不二次扣减。`service.refresh` 根据不可变 settle 流水求实际结算，免扣费成功不按 item.credits 误算。
- F31：export-policy 路由鉴权、scope 检查并 no-store；来自 EntitlementService 的当前空间有效期、active 状态、已支付订单快照。客户端 hasActiveSubscription 参数无效。匿名分享从合法 token 所属空间重新计算相同政策，撤销后不可读取；配置变化可反映至后续导出。水印政策明确作用于应用导出，不是原件访问限制或防修改 DRM。
- F46：20 个来源专项测试均重跑通过。总余额 = 有效来源 remaining + 非有效来源 reserved；总 reserved = 来源 reserved；available = 全部有效来源未预留余额；本轮测试同时与 grant/settle/adjustment 流水净额对账。跨 UTC 到期、月底和闰日、到期在途成功/取消、封存恢复、退款回原期限、旧余额和预留迁移、迁移不一致回滚、真实两个进程争抢均有覆盖。无生产直接写总余额的旁路；0013 checksum 保持冻结。

## 非阻塞发现与建议补测

P2：`src/worker/runner.ts` 的 textChecks Map 只在单个 worker 内共享。两个独立 worker 同时处理同一 workspace/hash/detector 且数据库尚未缓存时，都可能调用预检供应商；INSERT OR IGNORE 只能去重保存，不能阻止两次远端收费。这不造成平台重复扣费或余额错误，但不能宣称跨 worker 的远端检测保证一次。需要严格降低预检成本时可加数据库短租约与失败恢复，或明确保持当前允许重复预检的成本边界。

建议以后新增的精确测试：不同 workspace 相同文件 hash 不能共享预检结果；两个 worker 同一 hash 的并发成本行为；一个 job 混合 waiver 与正常收费成功时 settledCredits 仅等于正常项；waiver 在来源到期后恢复仍归原来源（现有 lot 到期 release 与 waiver 恢复分别测试）。这些是组合覆盖增强，本轮未因此修改生产代码或扩展实现范围。

## 外部适配准确边界

已实现协议但仍需真实配置和联调：OpenAI、fal、Flyelep 当前 capability 中启用的图片/文本/视频端点，以及 Stripe Checkout/订阅/签名 Webhook。它们与下列“尚无实际 adapter”不同。真实验证还需供应商密钥、账户模型权限；URL 引用型供应商需要能访问受限签名媒体的 HTTPS 公网入口。当前本机合同测试不证明远端效果和实际收费。

真正需要用户确定业务服务及接口资料后完成适配：

- F35 正式身份/活体/人物素材认证：当前只有 IdentityProvider 注入契约，没有部署可用的 FACE adapter。需指定认证服务、地区、业务产品与素材授权证据约定；普通身份验证不能被自行当作人物素材使用授权。
- F48 正式税务开票：当前是本地申请和金额占用，没有开票 adapter。需确定税务地区、销售主体和开票服务及正式协议。Stripe invoice/PDF 不是可以自动当作任意地区税务发票的替代品。
- F20 抖音/TikTok/小红书社交内容解析：无实际解析器；需有授权的服务协议、支持平台/内容类型和媒体取回方式，不能只要求一个任意 API key。
- 微信与短信登录、短信外发、第三方客服：需指定平台产品、应用/签名模板和回调配置；对应 adapter 当前未实现。

可以先独立完成协议和本地合同、无需等待用户密钥的代码缺口（本轮遵守只审查要求，未实现）：

- Google OIDC：官方已定义服务端授权流程、state/nonce 和 token 身份校验，可先完成 callback、账户关联约束、取消/重放/无效签名合同；真实启用仍需用户 client ID/secret 与获准回调地址。代码里目前没有 Google/OIDC adapter。[Google 官方 OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
- 通用 SMTP 外发：可使用 Nodemailer 的标准 SMTP transport，先实现持久 outbox、模板、重试与本机 SMTP 合同，不应因尚无邮箱密钥停在空接口。真实外发仍须用户邮箱服务的 host/port/auth、发件身份以及明确外发授权；当前项目没有 SMTP adapter。[Nodemailer SMTP 文档](https://nodemailer.com/smtp)
- Stripe 官方订阅账单入口：现有 Stripe SDK 与 invoiceSchema 已有 hosted_invoice_url、invoice_pdf，可独立补服务端按空间/订单授权查询与真实链接展示。此增强应明确标为 Stripe 账单，不能冒充 F48 国内正式开票。[Stripe Invoice 对象](https://docs.stripe.com/api/invoices/object)

Flyelep 翻译和视频不能说“当前 adapter 已完整实现”：图片翻译的公开 schema 仍混入响应字段，视频查询只有短路径文字，研究已记录；这两项需要供应商澄清或明确预算下的实际协议验证。现有产品相应功能分别由 OpenAI / fal 实现，因此不是全平台功能入口缺失，但不是 Flyelep 全 API 等价支持。Flyelep 分层也主动关闭，实际图层适配为 fal Qwen。
