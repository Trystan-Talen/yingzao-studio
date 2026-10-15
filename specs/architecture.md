# 映造 Studio · 架构规格 v1

状态：阶段 2 待独立评审。目标：独立实现已调查的电商图片、视频、创作与组织工作流；数据库首先使用 SQLite。源站脚本仅作为调查证据，不进入应用代码或资源。

## 技术与边界

- TypeScript strict + noUncheckedIndexedAccess；Node 22，pnpm 精确锁版本。
- React / Vite / React Router，TanStack Query 管服务器状态；局部草稿组件状态；Lucide 图标，CSS 变量设计系统，Radix 对话框/菜单。画布使用 Fabric，显式序列化，不把数据库 JSON 直接注入 DOM。
- Fastify API，生产同域托管 SPA；显式 `/api/v1` REST。API 应用工厂与监听入口分离。Zod 作为请求契约来源；类型推导；OpenAPI 从相同 schema 生成。
- SQLite / better-sqlite3 / Drizzle：WAL、foreign_keys、busy_timeout、FULL synchronous。只在显式 migrate 命令执行版本化 SQL；事务内无网络/媒体处理。
- 独立 Node worker，SQLite 持久任务/租约，不依赖 Redis。Sharp 用于真实图片转码/拼接/缩略图；FFmpeg 能力通过检测本机命令获得，用于真实裁剪/拼接/导出。
- 本地私有媒体存储；公开示例资源放 public/gallery；原始资产与 thumbnail 分离，禁止 thumbnail 冒充原图。
- 本地开发监听 127.0.0.1。生产需 SESSION_SECRET、PUBLIC_ORIGIN、AI 服务配置及显式创建账户；开发演示账户只允许显式 seed-demo，界面标示演示工作区；演示不模拟 AI 成功。

## 文件责任

`src/contracts` 共享 DTO/Zod/工具目录；`src/server/db` schema/连接；`src/server/services` 业务；`src/server/routes` HTTP；`src/server/providers` 外部契约；`src/server/storage` 私有文件；`src/worker` 任务；`src/web` 页面/组件；`migrations` SQL；`tests` 真 SQLite 与服务契约。

根文件/依赖/契约由集成负责人维护。功能实施者只改分配目录。每个边界返回明确错误，不 catch 后伪装成功或空数组。不写通用任意表 CRUD API。

## 身份与空间

用户以 email + scrypt 密码登录，HTTP-only SameSite=Lax 会话 Cookie，session token 仅存 hash；注册创建个人空间。登录限流，登出/撤销会话。可邀请已有账户或签发短期一次性邀请 token；接受邀请加入团队；owner/admin/member/viewer 权限：

| 操作 | owner | admin | member | viewer |
|---|---|---|---|---|
| 看空间项目/资产 | 是 | 是 | 是 | 是 |
| 创作/上传/编辑 | 是 | 是 | 是 | 否 |
| 管品牌/共享资产 | 是 | 是 | 是 | 否 |
| 管成员/预算 | 是 | 是（不可改owner） | 否 | 否 |
| 配服务/API key/订单 | 是 | 是 | 否 | 否 |
| 解散团队/转移owner | 是 | 否 | 否 | 否 |

每个资源服务必须由 Actor + workspaceId 授权。任何关联资产、项目、品牌也检查同空间。客户端角色不是授权依据。删除用回收站软删，文件回收不自动永久清除。邀请、分享、API key 只有 hash 持久化；分享最小字段且可撤销/到期。

## 核心数据

