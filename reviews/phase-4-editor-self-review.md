# 阶段4：独立画布实现与自评

日期：2026-10-13（America/Los_Angeles）。范围仅为 `platform/src/contracts/scene.ts` 与 `platform/src/web/editor/**`；未把工作台的服务端保存、版本冲突或任务结果应用算作本组件已联调。

**结论：画布组件首轮实现及独立浏览器验收通过，可进入整站集成验收。** 真实原图、文字、视频静帧、图层分组与PNG/JPG输出均已实测。临时QA入口、测试MP4和5180预览进程已经移除/停止；未把测试素材或测试任务注入产品业务库。

## 实现范围

- 自有SceneDocument v1：text/image/video/shape/group，固定左上像素坐标、递归资产引用、源像素裁剪、视频真实时间、翻转/斜切、透明度、锁定/隐藏。总500层、8级分组和约6400万画布像素限制；深度在递归schema前用迭代检查。
- Fabric只作交互与渲染适配层；不把任意Fabric JSON写入业务文档。组内中心坐标转换显式；多选变换在保存前由Fabric恢复到各对象坐标面。
- 文字、矩形/椭圆、真实素材选择/上传接口、画布尺寸与背景、位置/尺寸/旋转/缩放/翻转、对齐、图层层序、锁定/隐藏、复制/删除、分组/取消、80步撤销/重做、平移缩放。
- PNG/JPG真实下载、1/2/3倍率、PNG透明背景和像素上限。离屏StaticCanvas复用同一适配器、等待字体、读取原图；缺失媒体会阻止导出，不输出假占位结果。
- 视频静帧、原件预览、区间设置和原件下载。明确静态导出不是视频；真实裁剪MP4交给服务器视频工具。
- 390px单面板模式、深色、RTL逻辑布局、图标可访问名称、键盘图层动作、移动面板方向键/Home/End、Dialog焦点与关闭，以及只读角色。

## 自评发现与已修正

1. FabricImage读取HTMLVideoElement.width/height，而非videoWidth/videoHeight。真实视频测试前明确写入解码尺寸，避免零尺寸和无限缩放。
2. 视频区间改变必须重新定位预览，不能只在首次loadedmetadata时定位；预览节点随区间更新重新初始化，画布静帧也按新trimStart读取。
3. 数字控件若逐键强制绑定有效数值，会拦住“-”和小数中间态。改为保留输入草稿、blur/Enter验证提交、Escape恢复，负数-25.5在浏览器通过。
4. 补齐移动tab方向键和roving focus，并给每个编辑器生成独立Dialog描述ID。
5. 旧媒体资源在对象真正被替换时释放，避免异步新场景尚未加载时先清空旧视频。
6. Fastify/Zod的response encoder不支持输入preprocess；额外导出纯shape的sceneDocumentOutputSchema供响应使用，并新增encode回归测试。请求继续使用有深度保护的schema。

## 自动检查

- `pnpm exec vitest run --config /tmp/yingzao-editor-vitest.config.mts`：11/11通过。根配置随后已纳入 `src/web/editor/**/*.test.ts`。
- `pnpm exec eslint src/contracts/scene.ts src/web/editor`：自有生产文件通过。
- 全项目TypeScript输出中scene/editor无错误；本轮检查时剩余三处均在并行实现中的Usage/Workbench，已通知UI作者，不能据此宣称全项目typecheck已通过。
- 几何测试包含旋转、非等比缩放、分组/取消后的矩阵一致性、旋转边界对齐、嵌套复制ID、锁定层不移动；数据测试包含越界视频、重复ID、2000级恶意输入不溢栈、总层数与画布面积、所有媒体引用和输出schema编码。

## 实际浏览器验收

使用独立Chrome QA页、React StrictMode，实际点击/键盘操作，无浏览器外的DOM脚本代操作。

