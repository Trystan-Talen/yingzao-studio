# 映造 Studio：F01–F52 交付证据矩阵

独立审计快照：2026-10-14；代码根 `platform/`。本表按阶段 2 canonical 范围逐项核对，不将“有入口”“缺密钥”或测试模拟响应等同于完整功能交付。本机交付状态以本表及交付说明为准，未实现项保持可见。

证据级别：**业务**为代码中实际持久化/处理路径；**合同**为离线协议或本机集成测试；**外部**为真实服务商调用；**浏览器**为实际 UI 与文件检查。没有对应实测证据即写未验。

- 根最终完整测试：`pnpm test`，278/278通过（20 files，43.31秒，2026-10-14）。覆盖所有新增上传/ZIP/免费竞争、EXIF和Flyelep合同；不含收费推理。类型、lint、格式、构建及实际production runtime均通过。
- 协议专测：`tests/flyelep-provider.test.ts`34项；fal参考16项及扩展21项；OpenAI与EXIF专测见对应test。明确区分合同夹具与真实服务调用。
- 浏览器证据 **UI**：`reviews/web-ui-self-review.md` 与 `reviews/screenshots/`；**ED**：`reviews/phase-4-editor-self-review.md`；**I18N**：`reviews/phase-4-i18n-self-review.md`。这些文件明确各验证人的实际操作。工具路由可达仅是入口 smoke，不是模型成功证据。
- **所有外部 AI、支付、正式身份认证、正式开票、短信/微信/OAuth/外发消息的真实联调，本轮均未执行。** 不把本地处理成功替代外部结果。

