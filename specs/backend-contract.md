# 映造 Studio · 后端契约建议 v1

状态：阶段2/3评审前的协作契约草案，尚未实现。依据 `architecture.md` 与 `design.md`；最终共享 Zod schema、包配置和框架集成由根代理统一维护。本文件负责认证、空间、项目/文档、素材、品牌/人物、团队、商业记录及 API key；任务、报价、额度账本、worker、provider 由根代理负责。

## 1. 全局约定

- API 前缀 `/api/v1`。所有实体 ID 为 UUID 字符串；所有时间为 UTC ISO 8601 字符串，缺失时间显式 `null`。整数金额用最小货币单位，额度用整数，禁止浮点金额。
- JSON 成功固定 `{ "data": ... }`；错误固定 `{ "error": { "code": "STABLE_CODE", "message": "可读说明", "details": {} } }`，details 可省略。requestId 放响应头 `x-request-id`，不污染每种实体结构。
- 单实体 GET/POST/PATCH 的 data 直接是 DTO；列表 data 固定 `{items: T[], total: number, page: number, pageSize: number}`，默认 page=1、pageSize=24、最大100。稳定排序包含时间和 id，不返回无限列表。筛选空结果也是200且 items=[]。
- 工作空间相关 JSON 请求必须带 `x-workspace-id`，不隐式使用“第一个空间”或客户端角色。auth、workspaces列表/创建、邀请接受是明确例外。缺头400 WORKSPACE_REQUIRED，非成员或无操作权限403 FORBIDDEN；指定空间内不存在或软删实体404 NOT_FOUND，避免枚举其他租户数据。
- 所有服务收 `Actor` 与显式 workspaceId；Actor由会话/API key校验产生，包含 userId、authType及API scopes，不接受请求体自报角色。角色从DB membership重新读取。API key也必须绑定workspace。
- 创建返回201，普通成功200。删除是软删，返回 `{data:{id,deletedAt}}`；恢复返回完整DTO。没有永久删除API。用户界面可撤销删除，文件不会同步永久清除。
- JSON使用camelCase；SQLite内部允许snake_case。公開DTO明确列字段，不返回passwordHash/sessionHash/tokenHash/storageKey/绝对文件路径/供应商密钥。
- 二进制媒体、下载和持久化任务/会话SSE是JSON包装的明确例外。错误仍为JSON且正确状态码。

## 2. 基础 DTO

`Role = owner | admin | member | viewer`。`WorkspaceKind = personal | team`。

**UserDto**：`id, email, displayName, avatarAssetId: string|null, preferences: {theme: light|dark|system, locale: zh-CN|en|ar, confirmGeneration: boolean}, createdAt, updatedAt`。email仅出现在用户本人的me及被授权的成员管理结果，公共分享不含email。

**WorkspaceDto**：`id, name, kind, role, isDemo: boolean, createdAt, updatedAt`。role为当前访问者在该空间的角色。额度不嵌入该DTO，由根负责的credits接口返回；空间列表不触发供应商余额查询。

**ProjectDto**：`id, workspaceId, name, description, kind: image|video|mixed, coverAssetId: string|null, documentId, tags: string[], isFavorite: boolean, createdBy, createdAt, updatedAt, deletedAt: string|null`。isFavorite属于当前用户，不能做成团队共享布尔字段。项目元信息不与画布revision混用。

**AssetDto**：`id, workspaceId, projectId: string|null, name, kind: image|video|audio|document, extractionStatus: not-applicable|pending|ready|failed, mimeType, byteSize, width: number|null, height: number|null, durationMs: number|null, source: upload|generation|local-processing|import, sourceJobId: string|null, tags: string[], isFavorite: boolean, originalUrl, previewUrl: string|null, thumbnailUrl: string|null, createdBy, createdAt, updatedAt, deletedAt: string|null`。URL为本站受保护的相对地址；元数据均从真实文件解析，不能相信客户端声称尺寸。暂无变体时返回null，不用thumbnail替代original。

**BrandDto**：`id, workspaceId, name, description, colors: string[], fonts: string[], referenceAssetIds: string[], coverAssetId: string|null, visibility: private|workspace, createdBy, createdAt, updatedAt, deletedAt: string|null`。颜色校验为标准hex字符串，字体为允许的字体名称，参考素材必须为同空间图片。没有trained状态，表示参考风格配置。