- users/sessions/workspaces/memberships/invitations：账户、个人/团队空间、角色、成员消费上限。
- projects/documents/document_versions：项目、带 schemaVersion/revision 的画布和最近 30 版。
- assets/asset_variants/collections/asset_collections：私有媒体、原始文件与缩略图、标签/收藏/回收站。
- brands/brand_references：参考图、名称、颜色、字体、简介、空间公开状态；不宣称训练。
- conversations/messages：项目多轮需求与任务结果引用，顺序与历史保存。
- jobs/job_items/job_events：按张/输出拆 item，输入快照、providerRemoteId、租约、阶段、重试信息。
- credit_accounts/credit_ledger：总额、已预占、不可变账本；任务 item 预占/扣除/释放唯一事件。
- pending_applies：任务结果与指定文档/baseRevision 的关联，绝不无条件覆盖新编辑。
- api_keys/api_usage/audit_events/notifications：开放接口 scopes、预算、使用明细、操作记录。
- subscriptions/orders/invoice_titles/invoice_requests/support_tickets/referrals：真实业务记录；外部动作只能供应商确认后推进状态。
- character_profiles：人物参考与验证状态，只有接入认证服务才可标 verified；普通参考图片不冒充认证人脸。

SQL 关键约束包含 workspace 关联、job idempotency unique、ledger event unique、版本 unique、token hash unique。金额/额度全部整数。

## 任务和额度

1. POST /jobs 验证类型、供应商能力、参数、引用资产、角色和成员预算。生成前返回后端报价；提交使用 clientRequestId 幂等。
2. `BEGIN IMMEDIATE` 中复核可用余额，创建 job/items 与 reserve 账本，提交后再通知 worker。未配置/不支持能力在预占前拒绝。
3. worker 原子 claim 可执行 item，保存租约 owner/expiry/fence；先持久化 submitting，再网络提交；保存远端 ID 后轮询。心跳续租；完成事务要求匹配 fence。
4. 进程在 submitting 与保存远端 ID 间崩溃且供应商无幂等查询时，置 reconciliation_required，显示需核对；不盲目重提或退款。已取得远端 ID 可恢复轮询。
5. 输出先下载并验证 MIME/大小，再写资产并事务结算；每 item 一次 settle，失败释放未消费预占。job 汇总 queued/running/succeeded/partial/failed/cancelled/reconciliation_required。
6. 排队项可立即取消并释放；已远端提交的取消只发请求，待供应商事实确认；不可取消则明确提示仍在执行。部分成功仅重试失败项，不能重复扣成功项。
7. 任务状态从 DB 获取，客户端轮询有 backoff；不生成虚假百分比。过程事件记录阶段；网页关闭不影响 worker。

计价是新系统配置，不承诺原站价格：每模型/能力定价、按张/秒/层/组合数，服务端统一计算。开发初始额度清楚标识为本机测试额度，没有现金价值。原站余额不复制。额度配置与真实服务商费用分开显示。

## 媒体与画布

上传 multipart：服务端 sniff MIME/像素/字节，允许图片/视频/音频白名单；用随机存储键；不信任客户端扩展名/路径。每种工具额外校验数量、组合、比例、时长。私有下载再次授权，单独缩略图 endpoint。

本地图片确定性操作与 AI 工具分开：裁切、旋转、普通缩放、转码、长图拼接真实本地执行；AI 超清/抠图/融合等须真实模型。视频裁剪用 FFmpeg，字幕翻译/擦除/生成须供应商。

画布包含 image/text/shape/group 图层，支持选择/多选、位置尺寸旋转、缩放平移、拖动、层级、锁定隐藏、复制删除、对齐、文字样式、撤销重做。保存带 expectedRevision，冲突409，提供重载/另存。恢复版本也创建新版本，不销毁后续历史。导出 PNG/JPG/每画板ZIP/长图，尺寸限制，透明/背景设置，可选声明元数据。先保真输出，再开放大尺寸。

AI工具启动保存 baseRevision；结果先入素材库及 pendingApply。用户继续编辑时显示待应用，允许新图层插入/替换选中/放弃。即使确认也校验最新revision，且只操作原workspace/project。

## 服务商契约与不确定性

第一真实适配器优先使用 Flyelep 官方公开 API 文档，可用能力按文档逐项实现；secretKey/userId 与网页 API key 关系需用户提供正确服务凭据。参考素材先按官方上传协议获取服务端可访问引用，不能把 localhost URL 发给服务商。第二适配器可用 OpenAI image/chat 和兼容的专属视频协议；不能把所有服务称通用 OpenAI compatible。