| ID / 功能 | 业务实现及源文件 | 合同/本机验证 | 真实外部 | 浏览器证据 | 明确边界/剩余 |
|---|---|---|---|---|---|
| F01 灵感分类 | `tasks/inspirations.ts`、`pages/Inspiration.tsx`、`contracts/inspirations.ts`；原创目录、空间自建、组合筛选、归档 | app.test 管理目录/素材/过滤/跨空间 | 不涉及 | GUI创建/刷新/下架/恢复图片灵感；真实3秒合成视频播放、以此创作自动O3/4K/5秒/全能参考；见web-ui-self-review末节 | 主题以搜索支持；合成测试视频不证明付费AI质量 |
| F02 复用收藏 | inspiration_favorites、项目草稿来源；收藏/取消/以此创作 | app.test 收藏持久化/归档历史 | 不涉及 | UI 收藏、复用新项目 | 自建案例素材已不可用时显示缺失；不能复制未授权空间数据 |
| F03 引导偏好 | `Onboarding.tsx`、auth preferences merge | app.test 偏好字段合并 | 不涉及 | UI 引导可跳过；偏好实际操作 | 不是完整最近参数云端模板系统 |
| F04 电商图片 | `Composer/DesignPlanner`、jobs/snapshot、OpenAI/Flyelep image.generate | openai-provider 具体白底意图/参考；tasks 模块顺序/快照 | 未验；需密钥 | UI 多物料3模块保存刷新 | 实际成图质量/白底/文字准确率未验；Flyelep专用请求合同34项已通过，实际模型效果未验 |
| F05 营销/自由创作 | 多模块类型/尺寸/素材/排序与自由描述 | tasks 模块输出/报价 | 未验；需密钥 | UI 模块名称/顺序/比例恢复 | 物料类型仍代码枚举；不是运营可管理的活动模板库 |
| F06 视频生成 | WAN + Kling O1首尾/O1多图/O3 4K混合参考；`fal-reference.ts` | 16参考合同 + 真SQLite秒数报价 | 未验；需fal | 视频表单路由；新模型待最后UI重验 | 音频参考无适配；O3最多1视频；不承诺字幕/口播/真实4K质量 |
| F07 多模态/@引用 | AssetPicker拖放/粘贴/逐文件进度与重试；upload_requests指纹幂等；文档提取；按拆分item绑定@真实资产名/序号 | core真实四类文档；tasks上下文/引用拒绝与冻结合同；delivery-regressions上传5并发只1份、磁盘无多余变体、冲突409 | 模型未验 | 素材选择/预览；拖粘与断网真实浏览器未独立验 | 文件读取/进度/幂等是本地实现；外部音频参考不支持的模型明确拒绝 |
| F08 AI帮写/报价 | AIWriter重开同步prompt；JobSubmit快照；EntitlementService每日免费文本尝试 | tasks幂等/预算；entitlements日界线/并发领取/失败不返还；OpenAI文字合同 | 未验；需TEXT | UI确认偏好/报价；助手重开行为待前端末轮记录 | 免费按空间UTC日、提交消耗，不代表供应商免费；不能转为余额 |
| F09 会话/方案 | OpenAI image.generate/text.assist冻结本项目最近8条、≤6000字符；design-plan严格结构与3方向、保存消息/复制采用 | tasks上下文冻结/跨项目隔离；openai-provider结构完整及拒绝不完整 | 未验；需TEXT | AIWriter设计方案模式、会话/配置恢复；真实模型多轮未验 | 有限文本上下文，不是无限记忆；其他provider不冒充同等会话；当前计划保存为完整格式化文本 |
| F10 任务生命周期 | jobs/items/events、worker lease/fence、恢复、取消、待核对、部分重试 | tasks 并发/取消/未知/恢复/撤销key/移除成员 | 远端终态未验 | UI真实本机任务报价→队列→成功 | 外部取消请求不等于已取消，unknown保持预留 |
| F11 智能延展 | OpenAI edit recipe / Flyelep官方端点 | 通用输入/任务测试；无专门画面效果测试 | 未验 | 工具入口smoke | 主体保留、延展区域与像素效果未验 |
| F12 局部重绘 | 透明编辑区MaskEditor；OpenAI原尺寸alpha；Flyelep签名mask-white转换+image-oriented源 | openai-provider透明/错尺寸/EXIF；tasks签名；flyelep-provider专门协议与mask | 未验 | UI真实绘制PNG1000×1500，alpha.min0/max255（web-ui自评） | 跨供应商协议分离；EXIF原件保留/模型坐标归一；实际模型效果未验 |
| F13 放大/超清 | fal AuraSR4倍；Flyelep enlarge/enhance | fal基础不含专门请求合同；静态协议 | 未验 | 工具表单入口 | fal仅4倍；2/8与强度需对应Flyelep，不是任意模型支持 |
| F14 抠图 | fal BiRefNet / Flyelep matting | 通用任务/产物校验 | 未验 | 工具入口 | 真实alpha与边缘质量未验 |
| F15 图片翻译 | OpenAI图像编辑、多语拆项；文字预检缓存按空间+源SHA+检测版本；无字原图返回且免平台结算；可强制翻译 | openai预检/强制/有字合同；tasks多语言/重启缓存/免扣恢复 | 未验 | GUI force=true保存项目→刷新→工具草稿恢复，素材/英语/说明保持；translation-force-draft-restored.jpg | 免平台费不代表供应商预检免费；仍需提交预留余额；识别漏字可强制，真实版式质量未验 |
| F16 替换/换色 | OpenAI/Flyelep工具映射、颜色组合子项 | 任务分项/通用合同；无全部专用端点测试 | 未验 | 工具入口 | 换主体/背景实际效果未验；重复颜色警告不完整 |
| F17 图片复刻 | 参考/商品图、prompt、通用编辑/生成 | 通用任务与参考透传 | 未验 | 工具入口 | 新广告参考生成，不保证1:1；未见专用参考/结果对比器完整验收 |
| F18 创意视频复刻 | fal-extra Kling O1参考编辑，视频+图片 | 21扩展合同中的参考编辑、音轨/metadata | 未验 | 工具表单 | 单源3–10秒；不是多视频逐镜头复刻；保留原语义差异 |
| F19 1:1视频/裁剪 | 同Kling编辑+真实本机FFmpeg裁剪 | 原件probe/时间校验；无真实替换质量证据 | AI未验 | 入口/类型表单 | 四类身份/服饰/商品槽位并不等于四个专用模型；不可承诺精准1:1 |
| F20 社交链接导入 | 只有缺能力说明/禁用路径 | 无解析器合同 | **未实现解析适配** | 表单缺服务说明 | 不是仅差密钥；TikTok/抖音/小红书抓取未实现 |
| F21 主图打标 | 商品/布局/价格/卖点输入，provider映射 | 必填/组合校验；通用任务 | 未验 | 工具入口 | 字价可读性、位置与字符准确性未验 |
| F22 AI洗图 | OpenAI真实感重绘recipe `image-naturalize` | 通用OpenAI构造；未有独立自然化结果测评 | 未验 | 工具入口 | 通用图像编辑语义映射，不是原站专用算法；不承诺隐藏AI来源 |
| F23 多图融合 | OpenAI/Flyelep融合与local.stitch分离 | 本地真实拼接新回归；通用AI任务 | AI未验 | 工具草稿/素材排序入口 | 已删除local image-fusion伪能力；拼接/resize面积预检已修，7个本地文件回归通过 |
| F24 工具历史 | 组合状态/类型/项目/成员/日期/搜索/下载状态；个人归档恢复；真实产物+输入ZIP | delivery-regressions历史/跨空间/ZIP/上传幂等；tasks持久化 | 不涉及 | UI实际任务ZIP含600×900PNG与local.resize清单；筛选/归档入口 | 下载标记在取得Blob后写入，不能保证用户最终磁盘落盘；归档不删除账本 |
| F25 画布对象 | 独立SceneDocument+Fabric，位置/旋转/裁剪/文字/只读；EXIF逻辑尺寸 | 11 scene几何；image-orientation全部8方向真实JPEG | 不涉及 | ED桌面/390/视频帧/文件 | 视频画布导出是静态帧；下载原件保持原文件；不是完整排版软件 |
| F26 图层/撤销 | 多选/组合/层序/显隐/锁定/复制/历史 | 11 scene + document revision | 不涉及 | ED实际组合/撤销/移动/文本 | 已验证单次语义撤销；复杂嵌套仍受层数/深度预算 |
| F27 OCR/拆层 | OpenAI结构化regions+原图尺寸+有限坐标校验；OCRResultPanel点选→改字草稿；Qwen透明层整组应用 | openai-provider有效/越界/EXIF；fal-extra层合同；tasks分层入库原子性 | 未验 | 新OCR面板已接；未运行收费识别；ED实际组合 | 坐标明确model-estimate，需人工核对；Flyelep OCR仍纯文字；栅格拆层不等于PSD可编辑文字 |
| F28 视频后处理 | Kling编辑、LTX延长、RealESRGAN倍数、HeyGen口播翻译、Bria短片文字区域擦除 | fal-extra21：官方字段/语言/时长/禁自动裁剪；reference16 | 未验 | 参数入口与限制文案；字幕模型无真实推理 | Bria仅0<时长<5s的通用编辑，保留音轨、效果需确认，不保证专用OCR或无痕；口播翻译≠画面字幕翻译 |
| F29 待应用 | pending_applies、revision、原目标/新层/替换/丢弃 | tasks异步冲突/重复/分层group | 不涉及 | Workbench集成入口，结果层组主要合同 | 任务结果不会覆盖新文档；真实收费图组尚未验 |
| F30 版本 | DocumentService保存/恢复新revision、列表 | core版本冲突/恢复 | 不涉及 | UI保存/刷新/版本入口 | 原件保留；不等于无限永久保留运营服务 |
| F31 导出下载 | PNG/JPG、选层/整板/多项目ZIP；真实来源sidecar；服务端当前订阅解水印策略，全部应用导出统一标记 | scene11+bundle6+policy3；根API/share policy；浏览器实物像素 | 不涉及 | 多项目UI真实两张1200×900；ED裁切/倍数；水印2024px、豁免0差异、ZIP与单图字节相等；整合策略刷新遇服务中断拒绝导出，恢复后真实PNG1200×900 | 来源sidecar不是PNG嵌入；水印默认off/demo豁免，应用客户端渲染不冒充防绕过；原件下载独立 |
| F32 分享 | allowOriginalDownload持久化；签名token过期/撤销；原件禁用403，previewVariant仅已生成预览 | core新分享拒原件/旧迁移兼容/无预览视频；ED禁下载开关实测 | 不涉及 | PublicShare只读/缩略图不可播放说明；ED导出按钮隐藏实际DOM | 预览可截图/保存，不宣称禁止；没有预览的视频在原件未授权时不播放 |
| F33 项目/收藏 | Project/Library搜索/分页/CRUD/软删除 | core权限/持久化/收藏 | 不涉及 | UI新项目/刷新/收藏 | 部分日期/作者组合筛选未见完整合同；已删除素材有独立说明 |
| F34 素材/集合 | 真实原件/预览/缩略、tags/收藏/集合/文档提取 | core素材文件/隔离/提取/真实下载 | 不涉及 | UI集合新增/素材查看/原件 | 文件hash元数据存在，不代表跨空间物理去重；未冒充原站公共模特库 |
| F35 人脸授权认证 | 身份自述授权版本/撤回 + IdentityProvider接口与会话状态 | quality-workflows自述/假provider证据/到期/跨空间 | **真实认证适配未实现** | UI人物未认证；新授权页待末轮验证 | 只有接口注入契约，部署无实际FACE实现；不可说加密钥即完成实名认证 |
| F36 人物素材组 | references CRUD/revision、授权声明关联、characterId冻结revision并入真实参考 | quality-workflows素材变更/撤回；tasks撤回后不外呼 | 生成未验 | UI真实人物新建；授权后创作入口 | 历史产物保留；普通授权声明不标认证 |
| F37 品牌参考 | 多图/颜色字体/私有共享/CRUD/任务快照；EntitlementService品牌上限 | core私有品牌；tasks冻结；reference限量；entitlements创建/恢复/降级 | 未验 | UI品牌创建刷新 | 参考资料不是训练；真实模型品牌一致性未验 |
| F38 旧品牌模板订阅 | 当前无入口 | 不适用 | 不适用 | 不适用 | 阶段2保留非强制；未实现且不冒充现成功能 |
| F39 空间切换 | context取消旧查询、捕获wid、服务端requireAccess | core跨空间/被移除拒绝 | 不涉及 | UI创建团队/回个人 | 浏览器晚到响应隔离有代码与自评，所有竞态未穷举 |
| F40 成员角色 | invitation/roles/owner保护/导入撤回；成功邀请同事务入邮件outbox，默认关闭 | core邀请注册事务/过期/viewer/owner；mail-outbox真实SMTP23项（含createServices队列不可写回滚） | SMTP协议已实现；无真实外部发信 | UI真实viewer邀请/撤回；邮件disabled及空队列/筛选实际验证 | 关闭保留复制链接；排队≠送达，发信前重验邀请；token加密入队、接受后清除 |
| F41 团队额度 | credits事务shared/allocated/预留/预算/移除成员 | tasks余额/分配/并发/模式迁移 | 不涉及 | UI团队额度入口 | 平台预算单位≠供应商余额/现金 |
| F42 导入统计审计 | XLSX/CSV预览、成员导出、账本聚合、audit | core真实表格/行错误/重复；tasks统计数据源 | 不涉及 | UI页面与团队入口 | 自定义日界线/统计时区完整场景未浏览器验收 |
| F43 团队退出解散 | owner transfer/leave/archive、在途/预留阻断 | coreowner规则；tasks移除成员 | 不涉及 | UI团队入口/邀请 | 使用归档保留数据；真实付费席位运营未联调 |
| F44 登录会话 | 本地密码会话+首次owner/邀请；Google OIDC code+PKCE/state/nonce、显式绑定/解除、Google-only保护 | core/app；Google作者30项本机HTTP/RSA/SQLite；独审见phase-4-google-independent-review | Google协议已实现，真实Google授权未联调；微信/短信未实现 | UI本地登录；Google未配置入口隐藏、设置未关联、同邮箱提示、伪成功URL均实测 | 不按同邮箱自动合并；Google-only不能移除唯一登录；无本地密码恢复/Google风险推送 |
| F45 资料主题语言 | 真实偏好/主题/zh/en/ar；1617词条，Google/邮件状态新增已译 | AST当前1532静态中文0缺失（09:29:23Z）；动态后端不计 | 不涉及 | 整站EN深色刷新、AR390无溢出；编辑器EN/AR实测；新Google/邮件组件QA另记 | 用户数据不翻译；静态零缺词不是所有动态路径穷尽验证 |
| F46 套餐账本兑换 | 商业快照/兑换；资源席位并发权益；每日免费桶；credit_lots按到期优先预留、结算、封存、恢复、延期、退款原来源 | credit-lots20与tasks/billing/entitlements/quality/delivery/app作者报告92pass；真实SQLite+签名fixture | 未实际付款 | GUI CreditBuckets历史导入1000/未知期限/预留0，封存筛选空态；credit-buckets-live.jpg | 会员到期封存3UTC月；pack1年及有效同类延长；历史余额期限未知，赠送/兑换按本地明确规则，不冒充原站运营值 |
| F47 支付订阅 | Stripe Checkout/webhook签名/幂等/退款/风险/订阅取消、绑定订单的Stripe账单/PDF | billing 12（含账单授权/安全链接/在途撤权） + quality购买/退款/风险fixture | 未联调；需商户配置 | UI订单、支付返回提示 | 与正式审批套餐联动；不以success URL认支付；API前台独立现金账户未实现双账本 |
| F48 发票抬头 | 标题CRUD、本地申请/金额占用/撤回/退款复核 | core草稿；quality发票净额/释放 | **正式INVOICE适配未实现** | UI申请/详情入口待新回归 | 本地登记不发送、不生成正式票；不是仅差发票API key |
| F49 开放平台 | 可用API、一次明文Key摘要/scopes/到期/预算/OpenAPI | core实际Key/跨空间/撤销；app OpenAPI | API核心本地已测，模型外部未验 | UI开发者入口/文档 | 未把原站API Key自动导入；同本地任务/账本核心 |
| F50 通知工单申诉 | 站内通知/工单补充撤回/管理员审核退平台额度；真实事件触发加密持久邮件outbox、SMTP worker、只读状态/审计核对CLI | entitlements-appeals；mail-outbox23项真实TCP+SQLite含通知/回复、4xx重试/5xx永久失败/DATA不明/租约/权限 | 标准SMTP已实现，默认关闭；真实外部发信/客服工单商/短信未验或未接 | 工单补充/撤回持久化；邮件只读disabled/筛选/空状态实际验证 | accepted仅SMTP接受；不明结果不自动重发；客服外部商未适配；平台额度退款非现金退款 |
| F51 邀请渠道 | 开关默认关闭、推荐注册归因、正式付款奖励/退款反向、CSV渠道 | quality-workflows归因/首次购买/测试支付排除/退款/渠道 | 真实支付/外发未验 | ReferralDetails入口待末轮验证 | 规则由管理员启用；不承诺未开启现金或额度奖励 |
| F52 历史营销抽奖 | 当前不展示假活动 | 不适用 | 不适用 | 不适用 | 阶段2保留非强制，未实现 |

