# SMTP 通知与持久投递运营

2026-10-14。此适配器发送团队邀请、他人对工单的新回复、已有站内通知的邮件提醒。默认关闭；已有可复制邀请链接和站内通知照常使用。本次开发验证仅运行在 127.0.0.1 本机假 SMTP，未向真人发信，也未验证某一家生产邮箱服务的最终送达率。

## 开启条件与配置

部署负责人明确取得发信账户和域名使用授权、确认事务通知用途后，配置以下服务器环境变量；普通工作空间成员不能设置 SMTP 或指定任意收件人。

| 变量 | 规则 |
| --- | --- |
| `SMTP_ENABLED` | 默认 `false`；只有显式 `true` 才入队和投递新事件 |
| `SMTP_HOST` | 发信服务器域名或 IP |
| `SMTP_PORT` | 默认 STARTTLS 为 587、implicit 为 465 |
| `SMTP_TLS_MODE` | `starttls`（默认）或 `implicit`；证书校验始终开启、最低 TLS 1.2 |
| `SMTP_FROM` | 单一发件邮箱；需已获 SMTP 服务允许 |
| `SMTP_FROM_NAME` | 默认映造 Studio，禁止换行 |
| `SMTP_USER` / `SMTP_PASSWORD` | 同时配置或同时省略（仅适用于服务商明确提供的可信 relay）；只存在环境内 |
| `ENCRYPTION_KEY` | 与应用同一部署秘密，保护队列消息；必须随备份安全保管 |
| `PUBLIC_ORIGIN` | 正确部署地址，邀请链接严格同源；生产部署使用 HTTPS |

关闭时不补队列，也不会在日后开启时补发旧邀请/历史通知。新事件创建与加密 outbox 写入在同一个 SQLite 事务内，失败共同回滚。发送进程运行 `pnpm worker` 或生产的 `pnpm start:worker`；API 本身只入队。关闭并重启全部 API/worker 后停止新的投递；已经交给 SMTP 的事务无法撤回。

不要在本轮演示安装真实 SMTP 凭据后向真人测试。之后第一次外部发送需要具体业务授权和受控测试收件地址；DNS/SPF/DKIM/DMARC、服务商限流/域名验证和退信接收配置由部署运营负责。没有回执或退信服务集成，不能把 `accepted` 当作收件箱送达。

## 真实业务路径

- 团队邀请：管理员成功创建邀请后同事务调用 `enqueueInvitation({workspaceId, invitationId, inviteUrl})`。数据从实际 invitations 表取得，链接 token 必须匹配记录中的摘要。只有加密 payload 保存临时明文 token。发信前重新检查过期、撤销、消费、空间归档。
- 工单回复：`enqueueSupportReply({workspaceId,ticketId,messageId})` 只给提交者发送他人回复提醒，自己补充不发自己；不把工单正文/附件或回复正文放入邮件。
- 站内通知：`enqueueNotification({workspaceId,notificationId})` 给该通知的真实成员收件人发送最小提醒，包含“登录查看详情”，不外传申诉理由/余额明细。来源必须属于相同空间。
- 地址随实际业务记录冻结；发信前如账户地址或成员关系已改变，取消待发邮件。邀请/工单路径仍需原有业务权限。发信与撤销不可能形成跨 SMTP/SQLite 的全局事务：已经开始发送后撤销不保证邮件不被接受；邀请令牌仍会由应用验证并拒绝使用。

`GET /api/v1/mail-deliveries` 只允许当前工作空间 owner/admin 的会话，拒绝 API key，必须带 `x-workspace-id`。返回 `{data:{enabled,items}}`，最近最多 50 条，不含收件人、正文、密文、SMTP 凭据或原始响应。普通用户没有重试按钮；管理界面是只读。

## 状态与交付边界

| 状态 | 意义 / 自动行为 |
| --- | --- |
| `queued` | 来源事务已提交，等待 worker |
| `sending` | worker 独占租约，正在 SMTP 事务中 |
| `accepted` | SMTP 最终响应接受，**不等于投递到收件箱**；清除加密正文 |
| `retry` | 明确 4xx 拒绝或可证实的建立连接前失败，等待下一次尝试 |
| `failed` | 明确 5xx、TLS/认证/配置失败、加密内容不可读取，或重试 5 次耗尽 |
| `reconciliation_required` | 接受结果不明或 sending 租约过期；不自动再次发送 |
| `cancelled` | 来源无效或操作员取消；清除加密正文 |

