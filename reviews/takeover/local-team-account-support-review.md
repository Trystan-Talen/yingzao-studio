# 团队、账户、通知与帮助反馈：本地对照审查

2026-10-16，覆盖本次 F39–F43、F45、F50 对照主题。原站事实使用主代理本轮实见记录；本地对照以源码、现有合同与隔离测试为据。**本地确有多项完整能力，但不能据此宣称团队付费入口、消息中心分类、客服与反馈渠道已等价。** 对照完成后，已获授权并完成常见问题漏译、通知加载/错误/分页、团队角色漏译的最小修复，真实浏览器先红后绿；未改通知生成、权限、单条已读业务或字典。

## 已确认差异及最小范围

| 原站已见事实 | 本地证据与结论 | 建议最小范围 |
|---|---|---|
| 个人账户切换只有一个个人项；创建团队直接展示会员购买界面，未进入真实团队 | [空间菜单](../../platform/src/web/components/Layout.tsx#L147) 展示账户真实所属空间；[创建入口](../../platform/src/web/components/Layout.tsx#L318) 直接建空间；[服务端创建](../../platform/src/server/core/team.ts#L28) 未检查团队会员或账户创建数量。临时非演示账户连续创建两个团队均成功。入口商业规则不同，不能标为原站等价。 | 若需保持原站门禁，先在服务端统一核验团队创建权益，前端展示同一结果再引导已有购买流程；数量限制应以已确认政策配置，不删除已有团队。不要为补一个入口重写成员/角色系统。 |
| 团队成员、角色、退出、解散因会员门禁未验证 | 本地已有[四种角色](../../platform/src/contracts/core.ts#L8)、[服务端权限检查](../../platform/src/server/core/shared.ts#L74)、[邀请与席位核验](../../platform/src/server/core/team.ts#L172)、[退出/转让](../../platform/src/server/core/team.ts#L289)、[归档](../../platform/src/server/core/team.ts#L332)及对应界面。 | 记录为“本地已实现、原站详细语义未验证”。保留已有数据与权限边界，不因未知而判错或照猜测修改角色。 |
| 系统设置实见深色模式和生成配置确认开关；账户菜单实见英文、阿拉伯文选项 | 本地[偏好合同](../../platform/src/contracts/core.ts#L24)及[设置页](../../platform/src/web/pages/Settings.tsx#L62)提供主题、语言、生成确认及默认平台/创作语言；[账户偏好持久化](../../platform/src/server/core/auth.ts#L326)采用增量合并；[页面上下文](../../platform/src/web/context.tsx#L81)实际应用主题、语言及文字方向。默认平台等为本地扩展，非已证实的原站字段。 | 不删本地扩展。生成确认开关已经接线，见下方确认；修复实际漏译即可，不重建国际化机制。 |
| 消息中心有系统、审核分类；系统零未读且空，审核七未读但空 | 本地只有[单一通知抽屉](../../platform/src/web/components/Layout.tsx#L341)，[响应字段](../../platform/src/server/core/business.ts#L685)无分类或未读汇总；已有按用户和空间过滤与单条已读。加载/错误/历史分页已修复，但分类差异仍保留。 | 以真实本地消息数据新增分类及未读汇总，并保持内容与计数一致。不要复制原站“七未读却无内容”的异常或伪造七条历史。 |
| 客服展示微信二维码、电话、工作日服务时间 | [本地帮助页](../../platform/src/web/pages/Support.tsx#L112)仅有帮助卡片、常见问题、工单与邀请奖励，没有客服二维码、电话、时间或相应可用状态。 | 增加可配置的只读联系卡；未配置时明确说明。真实联系资料需由实例负责人提供，不冒用原站客服身份。无需新增通信供应商。 |
| 反馈入口打开飞书市场调研问卷，并非工单 | [本地反馈入口](../../platform/src/web/pages/Support.tsx#L131)打开工单表单，[提交](../../platform/src/web/pages/Support.tsx#L287)写入当前空间的本地记录；提示明确说明[不等于发送给外部客服](../../platform/src/web/pages/Support.tsx#L281)。 | 保留本地工单与申诉，另设配置化问卷入口并准确命名；未配置时不可把本地工单称为原站问卷。不要声称已经提交外部调研。 |

## 不依赖外部服务的明确问题

1. **常见问题漏译，已修复并通过浏览器验证。** 原[帮助页第153行](../../platform/src/web/pages/Support.tsx#L153)与[第156行](../../platform/src/web/pages/Support.tsx#L156)直接渲染中文标题、正文。[字典](../../platform/src/web/lib/i18n.ts#L3180)已有六组英/阿条目，[翻译实现](../../platform/src/web/lib/i18n.ts#L6086)只处理显式调用。主代理[真实浏览器红灯](baseline/environment-20261016/locale-account-help-red.txt)两项失败后，本次仅给这两处接入翻译函数；主代理随后[桌面/手机绿灯4项通过](baseline/environment-20261016/locale-account-help-green.txt)。
2. **通知失败误报为空，已修复。** 原抽屉没有加载/错误分支。现[加载与错误重试](../../platform/src/web/components/Layout.tsx#L342)明确区分成功空消息；[本查询](../../platform/src/web/components/Layout.tsx#L102)局部关闭自动重试，故障先展示给用户，点击重试继续访问真实接口。查询键保持用户当前空间隔离，现有刷新逻辑仍有效。
3. **第25条及更早通知不可达，已修复。** [通用接口分页](../../platform/src/server/core/shared.ts#L162)默认每页24条，原抽屉未提供翻页；现[分页控件](../../platform/src/web/components/Layout.tsx#L367)沿用原接口的页码、总数与页大小。真实临时库25条通知已验证24+1可达、单条已读保存、另空间通知不混入；切空间后按已有页面边界重置页码。
4. **团队角色名漏译，已修复。** [角色字典](../../platform/src/web/pages/Team.tsx#L78)保持服务端含义不变，概览[第224行](../../platform/src/web/pages/Team.tsx#L224)、成员表[第307行](../../platform/src/web/pages/Team.tsx#L307)、邀请记录[第366行](../../platform/src/web/pages/Team.tsx#L366)接入既有翻译。英/阿真实浏览器验证了概览与成员表，底层创建者角色仍保持不变。

## 已有能力与验证边界

- **生成前确认偏好存在且实际生效。** [设置状态](../../platform/src/web/pages/Settings.tsx#L73)、[偏好提交](../../platform/src/web/pages/Settings.tsx#L89)、[界面开关](../../platform/src/web/pages/Settings.tsx#L150)与[提交组件](../../platform/src/web/components/JobSubmit.tsx#L68)相连；关闭后仍先获取服务端报价，[随后提交](../../platform/src/web/components/JobSubmit.tsx#L152)。明确要求强制确认的操作仍可覆盖此偏好，是合理费用边界，不应为追求外观一致而取消。
- **空间切换确有隔离处理。** [切换流程](../../platform/src/web/context.tsx#L95)核验服务端激活、取消查询、清空缓存并刷新账户；[页面边界](../../platform/src/web/App.tsx#L104)按空间重新挂载；[服务端激活](../../platform/src/server/core/team.ts#L55)检查成员权限。未发现本次范围内的可复现跨空间读取问题。
- **本地工单确实持久化。** [创建/查询](../../platform/src/server/core/business.ts#L539)、[补充/撤回](../../platform/src/server/core/business.ts#L636)有权限与状态检查。临时测试创建反馈工单并补充一次，得到待处理记录和一条回复；这不证明已联系任何外部客服。
- 隔离复验得到“两团队创建成功、深色和英文偏好保存且关闭确认偏好不被重置、25条通知分为24+1且其他空间为零、本地反馈保存与补充成功”。[脚本](evidence/team-account-support/yingzao-team-account-support-review.mts)及[输出](evidence/team-account-support/yingzao-team-account-support-review.txt)只含临时测试数据，无真实密钥。脚本不监听或连接现有4310端口，退出清理临时数据库。
- 定向执行：`pnpm exec vitest run tests/core.test.ts tests/app.test.ts tests/entitlements-appeals.test.ts --testNamePattern 'invited new users|preserves truthful orders|enforces owner protection|merges only explicitly changed|refunds only the settled amount'`（包管理器执行测试，并按名称筛选邀请权限、所有者保护、工单、偏好与申诉通知）。结果 **5项通过，32项按筛选跳过**，见[原始日志](evidence/team-account-support/yingzao-team-account-support-tests.txt)。未重跑完整测试套件。

## 通知与角色修复的真实浏览器红绿

- [新增浏览器用例](../../platform/tests/e2e/notifications-team.spec.ts)使用既有隔离夹具，真实临时数据库写入25条本空间和1条另空间消息；正常请求、翻页、标为已读与空间激活均调用真实本机接口。仅加载测试延迟一次真实响应，错误测试注入一次失败，后续重试直接访问真实接口。没有伪造消息分类或未读数量，没有外部调用。
- 首次命令 `pnpm test:e2e notifications-team.spec.ts --project=desktop`（桌面端浏览器验收）：**5项按预期失败**，分别命中加载、错误、分页、英文角色、阿拉伯文角色；[日志](baseline/environment-20261016/notifications-team-red.txt)、[命令及时间元数据](baseline/environment-20261016/notifications-team-red.json)，完整报告与5张失败截图已归档至[红灯证据](e2e/20261016T084746Z/manifest.json)，原隔离运行目录为 `platform/var/e2e/run-3wSkPZ`。
- 修复后命令 `pnpm test:e2e notifications-team.spec.ts`（桌面与手机浏览器验收）：**10/10通过**，包含加载、单次错误后人工重试、24+1历史分页、已读业务、空间切换隔离及两种语言角色；[日志](baseline/environment-20261016/notifications-team-green.txt)、[命令及时间元数据](baseline/environment-20261016/notifications-team-green.json)，完整报告与4张英/阿角色截图已归档至[绿灯证据](e2e/20261016T084850Z/manifest.json)，原隔离运行目录为 `platform/var/e2e/run-mFSATm`。
- 类型检查、定向静态检查与格式检查均通过。通知生成、服务端权限、单条已读业务、字典及公共请求工具没有由本次实施修改；系统/审核分类和汇总仍属上表中的剩余差异。