| 场景 | 结果与证据 |
| --- | --- |
| 初始文字/图形、文字改写与旋转、原图加入 | 通过；文字修改显示于画面，原创护肤图以原图加载 |
| 多选分组、快照保存、刷新恢复、取消分组、撤销重做 | 通过；恢复后对象与画面仍在，取消分组恢复3个顶层图层。这里验证的是文档往返，SQLite保存由整站另测 |
| PNG 1×真实下载 | `editor-export-1000x800.png`，Sharp验证format=png、1000×800、4通道；逐图查看与编辑器一致 |
| JPG 2×真实下载 | `editor-export-2000x1600.jpg`，Sharp验证format=jpeg、2000×1600、3通道 |
| 下载工具事件 | CUA download事件20秒超时，但浏览器已实际落盘Downloads；通过该实际文件而不是仅靠成功文案确认导出 |
| 390px画布/图层/属性 | 通过；没有页面横溢，面板独立，关键关闭/导出可达；`editor-mobile-layers.png` |
| 深色与只读 | 深色字段/文字可读，媒体未反色；只读删除/新增/修改工具消失，查看与导出保留；`editor-mobile-dark.png` |
| 移动键盘与负坐标 | 画布tab按ArrowRight正确切图层并移焦；X=-25.5提交后保留 |
| 真实视频与静态导出 | FFmpeg创建2秒640×360测试MP4，0.5s静帧正确显示并输出；`editor-video-frame.png`、`editor-video-static-export.png`中时间码00:00:00.500 |

截图位于 `reviews/screenshots/`。临时QA入口HMR曾触发其入口重复createRoot警告，页面重新加载后完成验证；临时入口已删除。正式应用入口的完整浏览器日志仍须整站验收，不把临时页面测试当作生产入口验证。

## 集成约束与后续验收

Workbench负责认证上传、保存expectedRevision、版本、冲突/另存与pendingApply；应传入getSceneAssetIds(scene)的全部素材，不能只传素材列表第一页。媒体下载授权与range、真实MP4剪辑、数据库恢复、任务竞态和团队权限必须在整站验收中验证。本组件报告不宣称供应商推理、付款或原站行为等效。

## F31 导出补齐复评（2026-10-14）

新增整画布/选中层裁切/逐层ZIP/多画板ZIP。选区取实际Fabric对象的旋转后包围框，重新从原件渲染，不截图编辑器或使用预览图替代。ZIP含manifest.json；用户显式选择包含来源时只导出实际存在的document/revision/sourceJobId及已有参数，不伪造PNG内嵌AI来源证明，也不导出无关任务。

实际Chrome独立harness验收（本地生成的测试数据，无外部推理）：

- 原图1000×1500中的600×400裁片，以图层150×100导出；真实下载文件Sharp确认PNG150×100，已存`screenshots/editor-selected-original-150x100.png`。
- 同时选中裁片与旋转30°矩形，逐层ZIP含150×100与108×97两个PNG及manifest。逐条尺寸、来源关联和缺来源声明核对通过，归档`editor-selected-layers.zip`。
- 两个500×400/600×400画板，倍率2输出1000×800、1200×800，实际ZIP解包并检查透明像素与图像，归档`editor-multiboard.zip`；图像`screenshots/editor-multiboard-1000x800.png`。
- `allowOriginalDownload=false`后DOM导出按钮数量0；组件导出逻辑与原件视频链接也拒绝。`originalAvailable=false`不能被exportScene绕过为原件导出。分享视频`playable=false`只显示授权缩略图，不将JPEG当视频解码；预览裁剪按原件/预览比例换算。
- CUA第一次download事件等待超时，但浏览器实际产生文件；最终证据是本机下载文件解码与ZIP内容，不以toast或超时事件判断成功。
- 新5个ZIP测试验证实际归档结构/路径净化/尺寸记录/来源过滤/参数缺失/选择传递/总像素预算/取消。连同11 scene测试16/16通过。

导出单图上限约64MP、32768单边，ZIP≤20项/128MP总像素/150MiB媒体，顺序渲染，失败不下载半ZIP。独立harness已删除，测试Vite实例将停止。多画板能力通过可选exportBoards或exportSceneBundle提供；当前工作台的一项目一文档不会凭空生成多画板，应用层须明确选择多个文档才能用该能力。