退避从 60 秒开始翻倍，确定性 0–20% 抖动，最多 5 次自动尝试。Message-ID 为 `<outbox UUID@发件域>`，跨重试保持相同，日期和模板冻结。它用于关联服务商日志，SMTP 不提供本系统可依赖的幂等提交协议，因此不承诺恰好一次。

例如服务器收到 DATA 后连接断开，系统无法知道是否已收信，必须核对。崩溃时 `sending` 租约过期也保守进入核对；不会把新 worker 重启当成自动重复发送的依据。即使数据库写入 `accepted` 失败，恢复行为仍然保守。

## 安全核对命令（不直接发送）

本地安装首位管理员（与离线商业运营相同规则）可运行；需要文件系统操作权限。先停下相关 worker 或确保只有所需待处理项被重排。命令本身仅改队列，**重排后正在运行的 worker 可能立刻发送**，必须在服务商日志中确认原尝试未接受再重排。

在私有 JSON 文件中填写状态查询：

```json
{"operatorId":"安装首位管理员UUID","workspaceId":"工作空间UUID"}
```

```sh
pnpm exec tsx scripts/mail-outbox-admin.ts status /absolute/private/mail-status.json
```

核对输入：

```json
{
  "operatorId":"安装首位管理员UUID",
  "id":"outbox UUID",
  "action":"retry-confirmed-not-accepted",
  "evidenceReference":"smtp-console-case-20261014-001"
}
```

```sh
pnpm exec tsx scripts/mail-outbox-admin.ts reconcile /absolute/private/mail-resolution.json
```

三种操作：

- `retry-confirmed-not-accepted`：仅对 failed / reconciliation_required，在有证据确认 SMTP 未接受后重排；必须仍有合法 SMTP 配置和加密消息，累计次数不清零。它明确授权新一次尝试，若失败且已达到总计 5 次则再次进入 failed。
- `confirm-accepted`：仅对 reconciliation_required，在服务商证据确认接受后记录 accepted 并清正文；不声称最终送达。
- `cancel`：取消未开始或失败/待核对的队列项并清正文；无法撤回已经被 SMTP 接受的邮件。

审计写入 `mail_outbox_actions`，只记录操作员 ID、动作和短证据编号。不要把邮件正文、地址、邀请 token、SMTP 响应原文或密码放入证据字段。错误输出为固定消息，不打印 JSON 内容或堆栈参数。

## 备份、轮换与保留

SQLite 备份可能含未决加密 payload，且旧 WAL/快照可能仍含历史密文。accepted/cancelled 当前行清正文不等于安全擦除历史备份。数据库、安装密钥与备份应按应用私有文件权限管理；密钥丢失无法恢复未发队列。换 ENCRYPTION_KEY 之前先处理/取消待发邮件，或实施受控重新加密；不要直接换密钥后盲重排。

保留状态去重键，避免历史业务事件再次排队。此实现没有自动删除状态审计，也没有自动重放历史事件。运营定期清理无用 failed/待核对项（先核实再 cancel），按组织留存规则处理备份。邀请过期之后即使重排也会在发送前取消。

## 验证证据

`tests/mail-outbox.test.ts` 使用真实 SQLite 和 Node TCP 假 SMTP，覆盖成功、一个收件人、加密与清理、唯一事件/事务回滚、来源租户、撤销/已用/过期、451 RCPT/DATA 退避/耗尽、550、535认证、STARTTLS拒绝降级、提交后断线、重启租约/并发 claim/旧worker栅栏、停用、密钥错误、真实通知/回复来源、只读接口权限与敏感字段隔离。未连接真实邮箱服务。

官方依据：[Nodemailer SMTP](https://nodemailer.com/smtp)、[错误字段](https://nodemailer.com/errors)、[消息协议选项](https://nodemailer.com/message)。依赖固定 nodemailer 10.1.1；本机通过实际 SMTP 合同验证，外部运营接入与送达仍需独立验收。