**CharacterDto**：`id, workspaceId, name, description, referenceAssetIds: string[], coverAssetId: string|null, verification: {status: unverified|pending|verified|rejected|expired, providerId: string|null, expiresAt: string|null}, createdBy, createdAt, updatedAt, deletedAt: string|null`。只有认证服务回调/核验服务可写verified，普通PATCH不能接收verification状态。

**DocumentDto**：`id, workspaceId, projectId, name, revision: integer>=1, schemaVersion:1, scene: SceneDocumentV1, createdAt, updatedAt`。SceneDocumentV1由根维护，不由数据库/路由另写一份；它独立于Fabric，含canvas尺寸/背景与允许图层判别联合。

**DocumentVersionDto**：`id, documentId, revision, reason: create|save|restore|job-apply, createdBy, createdAt, sourceJobId:string|null, restoredFromRevision:number|null`。列表不带完整scene，单个版本查询再带scene。最近30条按服务规则保留，当前状态和新增恢复版本不能被误删。

## 3. 认证与空间接口

| 路由 | 输入 | data 返回 |
| --- | --- | --- |
| GET `/auth/status` | 无 | `{setupRequired:boolean, registrationEnabled:boolean}`，无用户资料 |
| POST `/auth/register` | `{email,password,displayName,inviteToken?:string}` | `{user:UserDto,workspace:WorkspaceDto}`，201并Set-Cookie；首次loopback owner、显式开放注册或有效邮箱匹配邀请 |
| POST `/auth/login` | `{email,password}` | `{user:UserDto,workspaces:WorkspaceDto[],activeWorkspaceId:string|null}`，Set-Cookie |
| GET `/auth/me` | 会话；无需workspace头 | `{user:UserDto,workspaces:WorkspaceDto[],activeWorkspaceId:string|null}`；未登录401 |
| POST `/auth/logout` | 无 | `{signedOut:true}`，撤销当前会话、清Cookie |
| PATCH `/auth/me` | `{displayName?,avatarAssetId?,preferences?}` | UserDto；不在此接口修改email/password |
| GET `/workspaces` | 会话；无需workspace头 | 标准WorkspaceDto列表 |
| POST `/workspaces` | `{name}` | 新建team的WorkspaceDto；创建者owner；不复制原站团队/余额 |
| PATCH `/workspaces/:id` | `{name}` | WorkspaceDto；owner/admin且path id与header一致 |
| POST `/workspaces/:id/activate` | 无 | `{activeWorkspaceId:id}`，只保存选择偏好，不授予权限 |

密码使用scrypt，session原token只发HttpOnly cookie、数据库仅hash。首次注册用户/个人空间/owner membership必须一个事务，避免并发创建多个首次owner。空间与用户创建后的本地额度初始化由根提供事务内hook；本服务不直接写余额。

邀请令牌与分享令牌不通过URL日志记录明文；公开页面仅解析用户主动提供的token。后续普通注册默认关闭，但新受邀用户可通过 POST /auth/register 提交 inviteToken。服务验证令牌摘要、未消费/未撤销/未过期及归一化邮箱精确匹配，创建用户、个人空间及owner membership、邀请所属团队membership、消费邀请令牌必须在同一事务；任一失败全部回滚。已有账户继续通过登录后的邀请接受接口加入。邀请不能开放无令牌的任意注册，也不能把客户端邮箱自报当作邀请匹配之外的已认证邮箱证明。

## 4. 项目与文档接口

| 路由 | 输入 | data 返回 |
| --- | --- | --- |
| GET `/projects` | `q?,kind?,favorite?,deleted?,from?,to?,page?,pageSize?` | 标准ProjectDto列表 |
| POST `/projects` | `{name,kind?,description?,scene?:SceneDocumentV1}` | ProjectDto；事务内同时创建初始Document和版本，documentId始终可用 |
| GET `/projects/:id` | 无 | ProjectDto |
| PATCH `/projects/:id` | `{name?,description?,tags?,coverAssetId?}` | ProjectDto；封面资产同空间 |
| DELETE `/projects/:id` | 无 | `{id,deletedAt}`；不删除共用素材，项目内容随项目不可见 |
| POST `/projects/:id/restore` | 无 | ProjectDto |
| PUT `/projects/:id/favorite` | `{favorite:boolean}` | `{id,isFavorite:boolean}`；用户级幂等设置 |
| GET `/projects/:id/document` | 无 | DocumentDto，便利主画布入口 |
| GET `/documents/:id` | 无 | DocumentDto |
| PATCH `/documents/:id` | `{expectedRevision:number,scene:SceneDocumentV1,name?}` | 更新后的DocumentDto；单事务校验版本、保存、新增版本 |
| GET `/documents/:id/versions` | `page?,pageSize?` | 标准DocumentVersionDto列表 |
| GET `/documents/:id/versions/:revision` | 无 | `{version:DocumentVersionDto,scene:SceneDocumentV1}` |
| POST `/documents/:id/restore` | `{targetRevision:number,expectedRevision:number}` | 新DocumentDto；以当前revision+1新增恢复记录，不倒退revision |

