# 动态输入如何组成

这部分不是新增固定系统提示词，而是每个请求的用户消息及编译变量。英文字段为实际程序字段，后附中文释义；原文代码块不插入翻译。

## 文字规划节点

一次请求由 system（系统消息）的完整固定原文，以及 user（用户消息）的 `JSON.stringify(input)`（输入对象序列化文本）组成。模型只收到这两条消息；没有隐藏的多轮审稿消息。引用图片只有元数据，复刻时另有前序视觉观察文字。

| 字段 | 内容来源 |
| --- | --- |
| `version`（版本）、`requestId`（请求编号） | 本次准备请求 |
| `rawPrompt`（原始需求） | 用户本次输入 |
| `sourceTexts`（原文资料） | 本次需求、显式参考文字、已选商品信息、品牌信息及用户补充回答；不自动混入整个项目的旧聊天 |
| `previousSummary`（前次摘要） | 同一需求明确追问衔接时的旧摘要，可省略 |
| `answers`（补充回答） | 用户对当前问题的明确答复 |
| `materials`（素材信息） | 素材编号、名称、类型、角色、实测宽高和字节数；普通文字规划不含图片像素 |
| `context`（执行约束） | 当前入口类型、平台、用途、市场、语言、数量、画幅、分辨率、时长及服务端核实的能力；精确背景或视频另含核实后的输出尺寸 |
| `strategy.id`（策略编号）、`strategy.guidance`（策略指导） | 当前平台／用途／市场对应的规则和建议，见策略文案数据 |
| `replica`（复刻依据） | 仅复刻存在：自己的主体、参考作品、选择方面、实际视觉观察及服务端证据；观察不是用户指令 |

来源：[输入组装](/Users/xm-talen/Desktop/小明/coding/yingzao-studio-main1112/platform/src/server/tasks/creative-briefs.ts:709)、[实际发送两条消息](/Users/xm-talen/Desktop/小明/coding/yingzao-studio-main1112/platform/src/server/providers/native-planner.ts:421)。

规划结果的 `prompt`（完整创作说明）、`generationPlan.imagePrompt`（视频首帧说明）、`generationPlan.videoPrompt`（视频动作说明）由模型根据本次输入产生，不是源码里另写死的三份提示词；首帧和动作文本在同一次文字响应返回。`questions`（问题）只是交给用户回答，`reviewChecklist`（检查清单）只是交给用户核对，不启动新的模型节点。

## 复刻视觉节点

输入顺序固定：需求与片段时间信息 → 主体身份标记 → 自己的主体图 → 每个参考帧的编号、实际时间和图像。

唯一固定的主体标记原文是：

```text
主体图：保留这张图中的主体身份和结构，后面的图仅提供参考风格。
```

动态信息：`referenceKind`（参考类型），`request`（用户需求），`clipStartSeconds`（选段起点秒数），`clipDurationSeconds`（选段时长秒数），`referenceFrameCount`（参考帧数），`referenceTimeline`（实际采样时间轴）。每张参考帧另带 `frameIndex`（帧编号）、`timestampSeconds`（相对选段秒数）和 `sourceTimestampSeconds`（原视频实际秒数）。图片参考只有一张参考图；视频默认6个、可支持5至8个采样帧，不包含音频。

所有图像连同文字一起放进同一次视觉请求。先看主体图，再看参考图；视频不会每抽一帧都单独付费请求一次视觉模型。原始图片编码不收录在本文。

## 背景视觉节点

用户消息先放以下三个字段的结构化文本，再放一张原图：

```text
regionDescription = 本次允许改色的区域
preserveDescription = 必须保持的主体与前景
color = 已明确的六位背景色值
```

这三项分别是 regionDescription（编辑区描述）、preserveDescription（保护区描述）和 color（颜色），来自已校验的文字规划，不由视觉模型擅自改写授权。

视觉输出被代码拼成如下边界观察原文，再传给蒙版节点；不是再次调用文本模型：

```text
可改背景观察：${observation.backgroundDescription}
须保留区域观察：${observation.foregroundDescription}
边界关系：${observation.boundaryDescription}
```

其中 backgroundDescription（背景观察）、foregroundDescription（前景观察）、boundaryDescription（边界观察）是这一次视觉模型实际返回的文字。`uncertainties`（不确定项）另行传递；`sceneStructure`（场景结构）经校验后只控制适用本机算法，不变成新的用户授权。

如果 `scopeAmbiguity`（范围歧义）不是 `none`（无），服务端改为需要澄清，清除可执行提示词、局部编辑和生成计划，不进入报价或蒙版生成。用户补充后主动重新准备，可能再次产生文字／视觉费用。
