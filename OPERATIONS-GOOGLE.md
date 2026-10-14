# Google 登录部署与验证边界

适配器已实现 Google Authorization Code + PKCE、官方发现与 JWKS 签名验证、本地邀请/推荐注册、显式关联和解除。默认关闭。本机合同测试不等于真实 Google 项目、同意屏幕、浏览器和用户账户的端到端验收。

## 启用

1. 先在本机完成首位管理员的密码注册；Google 无权创建安装的首位管理员。
2. 在你拥有的 Google Cloud 项目配置 OAuth 同意屏幕和 Web application 客户端。登记准确回调地址 `PUBLIC_ORIGIN/api/v1/auth/google/callback`。默认开发值为 `http://127.0.0.1:5174/api/v1/auth/google/callback`；正式部署使用 HTTPS。地址、主机名、端口必须与配置及浏览器访问地址一致。
3. 仅在服务端设置 `GOOGLE_OIDC_ENABLED=true`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。不要向前端、截图、工单或日志粘贴 secret。稳定保存 `ENCRYPTION_KEY`，它保护短期登录流程中的 PKCE verifier 和邀请上下文。修改该密钥会使未完成流程失效，既有身份绑定不受影响。
4. 执行正常迁移并重启服务。`0016-google-oidc.sql` 创建 Google 身份和流程表；后续 `0018-google-local-password.sql` 为旧用户设置 `local_password_enabled=1`，新增的 Google-only 用户在注册事务内设为 0。已应用的迁移文件不得修改。已有 0016/0017 的安装通过追加 0018 升级，不删除数据或重写校验记录。
5. `GET /api/v1/auth/google/status` 返回能力状态；只有 `available=true` 时才能发起登录。配置齐全仅表明本地适配器可以发起，并不证明 Google 项目已授权生产使用。处于 Google 测试模式时，按照其项目规则配置测试用户。

正式启用前，用独立测试用户验证 Google 同意/拒绝、首次邀请注册、已关联用户再登录、同邮箱已有本地用户拒绝自动合并、显式关联及解除。该验证需要部署所有者的 Google OAuth 配置；本项目未实际绑定任何真实 Google 账户。

## 身份与操作

- 身份键为 Google issuer + sub。邮箱只作为验证后的资料和邀请匹配依据，绝不因为邮箱相同自动关联旧账户，也不自动修改本地邮箱。
- 新用户必须满足本地既有注册政策：有效且邮箱匹配的团队邀请，或运维已启用的推荐注册。邀请消费、席位限制、成员预算、个人空间、推荐归因与外部身份共同事务提交，失败全回滚。
- 已有本地用户在设置中输入当前密码，发起明确关联。回调必须在五分钟内、使用同一有效会话和浏览器绑定；网络交换前后都会验证会话。
- 解除需要本地密码确认并撤销其它登录会话。Google-only 用户没有可用本地密码，因此不允许删除唯一登录方式。本轮没有密码恢复或 Google-only 转本地密码流程，不能把运维直接改库当成已实现功能。
- 登录成功签发本地会话；之后 Google 密码变更或撤销 Google 授权不会即时撤销既有本地会话。本地会话按项目的到期/退出/撤销规则执行，未实现 Google Cross-Account Protection 风险事件集成。
- 同一浏览器同时发起多个登录流程时，最后一次的绑定 Cookie 生效。网络中断、回调重复或过期均需重新发起。

## 协议与安全边界

只请求 `openid email profile`，不请求离线授权，不持久保存 Google access token、refresh token 或 ID token。state 和浏览器绑定仅存 hash；nonce、PKCE verifier、邀请/推荐上下文用 AES-GCM 加密，绑定 flow ID。流程十分钟有效，关联五分钟；回调在远端交换前原子消费。签名仅接受 RS256，验 issuer、audience、必要的 azp、时间、nonce、sub、`email_verified=true`，JWKS 限制来源、响应大小和刷新路径。

固定官方 discovery、授权、token 和 JWKS 地址，不接受用户自定义地址；固定本站回跳，不接收 `returnTo`。发起/关联/解除要求同源 POST，回调依赖 state 与 HttpOnly SameSite=Lax 绑定。部署反向代理、访问日志及监控也必须隐藏回调 query、Cookie 和密码；应用禁用默认请求日志并在回调使用 `Referrer-Policy: no-referrer`。生产 Cookie 使用 Secure，因此不要以生产模式通过普通 HTTP 验收。

Google `email_verified` 不等于本产品已进行实名或第三方邮箱当前所有权认证。人物形象授权、FACE 核验、邮件交付均是独立功能。

## 合同测试

`pnpm exec vitest run tests/google-oidc.test.ts`：30 项，以本机 HTTP 服务、独立 RSA 私钥、真实 JOSE 验签及临时 SQLite 验证，不访问 Google，不使用真实账户。

覆盖官方请求表单与 PKCE、发现端点替换、JWKS 轮换、错签名与 claims、state/nonce/浏览器绑定、重放与并发消费、闭注册与邀请回滚、同 subject 唯一身份、推荐归因、邮箱接管防护、Google-only 禁止本地密码及解除、关联会话撤销前后与五分钟时限、固定重定向及 secret 不泄露。另覆盖已应用原始 0016/0017 的旧库升级至 0018，旧密码哈希、身份绑定、成员和原迁移校验记录保持不变，重复执行幂等且旧密码可登录。TSC 和相关 ESLint 通过。

参考：[Google OIDC 文档](https://developers.google.com/identity/openid-connect/openid-connect)、[Google 官方发现文档](https://accounts.google.com/.well-known/openid-configuration)。