版本冲突409：`{error:{code:"REVISION_CONFLICT",message:"文档已更新，请保留当前草稿并重新加载。",details:{documentId,currentRevision}}}`。不得返回整份他人未授权文档作为error details。画布内引用的assetId、projectId、品牌必须同workspace且可见，图层字段经过共享schema白名单校验。

根负责pendingApply和任务结果应用，但必须复用本服务提供的文档事务函数：`saveDocumentInTransaction(context,{documentId,expectedRevision,scene,reason,sourceJobId?,restoredFromRevision?})`。函数只在调用者已建立的同一DB事务中写入；不自己开网络或嵌套事务。这样任务结果应用、pending状态更新、版本创建能够原子完成。

## 5. 素材、收藏和品牌接口

| 路由 | 输入 | data 返回 |
| --- | --- | --- |
| POST `/assets/upload` | multipart：`file`必需，`projectId?`,`name?`,`tags?`；一次一个文件 | AssetDto，201；多文件由前端逐个/有界并发上传，显示逐项失败 |
| GET `/assets` | `q?,kind?,projectId?,tag?,favorite?,collectionId?,deleted?,from?,to?,page?,pageSize?` | 标准AssetDto列表 |
| GET `/assets/:id` | 无 | AssetDto |
| PATCH `/assets/:id` | `{name?,tags?,projectId?}` | AssetDto |
| DELETE `/assets/:id` | 无 | `{id,deletedAt}`；引用中的文档显示缺失态，存量文件保留可恢复 |
| POST `/assets/:id/restore` | 无 | AssetDto |
| PUT `/assets/:id/favorite` | `{favorite:boolean}` | `{id,isFavorite:boolean}` |
| GET `/assets/:id/text` | 无 | `{assetId,extractionStatus,extractedText:string|null,extractionError:{code,message}|null,truncated:boolean}`；同空间read权限，列表不返回正文 |
| GET `/assets/:id/content` | `variant=original|preview|thumbnail`，默认original；`download=1?` | 媒体字节流，正确MIME/Content-Disposition；支持视频Range |
| GET/POST `/collections` | 列表分页；创建`{name}` | 标准列表 / `{id,workspaceId,name,createdAt,updatedAt}` |
| PATCH/DELETE `/collections/:id` | 改名`{name}`或软删 | CollectionDto / `{id,deletedAt}` |
| PUT `/collections/:id/assets` | `{assetIds:string[]}`，按该集合完整替换、上限500 | `{id,assetIds}`；全量同租户校验，一项无权则整体拒绝 |
| GET/POST `/brands` | 列表`q?,visibility?,page?,pageSize?`；创建Brand可写字段 | 标准BrandDto列表 / BrandDto |
| GET/PATCH/DELETE `/brands/:id` | Patch只允许品牌可写字段 | BrandDto / `{id,deletedAt}` |
| POST `/brands/:id/restore` | 无 | BrandDto |
| GET/POST `/characters` | 列表分页；创建名称/描述/参考素材 | 标准CharacterDto列表 / CharacterDto |
| GET/PATCH/DELETE `/characters/:id` | Patch不可设置verification | CharacterDto / `{id,deletedAt}` |

**媒体头的必要例外**：浏览器 `<img>/<video>/<audio>` 无法附自定义workspace头，故content路由允许不带`x-workspace-id`，但从asset反查workspace并用当前会话重新验证membership；API key访问还校验绑定空间和scope。提供了header且与资源不一致则拒绝。不能把“无header”实现成匿名下载。网页切空间不改变用户已有权限，但已被移出空间应立即失去访问。

公开分享/供应商临时签名媒体是独立路由和明确授权机制，不能复用私有content绕过身份。root provider需要云端可读素材时调用专用签名/上传适配，不返回本机文件路径。

worker真实产物入库复用内部 `registerAssetInTransaction(context,metadata,variants)`：只登记已验证、已原子落盘的文件，metadata包含sourceJobId，variants明确original/preview/thumbnail。storageKey内部使用随机键，DTO只生成受保护URL。磁盘写入与DB提交失败时记录可清理的孤立文件，不返回假资产。

