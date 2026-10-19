# 分享视频导入：独立审查与修复复验

2026-10-16。两项原缺陷均已在本次代码快照中封住；原复现脚本独立重跑得到修复后结果，相关定向测试 **43/43 通过**。本次只新增审查文档与证据，没有修改产品源码、重启服务、访问原数据库或调用真实解析服务。

## 复现、修复与独立确认

| 问题 | 修复前独立复现 | 当前修复与修复后结果 |
|---|---|---|
| 非法重定向终止工作进程 | 模拟媒体服务器返回 `Location`（跳转地址）为 `https://[invalid`（非法地址）。响应回调抛出未捕获 `TypeError`（类型错误），下载异步结果没有被拒绝；模拟请求仅一次。 | [下载器](../../platform/src/server/providers/http.ts#L142) 对跳转地址解析增加异常捕获，将异常转为受控拒绝；入口非法地址也受控处理，并提前监听响应流错误。重跑原脚本：无未捕获异常，下载异步结果被拒绝，模拟请求一次。 |
| 保存失败与恢复累积孤儿原件 | 使用真实本机生成的视频、临时数据库及解析器替身，注入素材写入失败。前两次失败后原件文件分别为 1、2 个，素材记录均为 0；解除故障恢复成功后原件 3 个、素材记录 1 条。解析器始终只调用一次，问题是文件遗留，并非重复付费解析。 | [任务工作进程](../../platform/src/worker/runner.ts#L267) 以提交标记包住准备与持久化过程；事务提交成功才保留文件，其他退出路径在最终清理中调用 [准备文件清理方法](../../platform/src/server/core/assets.ts#L113)。重跑原脚本：前两次失败后原件均为 0；恢复成功后原件 1 个、素材记录 1 条，解析器仍只调用一次。 |

原始脚本与原始输出逐字节复制保存，没有覆盖修复前证据。四个原件的摘要及复制一致性见 [原件清单](evidence/social-import/original-manifest.json)。

- 非法跳转：[原始脚本](evidence/social-import/yingzao-social-redirect-review.mjs)、[修复前输出](evidence/social-import/yingzao-social-redirect-review.txt)、[修复后输出](evidence/social-import/redirect-after-fix.txt)。输出字段 `uncaught`（未捕获异常）、`downloadPromiseRejected`（下载异步结果是否拒绝）、`simulatedRequests`（模拟请求次数）分别由“类型错误、否、1”变为“否、是、1”。
- 保存失败：[原始脚本](evidence/social-import/yingzao-social-save-review.mts)、[修复前输出](evidence/social-import/yingzao-social-save-review.txt)、[修复后输出](evidence/social-import/save-after-fix.txt)。输出字段 `parserCalls`（解析器调用次数）始终为 1；`originalFiles`（原件数量）由 1→2→3 变为 0→0→1；`assetRows`（素材记录数量）均按 0→0→1 变化。

两个脚本只使用明确写在脚本内的临时测试凭据；保存脚本通过系统临时目录创建并在退出时删除测试数据库和媒体文件。配置中的 4310 只是测试对象字段，脚本没有监听或连接该端口。跳转脚本替换本进程的域名解析与加密请求函数，不执行实际网络请求。原件保留本机绝对源码导入路径；仓库移动到其他目录后，需同步调整这些导入路径再运行。

## 独立执行命令与准确数量

以下命令均从项目的 `platform`（应用目录）运行；媒体工具使用项目内已安装的版本。

```sh
node --import tsx ../reviews/takeover/evidence/social-import/yingzao-social-redirect-review.mjs

PATH="$PWD/var/tools/ffmpeg-9.0.2-macos-arm64/bin:$PATH" node --import tsx ../reviews/takeover/evidence/social-import/yingzao-social-save-review.mts

PATH="$PWD/var/tools/ffmpeg-9.0.2-macos-arm64/bin:$PATH" pnpm exec vitest run tests/media-download.test.ts tests/tasks.test.ts tests/social-import.test.ts --reporter=json --outputFile=../reviews/takeover/evidence/social-import/targeted-tests.json
```

这里 `tsx`（源码执行器）、`pnpm`（包管理器）、`vitest`（测试运行器）、`json`（结构化报告格式）及 `ffmpeg`（媒体处理工具）均为现有项目依赖或本机测试工具；不需要供应商账号。

| 定向测试文件 | 通过数量 | 本次重点核对 |
|---|---:|---|
| `tests/media-download.test.ts`（媒体下载测试） | 4/4 | 非法跳转转为受控错误、每跳重验域名解析且拒绝内网、相对跳转仍沿用字节限制、错误响应流与非法入口地址 |
| `tests/tasks.test.ts`（任务测试） | 34/34 | 提交回滚后删除准备文件、复用已保存结果且供应商只调用一次、租约丢失时删除未提交产物、分层结果失败不留部分产物 |
| `tests/social-import.test.ts`（社交导入测试） | 5/5 | 输入域边界、已核对协议字段、权限与费用确认、同请求重放、下载失败后只恢复保存过程 |
| **合计** | **43/43** | 无失败 |

原始测试报告见 [结构化报告](evidence/social-import/targeted-tests.json)、[控制台输出](evidence/social-import/targeted-tests.txt)、[逐文件数量摘要](evidence/social-import/test-summary.json)。运行时间、精确命令、运行时版本、提交基线及所核对源码摘要见 [复验元数据](evidence/social-import/verification-metadata.json)；代码包含未提交修复，因此提交基线不能单独代表受测快照，应同时查看源码摘要。

## 审查边界

- 检查范围包括分享链接解析、固定解析器端点、任务输入权限、报价与请求幂等、结果保存与恢复、下载安全检查和准备文件清理。本次没有发现可复现的跨空间访问或重复解析收费问题。
- 来源输入限制为允许的分享域；解析结果下载限制为安全连接及公网地址，并逐跳重验和固定域名解析结果。该检查不证明返回文件必然来自指定社交平台，也没有真实验证平台内容、运营商网络或供应商收费行为。
- 协议请求、下载响应和供应商执行均使用测试替身；媒体文件与数据库操作真实发生在隔离临时目录。没有访问用户原库、真实配置、原媒体或现有服务。
- 本次复验确认正常文件权限下的异常清理、数据库回滚及已有租约丢失回归；没有模拟断电、进程被强制结束或操作系统拒绝删除文件。持久化的任务结果缓存仍用于恢复，不计为本次缺陷中的孤儿原件。
- 未开展本轮浏览器或真实社交平台端到端验证；不能将这些定向测试视为真实解析成功率或全部生产故障场景的证明。