## 交付判定原则

这些实现已形成可运行的本地创作平台；本轮收敛了上传、会话、结构化 OCR、短片擦除、历史、ZIP、分享原件权限、会员限额及申诉退款的核心本地路径。不能称原平台所有功能和模型效果完全等效。仍未实现的外部适配包括 F20 社交链接解析、F35 正式认证、F44 微信/短信登录、F48 正式税务开票及外部客服商；这类差距不应写为“仅缺密钥”。Google OIDC与通用SMTP已补真实协议及离线合同，均默认关闭，未以真人账户/邮箱外部联调。已实现协议的 AI、Stripe、Google与SMTP必须配置后真实联调。F15无文字免平台费、F31水印会员规则、F46到期积分分桶已补实现与独立证据；这些本地规则是本项目明确的新规则，不代表已获得原站私有服务实现。当前模型不支持的音频参考、专用无痕字幕处理等按 capability 诚实关闭。

最终缺陷复评与新增测试结果见 `reviews/phase-4-independent-final.md`。父任务可补齐明确差距后更新此矩阵，但不得删除证据级别或把未调用的外部能力改为已验证。

## 根最终补充

Flyelep签名provider-media原图分支对有EXIF方向的图片规范化PNG，坐标与preview/mask一致；用户原件下载字节不变。拒绝未知/部分成功自动结算，语言代码转官方中文语种名，未启用分层在请求前拒绝。专用34合同覆盖白mask签名绑定及实际像素。

新增独立delivery-regressions 6项，验证上传幂等/历史/ZIP/人工核对/免费竞争；免费并发输家事务无残留。分享仅预览、撤销失效、权益实际计数、390px布局和多项目ZIP均已完成实际UI验收，截图与原文件见web-ui自评。


最终根门禁（09:39 UTC）：20 files/278 tests、typecheck/lint/format/build/verify:runtime全通过；17份迁移与实际demo校验值一致。0016原稿提前应用的问题以精确恢复原文+新增0018修复，实际升级保留原数据；备份恢复8原件/22变体SHA验证通过。Google与SMTP真实配置前仍默认关闭。