## 6. 团队与权限接口

**MemberDto**：`id,workspaceId,user:{id,displayName,email,avatarAssetId},role,status:active,creditLimit:number|null,createdAt,updatedAt`。creditLimit是成员预算上限，实际可用/已用/预占由根额度服务计算，不在成员PATCH直接改creditAccount。

| 路由 | 输入 | data 返回 / 权限 |
| --- | --- | --- |
| GET `/members` | page/pageSize | 标准MemberDto列表；查看成员允许当前空间成员，email可按访问角色收窄 |
| PATCH `/members/:id` | `{role?:admin|member|viewer,creditLimit?:number|null}` | MemberDto；owner/admin，admin不可改owner；预算通过根服务事务校验 |
| DELETE `/members/:id` | 无 | `{id,removedAt}`；owner不可删除，admin不得移除owner；撤销后服务实时拒绝 |
| GET/POST `/invitations` | 列表分页；创建`{email,role:admin|member|viewer,expiresInDays?:1..7}` | 列表无token；创建返回InvitationDto与一次性`inviteUrl`；owner/admin |
| DELETE `/invitations/:id` | 无 | `{id,revokedAt}`；撤销token，不发外部消息 |
| POST `/invitations/accept` | `{token}`，无需workspace头但要求登录 | `{workspace:WorkspaceDto}`；邮箱匹配、单次、未过期；消耗邀请与创建membership同事务 |
| POST `/workspaces/:id/leave` | `{confirm:true}` | `{left:true}`；owner不能直接退出 |

邀请默认只创建可复制链接，不声称邮件已发送。邮件发送留给有真实配置的adapter。额度分配/共享、解散、owner转移分别由明确的业务规则实现，不能复用普通PATCH任意改字段；其路由在根额度契约/阶段评审中补齐，当前不抢写账本规则。

## 7. 商业记录、支持和 API key

**OrderDto**：`id,workspaceId,number,kind:subscription|credits,status:draft|pending|paid|failed|cancelled,amountMinor,currency,planId:string|null,providerId:string|null,createdAt,updatedAt,paidAt:string|null`。客户端不可PATCH paid。

**InvoiceTitleDto**：`id,workspaceId,type:personal|company,name,taxId:string|null,email:string|null,createdAt,updatedAt`。**InvoiceRequestDto**：`id,workspaceId,orderIds,titleSnapshot,status:draft|requested|processing|issued|rejected,amountMinor,currency,providerId:string|null,downloadAvailable:boolean,createdAt,updatedAt`。银行/身份证等不必要字段不先收集；issued仅来自开票服务事实。

| 路由 | 输入 | data 返回 |
| --- | --- | --- |
| GET `/plans` | 可匿名读取本地套餐目录 | 标准PlanDto列表；`id,name,kind,priceMinor,currency,interval,credits,limits,providerConfigured` |
| GET `/subscriptions` | 空间头 | 标准SubscriptionDto列表；状态为真实记录，不因页面访问自动激活 |
| GET `/orders` / GET `/orders/:id` | 空间头与分页 | 列表/OrderDto，owner/admin |
| POST `/orders` | `{planId}` | OrderDto draft/pending；无支付配置时可创建草稿，但不能发放额度 |
| POST `/orders/:id/checkout` | 无 | 已配置时`{checkoutUrl,expiresAt}`；未配置503 PAYMENT_PROVIDER_UNAVAILABLE，无假二维码/成功 |
| GET/POST/PATCH/DELETE `/invoice-titles[/:id]` | 抬头可写字段 | 列表/InvoiceTitleDto/删除结果 |
| GET/POST `/invoices` | 创建`{orderIds,titleId}` | 列表/InvoiceRequestDto；校验订单paid、同workspace、未重复申请；真实提交服务未配置时保留draft/阻止外发，不能写issued |
| GET/POST `/support/tickets` | 创建`{subject,category:feedback|appeal|support,message,jobId?,assetIds?}` | 标准TicketDto列表/TicketDto；本地提交记录明确“待处理”，不假装客服答复 |
| GET `/referrals` | 当前用户+空间 | `{inviteCode:string|null,inviteUrl:string|null,qualifiedCount:number,rewardCredits:number,providerConfigured:boolean}`；不伪造历史邀约/奖励 |
| GET `/api-keys` | owner/admin | 标准ApiKeyDto列表，无明文 |
| POST `/api-keys` | `{name,scopes:string[],expiresAt?:string|null}` | `{key:ApiKeyDto,secret:string}`；明文仅创建响应一次，no-store |
| DELETE `/api-keys/:id` | owner/admin | `{id,revokedAt}`，立即撤销 |

