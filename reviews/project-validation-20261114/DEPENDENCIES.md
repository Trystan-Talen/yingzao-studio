# 生产依赖修补与静态服务边界

本轮生产依赖审计从2项中危降为0项。未变更应用技术栈，未运行正式数据库或外部模型。原始审计保留在 [修前报告](evidence/dependency-audit-red.json)，修复后见 [生产审计](evidence/dependency-audit-green.json)。结果仅代表本次生产依赖审计，不代表全部开发依赖或未来公告均无风险。

## 公告核对与影响判断

- `glob`（路径匹配库）取消后仍可能继续遍历，影响依赖取消信号限制遍历成本的调用；维护者修复版本为14.0.2。见[维护者公告](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)。
- `minimatch`（模式匹配库）在可控匹配模式、优化级别至少2时可能放大计算量；维护者修复版本为11.0.1。见[维护者公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)。
- 当前公开静态目录和文档插件使用默认通配路由，未把请求地址作为上述匹配模式，也未依赖取消信号限制该遍历。本次没有证明存在对应的远程触发路径；仍将生产依赖升级到修复版本，不把“未复现利用”写成依赖安全。

## 最小升级

直接依赖只将 `@fastify/static`（静态服务插件）从10.1.6升至10.1.9。这是上游补丁系列中开始正式使用14版路径匹配库的版本；现有文档插件要求的10版范围也允许该版本。见[上游发布说明](https://github.com/fastify/fastify-static/releases/tag/v10.1.9)与[文档插件依赖声明](https://raw.githubusercontent.com/fastify/fastify-swagger-ui/v6.1.2/package.json)。

锁文件仅改变该子树：静态插件10.1.9、文件发送4.2.1、路径匹配14.0.6、模式匹配11.0.8、目录遍历3.0.0，并新增非递归匹配1.1.0。未添加强制覆盖，未升级其他直接依赖。新的两个匹配包同时保留模块加载兼容，运行时版本范围覆盖项目现有22版；见[路径匹配声明](https://raw.githubusercontent.com/isaacs/node-glob/v14.0.6/package.json)与[模式匹配声明](https://raw.githubusercontent.com/isaacs/minimatch/v11.0.8/package.json)。实际模块解析结果见 [依赖链](evidence/dependency-resolution.json)。

安装使用固定锁文件、官方包仓库、隔离应用环境，以及项目既有原生安装脚本白名单。原依赖目录记录来自另一机器的缓存位置，首次安装安全退出；之后重新安装成功。未读取用户包仓库凭据或应用环境文件。安装记录见 [日志](evidence/dependency-install.log)。

## 静态目录修复

隔离探针在公开构建目录放入测试用 `.env`（点文件），修复前确实可读。此证据只证明意外放入公开目录的点文件会被发布，**不证明正式凭据曾经泄漏**。应用现只对公开构建目录显式设置 `dotfiles: 'deny'`（拒绝点文件）。源码与公开资源中未发现需要本机点路径的功能；谷歌发现地址是外部请求，不受此配置影响。

修前 [4项中1项失败](evidence/static-boundary-before-update.json)；修后 [4项全部通过](evidence/static-boundary-green.json)，包括公共样式、单页路由、点文件拒绝、接口404、文档页面/两种规范格式鉴权，以及私有媒体鉴权和原件字节一致。文档插件的公共样式本来不含应用数据，继续允许匿名读取。

新增探针调试中的三处假设错误也保留：公共文档样式误要求登录、生产首次注册使用非本机源站、缓存头误要求额外的private（私有）标记。最终分别按现有合同检查公共样式、本机初始化和no-store（禁止缓存）；未为通过测试修改应用鉴权。对应中间报告以 `static-boundary-interim`、`static-boundary-fixture-registration`、`static-boundary-fixture-cache` 为文件名前缀。

## 验证与最终边界

- 核心及媒体回归57项全部通过，见 [回归报告](evidence/dependency-media-regression.json)。与静态专项合计61项是本专项范围，不替代最终全仓验收。
- 类型检查、改动源码/测试/依赖清单的规范和格式检查通过；前后端构建通过，构建关闭环境文件加载，见 [构建日志](evidence/dependency-build.log)。锁文件保持包管理器生成格式。
- 最终改动：`platform/package.json`（依赖清单）、`platform/pnpm-lock.yaml`（锁文件）、`platform/src/server/app.ts`（静态目录配置）、`platform/tests/production-http.test.ts`（回归）。产品源码已冻结，完整验收由主任务统一执行。
- 开发工具链仍保留 `@typescript-eslint/typescript-estree`（语法分析器）8.71.2 → `minimatch`（模式匹配库）10.2.6。只读核对实际安装代码：唯一调用在 `useProgramFromProjectService.js`（项目服务程序选择），匹配模式来自 `allowDefaultProject`（允许默认项目的配置列表），传入选项仅为 `dot: true`（包含点路径）；匹配库默认优化级别为1，公告涉及的预处理仅在至少2时进入。项目的 `eslint.config.js`（静态检查配置）没有启用项目服务或提供该模式列表。因此当前调用不满足公告触发条件，也没有来自应用请求或上传资料的模式入口；这不消除旧依赖本身的公告。为保持此次修复范围和开发工具兼容，本轮不跨主版本强制覆盖，后续随工具链上游补丁处理，并在改变检查配置时重新评估。
