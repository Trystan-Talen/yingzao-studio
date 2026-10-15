# SMTP 持久通知设计与自评

2026-10-14。当前实现边界：已有团队邀请事务；工单回复由 BusinessService 写入；申诉审核同事务写站内 notifications。默认仅站内/复制链接，现补标准 SMTP 传输。此轮仅本机假 SMTP，不向真人发信。

## 决策

- 默认关闭：明确 SMTP_ENABLED=true 且配置合法才排队；开启不补发历史事件。实际邀请/新回复/新站内通知发生时，调用同步 enqueue 方法并与来源写入共用 SQLite 事务。worker 是唯一发送进程；每个实例单并发、数据库原子 claim 防止多 worker 抢同一事件。
- 入队 API 只接受实际来源 ID，读取权威 DB 收件人，不提供任意邮件发送接口。邀请链接验证为部署 publicOrigin 下 /invite 的 token fragment；令牌只出现在 AES-256-GCM 加密 payload，AAD 绑定行 ID/空间/事件。正文及收件人不进入状态 DTO、日志、审计。
- 模板采用固定主题与转义 HTML、纯文本，不把工单正文/申诉理由复制进邮件；引导登录查看。只有邀请包含一次性链接。每次发送前核对邀请未撤销/未使用/未过期、成员仍有来源权限、空间未归档。
- 状态 queued → sending → accepted / retry / failed / reconciliation_required / cancelled。accepted 仅代表 SMTP 接受，不代表最终送达。显式 4xx 和可确认提交前连接失败指数退避，固定最多 5 次；5xx 永久失败；连接在 DATA 后断开或无可靠阶段信息时需人工核对。过期 sending 租约也需核对，绝不盲目重复发送。
- 重启可恢复持久队列；事件键唯一且重复 enqueue 不修改原内容。确定性 Message-ID 辅助查供应商日志，但不承诺 SMTP 恰好一次。操作员凭服务商证据确认未接受后才可重排，所有动作有审计；累计尝试不清零。
- 生产只允许 TLS（implicit/STARTTLS，证书验证开启）；本机假 SMTP 的不加密模式仅接受非生产 127.0.0.1/::1 字面地址。禁用 Nodemailer 原始日志、URL/文件内容访问。凭据只读环境，不存 DB。
- 停用后不 claim、不发新邮件；已经进行的 SMTP 事务不可撤回。已接受/取消的敏感 payload 清空，保留去重和状态审计。未决/失败行需保留加密 payload 供人工处理；密钥备份与保留策略记录在运营文档。

## 自评门禁

设计可进入实现。主要失败模式有明确处理：来源事务回滚、重复事件、过期邀请、撤销/权限变化、并发 claim、4xx/5xx、DATA 接受后断线、进程死亡、禁用发送、密钥错误、凭据/正文泄漏。实现必须以真实本机 TCP SMTP + SQLite 测试证明，不能把 mock sendMail 当协议验证。商业邮件接入仍需部署域名、发信授权及实际 SMTP 账户；本轮不做外发。

依据：[官方 SMTP 配置](https://nodemailer.com/smtp)、[官方错误字段](https://nodemailer.com/errors)、[官方消息配置](https://nodemailer.com/message)。2026-10-14 npm 官方 registry 查询 nodemailer=10.1.1、@types/nodemailer=8.0.2；安装由根代理统一执行。

## 实现复评（2026-10-14 09:30 UTC）

实现已落 `platform/src/server/notifications/{config,message,outbox,worker,routes}.ts`、`scripts/mail-outbox-admin.ts` 和正式不可修改迁移 `0017-mail-outbox.sql`。根已接 `createServices` / core hooks / worker / commerce-admin。默认 SMTP 关闭，不产生历史回补。记录接口通过同空间管理权限并拒绝 API key。核对命令限本安装首位管理员，与商业运营保持一致。

实跑 `pnpm exec vitest run tests/mail-outbox.test.ts`：**22/22 通过**（09:29:23 UTC；包含本机真实 TCP）。集成案例使用真实 `createServices`，证明邀请自动入队、工单他人回复自动入队、队列写入失败邀请/回复事务整体回滚、disabled 保留业务成功但不写邮件队列。队列/传输其余失败路径见测试和 OPERATIONS-MAIL.md。当前全仓 `tsc --noEmit` 通过；本目录、CLI、测试 ESLint 通过。

自评通过，可合入最终构建/回归。仍未做生产 SMTP 账户验证、真实发信、退信收取或收件箱到达验证；accepted 只表示 SMTP 服务器接受。UI 由前端代理另行实际浏览器验收，本报告不把组件代码当作浏览器通过证据。人工恢复命令仅改状态，重排可能被正在运行的 worker 立即发送，运营文档已明确。

最终硬化与重跑（09:33:54 UTC）：增加邮件链接 PUBLIC_ORIGIN 必须为无用户信息/路径/query/hash的规范HTTP(S)来源，生产外部域名必须HTTPS；对应回归后 **23/23通过**。0017迁移内容冻结，SHA256 `4f15fa307727f13d08fead63a61b2d31234ee2db4c91cc274eae968a80306396`。本机假SMTP含测试身份均为example.test，无外部真实邮件。