**ApiKeyDto**：`id,workspaceId,name,prefix,scopes,createdAt,lastUsedAt:string|null,expiresAt:string|null,revokedAt:string|null`。secret使用强随机值，hash持久化，prefix仅识别用；root统一scope注册表，初步建议 `projects:read,assets:read,assets:write,jobs:read,jobs:write`。创建时不允许请求比创建者更高的权限。供应商secretKey与本系统开放API key分开存储、分开展示，绝不混用。

外部支付/发票回调的鉴权、幂等、对账和账本变更由根集成到provider/billing services；本服务暴露受限的事务内状态推进函数，不能注册可公开任意设置status的路由。`api_usage`与根任务事件关联，避免重复计数。

## 8. 服务与数据库协作约定

- 共享数据库由同一 `DatabaseContext` 注入，包含better-sqlite3连接与Drizzle实例；API工厂接受依赖，路由导出注册函数而不listen。测试可给临时文件连接。
- 本代理负责核心表schema和基础迁移草案；root的jobs/ledger/provider表独立模块并由root统一导出schema、分配最终迁移编号。不会创建package配置或与root并行改同一迁移文件。
- root调用内部服务的最小集合：`requireWorkspaceAccess(actor,workspaceId,permission)`、`getProjectForAccess`、`getDocumentForAccess`、`saveDocumentInTransaction`、`getAssetForAccess`、`registerAssetInTransaction`、`getBrandForAccess`。返回内部对象可含storageKey，永不直接序列化给HTTP。
- 账户/空间创建、团队成员预算更新、移除成员后的预占处理需要root额度服务hook；hook在明确调用方事务里运行，不能开独立事务后造成半成功。
- scene修改与pendingApply由同一事务协调，不能先保存文档、再异步写pending状态。检查lease fence等任务事实由root负责。
- 所有路由的请求/响应Zod由root共享contracts生成，实施前按本文DTO对齐。声明可变字段采用专用input schema，不用整实体partial造成status/createdBy等越权写入。

## 9. 必要验收契约

临时SQLite覆盖：首次owner竞争、密码验证/登出撤销、非成员拒绝、viewer拒绝写入、admin不得改owner、外空间关联资产拒绝、列表过滤不漏租户、收藏用户隔离、删除恢复、revision冲突、恢复新增版本、原图与缩略图路由、无header媒体仍授权、API密钥只一次显示及撤销、邀请单次消费、订单不可客户端改paid、发票无provider不改issued。

文件和媒体测试使用小型真实fixture，不引入演示AI结果。UI通过CUA后续实际验证，不在本契约阶段启动浏览器或实现代码。当前唯一产物为本契约文档。


## 10. 门禁补充（已确定）

F07 文档素材为必做：支持 text/plain、text/markdown、application/pdf、application/vnd.openxmlformats-officedocument.wordprocessingml.document。文本/Markdown 按UTF-8纯文本读取；PDF 使用 pdf-parse 或 pdfjs-dist 文本提取；DOCX 使用 mammoth 原始文本提取。格式校验结合MIME、扩展名和内容签名，限制文件体积、压缩展开量及提取正文长度；不渲染或执行上传HTML、脚本、宏。上传文档登记 extractionStatus=pending，持久化待提取状态由后台处理可在重启后恢复；成功为ready，失败为failed并提供清晰错误，保留原件供下载。正文限100,000字符并显式truncated；加密/纯扫描PDF无可提取文本应反馈失败或需OCR，不能假称已有正文。仅受保护的 GET /assets/:id/text 返回提取正文及错误，素材列表只返回状态。

显式演示seed仅NODE_ENV不为production时运行，固定隔离库 var/demo.sqlite，账号 demo@example.local / DemoStudio2026!；必须可复跑（稳定记录/幂等upsert，额度初始化不重复发放），不得操作正式库。Workspace.isDemo供开发UI显示演示标记。测试可通过真实登录会话使用该演示账号，不允许API隐式注入管理员或绕过鉴权。

最低验收增加：邀请新账号注册闭环、过期/撤销/邮箱不匹配邀请拒绝、注册邀请竞争只消费一次、文本/Markdown/PDF/DOCX真实解析、提取失败状态、超限截断、正文跨空间拒绝、演示seed重复运行不重复创建/发放。
