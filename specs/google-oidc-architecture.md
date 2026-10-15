# Google OIDC 登录补充方案与开工自评

范围：新增可默认关闭的真实 Google Authorization Code + PKCE 适配器；不接触额度规则，不外发邮件，不实际绑定账户。正式 Google 联调与本机签名 token/HTTP 合同分开报告。

## 身份与注册

Google 身份唯一键为规范化 issuer + sub，不使用 email 作为身份键。同邮箱已有本地账户但没有该 sub 绑定时拒绝登录合并，提示先以本地密码登录后显式关联。关联开始必须有真实未撤销 cookie 会话和立即密码确认，流程最多五分钟；回调再次验证同一会话、同一用户和一次性 flow。关联不能覆盖已有其他 Google sub 或其他用户已有绑定；不自动修改本地邮箱。解除关联也需立即密码确认并撤销其它会话，避免仅凭旧登录态更改认证方式。

新 Google 用户只通过既有注册规则创建：合法且邮箱匹配的团队邀请，或管理员已启用的推荐注册；个人空间、邀请消费、席位/预算、推荐归因、外部身份、登录会话同事务提交。复用 AuthService.registerVerifiedProfile，同邮箱冲突仍拒绝。Google 不负责首位管理员引导，安装必须先完成本机密码注册。Google-only 账户保存随机高熵、用户未知的 scrypt 密码，不把 ID token/邮箱当密码；本轮不提供密码重置流程。

## 协议与请求

仅固定官方 discovery URL；发现文档 issuer、authorization/token/JWKS endpoint 必须匹配官方 HTTPS 端点，不允许环境覆盖到任意 URL。JOSE 负责 RS256 验签；校验 kid、issuer、audience、必要 azp、exp、iat、sub、nonce 和 email_verified=true。签名密钥仅来源官方 JWKS；拒绝 jku/x5u 等用户提供密钥地址。JWKS 按短时缓存并在未知 kid 时有限刷新，限制响应字节、网络超时和跳转。请求只要 openid email profile，不请求离线权限，不持久保存 access/refresh/ID token。

redirect_uri 固定为 PUBLIC_ORIGIN 的 /api/v1/auth/google/callback；成功只回 / 或 /settings?google=linked，失败只回 /login?google=error&code=安全错误码，不接收 returnTo。只允许规范 origin 配置；生产 HTTPS（本机开发 HTTP 例外）。开始/关联/解除使用 POST 和明确同源 Origin；Google 回调为 GET，使用 state 和浏览器 HttpOnly SameSite=Lax cookie 绑定防登录 CSRF，不沿用 Cookie 写入的 Origin 规则。

## 持久流程

0016 新增 external_identities、google_oidc_flows、external_identity_events；0018 追加 users.local_password_enabled，原用户默认 1，Google-only 注册在同事务设置 0。已应用 0016 原文保持不变。flow 随机 state 仅存 hash；随机浏览器绑定仅存 hash；nonce、PKCE verifier、可选邀请/推荐上下文 AES-GCM 加密并绑定 flow ID 作为 AAD。有效期最多十分钟；关联五分钟。回调在网络交换前原子消费 flow，失败或超时要求重新发起，不重放授权码；code/token 不保存、不输出日志。密钥更换使旧 flow 失效但不影响已建立身份。可清理过期 flow 的加密上下文，保留有限状态审计。

## 自评及验收门槛

方案避免邮箱自动关联、开放跳转、任意 issuer/JWKS 地址、重复 callback、注册规则旁路和一次 HTTP 200 冒充身份验证。权衡是网络中断需要重新登录、单浏览器同时打开两个流程时旧流程失效、Google-only 用户无法通过未实现的密码重置来解除唯一身份；这些都需如实说明。需要合同测试：官方发现和表单参数、PKCE、真实本机 RSA 签名/JWKS、错签名/issuer/aud/azp/nonce/时间/verified 拒绝、state/cookie/过期/重复、邀请事务/闭注册、邮箱碰撞、关联密码与撤销/过期会话、禁用、固定回跳和不泄露 token。

参考：[Google 官方 OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[官方发现文档](https://accounts.google.com/.well-known/openid-configuration)。本方案采用标准库验签；本机合同不是 Google 真实用户登录验收。
