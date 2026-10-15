# Google OIDC 实施自评

2026-10-15，范围为 `platform/src/server/auth/google/**`、`src/contracts/google-auth.ts`、冻结迁移 0016 与后续 0018、合同测试及部署文档。根代理负责核心认证复用接口、配置、应用注册与全局响应头；UI 代理负责登录/设置入口。此文件是实现者自评，独立评审由另一代理执行。

## 结果

没有剩余已确认的 P0/P1 问题。适配器完成实际 Authorization Code + S256 PKCE、官方 discovery/JWKS、RS256 签名及 claims 校验、数据库持久一次性流程、原子邀请注册、同邮箱拒绝自动合并、显式密码确认关联、解除与其它会话撤销。新 Google-only 用户明确禁用本地密码。

原先 29 项定向合同通过，但只测试新建数据库，未覆盖实际已应用初版迁移的升级。根代理随后发现真实交付故障，经过下述迁移修复，30 项全部通过，TypeScript 全量检查及相关 ESLint 通过。合同使用本机 HTTP 服务、动态生成 RSA 密钥、真实 JOSE 签名验证、独立 SQLite，不调用真实 Google、绑定真实用户或发送邮件。

重点复核：两个相同 callback 并发只有一次远端交换；同一 sub 的不同合法流程不会产生多个身份/用户；邀请不匹配、已用邀请及席位限制不能留下半注册记录；错误 nonce/issuer/aud/azp/签名/时间/verified 均不能创建身份；会话在远端请求期间撤销也不能关联；Google-only 即使存在已知匹配 scrypt 哈希也不能以本地密码登录。

## 集成门禁

- 0016 已恢复为运行库已应用的原始内容，SHA256 `e7b91321611346c4f1c07afe270d317ea66a60dbd7d4970eb8de6ff9d5723ed8`；追加 0018 的 SHA256 为 `41002223e225d08f8813256669c0e0c277a7f98ac406e6c5d5f4735ecc478535`。旧用户保留本地密码，不修改额度/账本。
- 应用需注册 Google service/routes，默认禁用。`hasLocalPassword` 已加入共享状态契约并交 UI。
- 回调全路径包括限流等 handler 前失败都须 `Referrer-Policy: no-referrer`。发现现有全局头覆盖后已交根代理修复并补集成测试；仅独立路由测试不能代替此项集成验收。
- 正式 OAuth 配置后的真实浏览器端到端联调仍未执行；配置存在仅意味着能够尝试，不能称为 Google 已验证可用。

## 明确限制

Google-only 用户暂无密码恢复/转本地密码功能，不能解除唯一身份。未实现 Google 风险事件推送，既有本地会话按本地生命周期管理。网络交换失败或服务重启发生在已消费流程后，需要重启登录，不重用授权码。单浏览器同时开启多个流程以最后绑定 Cookie 为准。反向代理及外部日志系统需自行隐藏回调 query/凭据。

部署和正式验收步骤见 `platform/OPERATIONS-GOOGLE.md`；方案与官方资料见 `specs/google-oidc-architecture.md`。

## 实际升级故障及修复记录

根代理在重启实际 demo API 时发现 `Applied migration was modified: 0016-google-oidc.sql`。原因是 watch 进程在初版 0016 被改成草稿前已经应用；实现者后续将 `local_password_enabled` 的 ALTER 加入 0016，并错误地按“草稿尚未应用”冻结。这是本轮实际交付错误，不能以新库测试通过掩盖。此前记录的 `5638c84b...` 是错误修改后的 0016 校验值，不再作为有效冻结值。

根代理只读确认已应用 SHA256 为 `e7b91321611346c4f1c07afe270d317ea66a60dbd7d4970eb8de6ff9d5723ed8`，用户表没有新列。实现者移除后加的首行，恢复字节完全一致的原始 0016，把该 ALTER 原样放入新增 0018。没有修改运行库 checksum、删除用户或重置 demo 数据。

新增升级回归先运行原始 0016/0017，创建旧用户及 Google 绑定，再执行全量迁移两次。断言旧用户所有字段/密码哈希不变，仅新增 flag=1；身份和成员数据保留；0016 的 checksum/applied_at 均未改；0018 按固定校验值记录一次；原密码仍能登录。实际 demo 迁移/重启由根代理统一执行并验证。
