# F31 应用导出水印与会员豁免复评

时间：2026-10-14 09:05 UTC。原站证据只支持普通导出带水印、会员无水印的入口与静态分支（research/locale-canvas.txt、static-feature-audit.md、static-feature-matrix.md F31），不能据此推断原站具体商用会员价格或防复制机制。本项目采用独立、明确且可配置的规则。

## 实现

`contracts/export-policy.ts` 定义严格 ExportPolicySchema 与服务端 resolveExportPolicy：部署默认 off；可选 all 或 non-subscribers；演示空间始终豁免；non-subscribers 使用当前有效订阅权益决定豁免。有效期/退款后的订阅资格由已有 EntitlementService 获取，客户端不能凭查询参数自称会员。配置 text、opacity 有长度/字符/可见性限制。不需要数据库迁移0014。

根已接认证 GET /export-policy 与匿名分享 read DTO 策略；前端 Workbench、ProjectExport、PublicShare 导出前重新请求策略，读取失败中止。CanvasEditor 初次策略尚未返回时显示待核对，不提前声称无水印。独立编辑器保留纯组件接口，resolveExportPolicy 可注入；不存在服务端策略的独立使用在manifest如实记为 no-server-policy-provided。

真实导出在Fabric完成尺寸、缩放和选区裁切后，于最终像素画布绘制右下角半透明标记。因此整画布、选区、单层ZIP、多板ZIP、PNG透明与JPEG统一执行；不把水印添加到用户可编辑SceneDocument。ZIP manifest保存policy版本、空间、时间、原因、文案、透明度和applied状态。水印只适用于应用渲染导出，原素材下载不受此规则限制；不是客户端防篡改、DRM或防截图承诺。

## 验证

- `tests/export-policy.test.ts`：默认/演示/有效订阅/订阅失效/all模式、无效或矛盾策略、manifest诚实范围。
- `editor/export-bundle.test.ts`：每个画板/选区传同一实际policy，manifest记录该policy，不根据测试fixture伪称像素已验。
- 配合原scene测试共20/20通过；最终TypeScript和修改文件ESLint通过（09:04 UTC）。API身份/匿名分享刷新合同由根新增至app.test.ts，并入最终全量门禁。
- CUA Chrome扩展request-header策略暂不可用；改用工具提供的原生Chrome AX，独立本地5180测试页完成真实渲染与下载。没有使用外部模型或改正式空间策略。
- `yingzao-watermark-qa.zip`包含真实浏览器生成的无印/有印/会员豁免/选区/透明PNG/2倍JPG以及双条目嵌套ZIP。`watermark-pixel-results.json`记录Sharp与JSZip实测：有印320×240与无印相比2024像素变化；会员豁免与无印像素完全一致；选区100×80仍有2024水印像素；透明版保持2024半透明水印像素；JPG640×480；ZIP图像字节与各自单图严格相等。
- 原生CanvasEditor实际点击“生成并下载”刷新策略1次，所得文件与marked.png字节相等。开启测试用失败开关后再次点击，策略刷新次数变2，弹窗显示“QA策略服务失败”，没有新下载，截图 `screenshots/watermark-policy-failure.png`。
- 视觉检查 `screenshots/watermark-marked.png`、`watermark-selected.png`：完整图与裁切选区标记均在边界内，可读，不改变原画布构图/导出尺寸。
- 临时harness两个文件已删除，5180进程已停止，仅关闭该测试标签；产物证据保存在reviews，不把临时组件状态说成真实会员购买成功。

结论：本地F31水印与豁免渲染通过，实际会员购买由Stripe合同与待真实商户联调分别记录。默认off保留本地演示无水印，不伪装已经购买或强制付费。