能力报告包含 enabled/configured/supported/model/options，前端只展示真实可选项或明确未连接原因。配置保存掩码，密钥只存在环境或加密私有配置。缺少支付、短信、OAuth、发票、社会视频解析、人脸认证服务时：业务记录/配置入口可用，外部执行被明确阻止；绝不返回假二维码、假认证、假发票/付款成功。帮助写作真实调用语言服务，无服务时允许手动填写，不假冒AI改写。

## API 范围和验收

auth/me/login/logout/register；workspaces/members/invitations；projects/documents/versions/messages；assets/upload/list/restore/download/collections；brands；capabilities/quote/jobs/events/cancel/retry；credits/ledger；settings/provider-status；api-keys/usage；notifications/read；orders/plans/invoices；support；referrals；share；tools/export。

测试必须使用临时 SQLite，覆盖幂等、负额度、并发claim、跨租户、权限降级、失败释放、部分成功、租约过期、提交不确定、revision冲突、secret屏蔽、媒体原图；provider contract使用确切文档响应fixture且标明非真实推理。类型/lint/build、无障碍与浏览器桌面/移动QA、启动/备份恢复演练是交付门槛。外部真实调用状态单列，没密钥不得记“全功能已实测”。

## 评审补充：固定的实现决策

- SceneDocument v1 独立于 Fabric：canvas宽高/background，layers判别类型(text/image/shape/group)，所有位置以画布左上原点、像素单位；引擎显式 originX=left/originY=top。序列化适配只转换可控字段，字体、换行、裁剪与旋转在编辑/导出共用同一渲染器，不使用任意SVG往返恢复。
- 同一 BEGIN IMMEDIATE 中检查 workspace/provider/user running slot，并claim item；租约过期的远端非终态仍占槽，恢复poll不另占槽；cancel_requested直到远端终态才释放。每space默认2并发，provider总量独立上限。
- quote含 pricingVersion、expiresAt、maxCredits、outputUnits。job保存价格快照；结算不超过同意的预留上限，实际更高需新确认；供应商真实费用由独立字段跟踪，不拿本地额度冒充货币。
- 首次启动：启动脚本只创建迁移与私有目录，未存在用户则允许首次owner注册（只有loopback配置可用）；用户亲自创建凭据。后续注册默认关闭，团队通过邀请；测试用显式 `seed-demo` 创建可删除的演示数据库与已知测试凭据，生产拒绝DEMO_MODE。
- 远端服务接收本地素材：适配器必须使用官方上传协议或明确支持的multipart/base64。Flyelep若只支持可公开访问的URL，则需用户配置PUBLIC_MEDIA_BASE_URL以及短时签名读取endpoint；默认不对外暴露本机资产，检测localhost/private origin并拒绝提交含不可达素材的任务。支持文本直接生图的能力不受影响。
- 分享默认未创建，用户主动创建才产生随机token；可限制到期与撤销，令牌hash存储。媒体只按显式分享资源提供，不能任意assetId穿透。

## 第二轮评审修正

- SceneDocument增加video层：assetId/posterAssetId、duration、trimStart/trimEnd、muted/loop。视频原文件/裁剪后MP4下载与画布PNG静态快照分开标明；导出静态快照不称视频导出。
- job_events/message_events持久化递增序号；SSE支持Last-Event-ID恢复，先补历史再订阅，心跳不伪造进度。轮询作为断线退避后的兜底；服务器状态始终为事实来源。
- Cookie认证的全部写入接口检查Origin与PUBLIC_ORIGIN一致；非浏览器API token请求使用独立scope权限，不跳过租户校验。API key不得通过URL传递。provider配置按workspace隔离并加密；全局env仅部署operator管理，团队admin不能修改全局秘密。
- quote绑定workspace、actor、参数canonical hash、pricingVersion、有效期；提交重新校验hash，clientRequestId已存在且payload不同返回409。预算/并发在服务器事务中复核。
- 官方批量输出若丢失失败项且没有原输入标识则默认拆成单输入请求；仍无法关联的输出标“未解析”进入核对，不能按成功URL数组下标臆造匹配。任何未文档化的视频查询或上传路径不猜测，能力明确未就绪，配置/协议完成后才能启用。
