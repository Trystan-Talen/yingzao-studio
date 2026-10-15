# 标准外部适配补充复核

2026-10-14。本轮根代理补充 Stripe 账单读取、Google 共用注册入口、SMTP 业务事务与 worker 接线；独立子代理实现并自测 Google OIDC 和 SMTP 协议。未绑定真实第三方账户，未向真人发送邮件，未调用收费服务。

## Stripe 账单

按订单授权后，只查询签名 webhook 已绑定的 provider_invoice_id；不接受客户端指定任意服务商账单 ID。校验支付环境、金额、币种与服务商响应 ID。远端查询后再次验证空间管理员权限，防止等待过程中权限撤销。查看链接限定 HTTPS 的 invoice.stripe.com，PDF 限定 pay.stripe.com，不跟随或代理下载任意 URL。没有链接时呈现未提供，不伪造 PDF。

新增两项回归覆盖未绑定、跨空间、API Key 拒绝、非法域名/HTTP、空链接、金额不符、在途撤销权限；连同原计费、核心及商业工作流共 41 项通过。这里只提供 Stripe 订阅账单，不能冒充正式税务开票。[Stripe 官方 Invoice 对象](https://docs.stripe.com/api/invoices/object)。

## SMTP 独立代码复核

根已读取 config、outbox、worker、message 与 routes。默认关闭；仅配置后由实际邀请、站内通知、工单回复事件入队。源写入与入队共用事务。收件人来自授权业务数据，没有任意发送 API；发送前重查邀请和成员权限。TLS 及证书校验强制，明文仅限非生产本机测试实例，环境变量不能开启明文模式。

正文用 AES-GCM 加密，AAD 绑定事件/空间/行，模板转义用户提供的空间名，通知不复制工单私人正文。成功被 SMTP 接受后清除敏感 payload。状态接口仅管理员会话可读且不含邮件地址、正文或凭据。唯一事件键与事务 claim 防并发重复；已知 4xx 可退避，5xx 永久失败，DATA 后断线与过期租约转待核对，不自动宣称未投递。管理员核对依赖明确证据并保留审计，不提供一键无限重试。

未发现阻断性缺陷。SMTP accepted 只能证明服务商接受，不能证明进入收件箱；已经开始的网络事务不能因稍后撤销邀请而召回。默认关闭且本次测试只连接 loopback 假 SMTP，不存在真实外发验收。

## Google 独立代码复核

根已读取 gateway、service、routes：固定官方发现/授权/token/JWKS 端点；JOSE 验证 RS256、签名、iss、aud、azp、时间、nonce、verified email；响应大小与超时有界，不接收 token 提供的 jku/jwk/x5u。PKCE、nonce、浏览器绑定 state 均为独立高熵值；state 一次性消费，敏感上下文加密并在交换前清除。错误跳转不带 code/token 等原始供应商内容。

普通密码注册与外部邀请注册共用原有事务规则，不新增公开注册后门；首位管理员必须本机密码注册。同邮箱不静默合并，关联需即时密码确认和原会话复核；Google-only 账户明确没有可用本地密码，不能解除唯一登录方式。callback 使用固定路径、no-referrer；全局安全响应头尊重路由更严格的 referrer 设置。

最终作者测试、独立测试与集成回归数量以 phase-5.md 的最终命令结果为准。本报告不把代码审查替代真实 Google 应用配置、回调域名及用户授权流程验收。
