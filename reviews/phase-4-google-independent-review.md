# Google OIDC 实现独立审查

2026-10-14。评审对象：`src/server/auth/google/{gateway,service,routes,types}.ts`、`src/contracts/google-auth.ts`、core/auth 的可信注册与 local_password_enabled、0016迁移、app 集成、前端 GoogleAccount。测试由实现作者运行，本次独审读取其测试用例而不把未跑真实 Google 标作联调通过。

## 结论

核心安全边界符合当前规格，可进入根最终集成回归；真实 Google 控制台配置/浏览器授权/生产回调仍未验证，不可声称已完成外部登录联调。微信/短信适配仍未实现，不因 Google 完成就写成所有登录方式已支持。

## 核对证据

- 请求只访问固定 Google discovery/token/JWKS；发现文档必须与已知官方端点一致。所有 fetch 拒绝重定向、10秒超时和响应大小上限。JWKS 只允许 RSA签名key，拒绝重复kid/私钥字段；token header 不允许 jku/jwk/x5u 改取钥匙地址。
- jose 验证 RS256签名、audience、issuer、exp与maxTokenAge，额外验证已验证邮箱的布尔true、nonce常量时间对比、iat与本次flow时间、azp/多aud规则。未知kid仅从固定官方JWKS更新。ID token/access token/refresh token不持久化。
- 256位随机 state、nonce、浏览器cookie和PKCE verifier，S256 challenge。state/browser仅摘要入库，nonce/verifier/邀请上下文AES-GCM加密。cookie HttpOnly/SameSite=Lax/生产Secure，绑定callback路径。
- callback先在SQLite事务消费flow并清除加密内容，再交换授权码；重放、并发callback、错浏览器、过期拒绝。失败需重新开始，不自动重复code exchange。
- 身份主键为issuer+sub，绝不按相同邮箱自动合并。新账户沿用首次本机owner/公开注册开关/有效邀请/推荐规则及席位限制；新建Google-only账户显式local_password_enabled=0，密码登录拒绝。已绑定用户接受邀请仍核对本地受邀邮箱。
- 关联/解除须原账户有效会话+立即密码确认；关联回调绑定同一已确认session并重查未撤销。唯一Google登录方式不能解除；解除其他session撤销。关联不会覆盖本地邮箱或别人的sub。
- 所有start/link/unlink同源POST且限流，callback仅固定站内303目标；客户端只接受accounts.google.com HTTPS授权地址。邮箱/密钥/授权码不回显为错误详情。

## 发现与修复

G1（P2，集成安全头）：Google callback设置`Referrer-Policy: no-referrer`，原全局app.onSend无条件覆盖为same-origin，使授权query可能进入同源后续Referrer。已报告根；当前源码修成仅在尚无策略头时写默认，正常callback策略得以保留。根将添加真实createApp的303响应头回归（本独审未替根宣称已完成）。建议callback被限流等前置拒绝时同样按路径保持no-referrer。

未发现其他需阻断本轮本地集成的P0/P1。当前代码阅读证据不替代生产密钥、Google consent screen、redirect URI精确注册、真实取消/成功/域名变更的外部验收。

作者最终证据：`tests/google-oidc.test.ts` 29项本机HTTP/RSA/SQLite通过（实现作者回报）；`platform/OPERATIONS-GOOGLE.md`、`specs/google-oidc-architecture.md`。0016正式迁移SHA256：5638c84bfb0db79c23de3f8e51552cd5112ca0ee7283cfdfc098294681862015。Google-only本地密码恢复和Google风险推送尚未实现，已在运营文档与矩阵明确。
