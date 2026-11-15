export const CREATIVE_TRANSLATIONS: Record<string, { en: string; ar: string }> = {
  请在文本服务中配置视觉分析模型后使用爆款复刻: {
    en: 'Configure a vision analysis model in the text connection before using reference recreation.',
    ar: 'اضبط نموذج تحليل بصري في اتصال النص قبل استخدام إعادة الإنشاء بالمرجع.',
  },
  视频参考分析需要本机媒体处理工具: {
    en: 'Video reference analysis requires local media tools.',
    ar: 'يتطلب تحليل الفيديو المرجعي أدوات وسائط محلية.',
  },
  创作模式: { en: 'Creation mode', ar: 'وضع الإنشاء' },
  原创: { en: 'Original', ar: 'أصلي' },
  参考复刻: { en: 'Reference recreation', ar: 'إعادة الإنشاء بالمرجع' },
  复刻素材与参考要点: {
    en: 'Recreation materials and reference aspects',
    ar: 'مواد إعادة الإنشاء وجوانب المرجع',
  },
  '借鉴参考的构图、光线或节奏，保留你的主体。先分析并确认方案，效果不保证成为爆款。': {
    en: 'Adapt composition, lighting or pacing from the reference while preserving your subject. Review the analysis and plan before generating; popularity is not guaranteed.',
    ar: 'استلهم التكوين أو الإضاءة أو الإيقاع من المرجع مع الحفاظ على موضوعك. راجع التحليل والخطة قبل الإنشاء؛ لا يوجد ضمان للانتشار.',
  },
  风格参考图片: { en: 'Style reference image', ar: 'صورة مرجعية للأسلوب' },
  节奏与镜头参考视频: {
    en: 'Pacing and camera reference video',
    ar: 'فيديو مرجعي للإيقاع وحركة الكاميرا',
  },
  需要保留的主体图片: { en: 'Subject image to preserve', ar: 'صورة الموضوع المطلوب الحفاظ عليه' },
  参考要点: { en: 'Reference aspects', ar: 'جوانب المرجع' },
  构图: { en: 'Composition', ar: 'التكوين' },
  光线: { en: 'Lighting', ar: 'الإضاءة' },
  配色: { en: 'Palette', ar: 'الألوان' },
  镜头运动: { en: 'Camera movement', ar: 'حركة الكاميرا' },
  节奏: { en: 'Pacing', ar: 'الإيقاع' },
  '参考选段起点（秒）': {
    en: 'Reference clip start (seconds)',
    ar: 'بداية المقطع المرجعي (ثوانٍ)',
  },
  '参考选段时长（秒）': {
    en: 'Reference clip duration (seconds)',
    ar: 'مدة المقطع المرجعي (ثوانٍ)',
  },
  '只分析并参考这段视频，时长2至15秒。': {
    en: 'Only this 2\u201315 second clip is analyzed and used as a reference.',
    ar: 'يُحلل هذا المقطع فقط وتُستخدم مدته من ثانيتين إلى 15 ثانية كمرجع.',
  },
  参考区间: { en: 'Reference range', ar: 'النطاق المرجعي' },
  '参考复刻需要已配置的原生创作服务。': {
    en: 'Reference recreation requires a configured native creation service.',
    ar: 'تتطلب إعادة الإنشاء بالمرجع خدمة إنشاء أصلية مُهيأة.',
  },
  '请先配置可读取参考画面的视觉分析模型。': {
    en: 'Configure a vision analysis model that can read the reference images first.',
    ar: 'اضبط أولاً نموذج تحليل بصري يستطيع قراءة الصور المرجعية.',
  },
  '请分别添加一份参考素材和一张需要保留的主体图片。': {
    en: 'Add one reference and a separate subject image to preserve.',
    ar: 'أضف مرجعاً واحداً وصورة منفصلة للموضوع المطلوب الحفاظ عليه.',
  },
  '参考素材与主体图片必须是不同素材。': {
    en: 'The reference and subject image must be different assets.',
    ar: 'يجب أن يكون المرجع وصورة الموضوع ملفين مختلفين.',
  },
  '主体必须是图片，参考素材类型须与当前图片或视频创作一致。': {
    en: 'The subject must be an image; the reference must match the image or video creation type.',
    ar: 'يجب أن يكون الموضوع صورة، وأن يطابق المرجع نوع الإنشاء: صورة أو فيديو.',
  },
  '请至少选择一项参考要点。': {
    en: 'Choose at least one reference aspect.',
    ar: 'اختر جانباً واحداً على الأقل من المرجع.',
  },
  '参考视频选段须为2至15秒，并且不能超出原视频。': {
    en: 'The reference clip must last 2\u201315 seconds and stay within the source video.',
    ar: 'يجب أن تتراوح مدة المقطع المرجعي بين ثانيتين و15 ثانية وألا تتجاوز الفيديو الأصلي.',
  },
  '视觉分析模型（可选）': {
    en: 'Vision analysis model (optional)',
    ar: 'نموذج التحليل البصري (اختياري)',
  },
  '参考复刻需要能读取图片的视觉模型。可从同一目录选择或手动填写，文本规划模型保持独立。': {
    en: 'Reference recreation needs a vision model that can read images. Choose from the same catalog or enter an ID; the text planning model remains independent.',
    ar: 'تحتاج إعادة الإنشاء بالمرجع إلى نموذج بصري يقرأ الصور. اختر من الدليل نفسه أو أدخل المعرّف؛ يظل نموذج التخطيط النصي مستقلاً.',
  },
  参考复刻方案: { en: 'Reference recreation plan', ar: 'خطة إعادة الإنشاء بالمرجع' },
  '根据抽帧分析迁移运镜与节奏，不直接传整段视频；未分析音轨，不保证逐帧复制。': {
    en: 'Camera movement and pacing are adapted from sampled frames. The full video is not sent; audio is not analyzed and frame-by-frame copying is not guaranteed.',
    ar: 'تُستمد حركة الكاميرا والإيقاع من إطارات مأخوذة من الفيديو. لا يُرسل الفيديو كاملاً، ولا يُحلل الصوت، ولا يُضمن النسخ إطاراً بإطار.',
  },
  采样画面与运动判断: {
    en: 'Sampled frames and motion assessment',
    ar: 'الإطارات المأخوذة وتقييم الحركة',
  },
  主体与场景转化方案: { en: 'Subject and scene adaptation plan', ar: 'خطة تكييف الموضوع والمشهد' },
  本次参考的局限: { en: 'Limits of this reference analysis', ar: 'حدود تحليل هذا المرجع' },
  查看生成方案: { en: 'View the generation plan', ar: 'عرض خطة الإنشاء' },
  '正在读取本次复刻方案…': {
    en: 'Loading this recreation plan\u2026',
    ar: 'جارٍ تحميل خطة إعادة الإنشاء…',
  },
  '本次复刻方案未能读取或已失效，请重新核对后确认。': {
    en: 'This recreation plan could not be loaded or is no longer valid. Review it again before confirming.',
    ar: 'تعذر تحميل خطة إعادة الإنشاء أو لم تعد صالحة. راجعها مجدداً قبل التأكيد.',
  },
  重试读取方案: { en: 'Retry loading the plan', ar: 'إعادة محاولة تحميل الخطة' },
  '正在加载背景区域蒙版…': {
    en: 'Loading the background area mask…',
    ar: 'جارٍ تحميل قناع منطقة الخلفية…',
  },
  '背景区域蒙版加载失败，请关闭后重新打开；当前不能编辑或提交。': {
    en: 'The background mask could not be loaded. Close and reopen this dialog; editing and submission are disabled.',
    ar: 'تعذر تحميل قناع الخلفية. أغلق مربع الحوار وأعد فتحه؛ التحرير والإرسال معطلان.',
  },
  '背景区域蒙版尺寸与原图不一致，请关闭后重新打开；当前不能编辑或提交。': {
    en: 'The background mask dimensions do not match the original. Close and reopen this dialog; editing and submission are disabled.',
    ar: 'أبعاد قناع الخلفية لا تطابق الصورة الأصلية. أغلق مربع الحوار وأعد فتحه؛ التحرير والإرسال معطلان.',
  },
  柔边不叠加: { en: 'Non-accumulating soft edges', ar: 'حواف ناعمة دون تراكم' },
  '同一工具、大小和柔度下，分段与回描不叠加；换参数或保存后重新开始。关闭后按笔叠加。': {
    en: 'With the same tool, size and softness, separate strokes and retracing do not accumulate. Changing settings or saving starts a new pass. Turn off to accumulate each stroke.',
    ar: 'عند استخدام الأداة والحجم والنعومة نفسها، لا تتراكم الضربات المنفصلة أو إعادة التتبع. يبدأ مسار جديد عند تغيير الإعدادات أو الحفظ. عطّل الخيار لتراكم كل ضربة.',
  },
  背景颜色: { en: 'Background color', ar: 'لون الخلفية' },
  调整背景区域: { en: 'Adjust background area', ar: 'تعديل منطقة الخلفية' },
  '核对并修正区域后仅在本机合成，不调用模型，原候选保留。': {
    en: 'Review and adjust the area, then composite locally without model calls. The original candidate is kept.',
    ar: 'راجع المنطقة وعدّلها، ثم ادمج محلياً دون استدعاء نماذج. تُحفظ النسخة المرشحة الأصلية.',
  },
  '自动蒙版是待核对候选。请检查主体轮廓、台面、阴影和所有边缘，保存确认后的区域。': {
    en: 'The automatic mask is an unreviewed candidate. Check the subject outline, surface, shadows and all edges, then save the confirmed area.',
    ar: 'القناع التلقائي مرشح لم تتم مراجعته. تحقّق من محيط العنصر والسطح والظلال وجميع الحواف، ثم احفظ المنطقة المؤكدة.',
  },
  本次本机合成: { en: 'This local composition', ar: 'هذا الدمج المحلي' },
  确认区域并本机合成: {
    en: 'Confirm area and composite locally',
    ar: 'تأكيد المنطقة والدمج محلياً',
  },
  背景区域本机合成: { en: 'Local background composition', ar: 'دمج الخلفية محلياً' },
  '请先保存确认的背景区域。': {
    en: 'Save the confirmed background area first.',
    ar: 'احفظ منطقة الخلفية المؤكدة أولاً.',
  },
  '本机修正报价不是0积分，已停止，请核对。': {
    en: 'The local correction quote is not 0 credits. Processing stopped; please review it.',
    ar: 'عرض سعر التصحيح المحلي ليس 0 نقطة. تم إيقاف المعالجة؛ يرجى المراجعة.',
  },
  背景区域已保存: { en: 'Background area saved', ar: 'تم حفظ منطقة الخلفية' },
  边缘柔和度: { en: 'Edge softness', ar: 'نعومة الحواف' },
  在原图上调整需要替换的背景区域: {
    en: 'Adjust the background area to replace on the original image',
    ar: 'عدّل منطقة الخلفية المراد استبدالها في الصورة الأصلية',
  },
  '白色覆盖区替换背景；橡皮恢复原图保护区。请检查主体、台面和阴影，软边用于自然过渡。': {
    en: 'White areas replace the background; the eraser restores protected original pixels. Check the subject, surface and shadows. Soft edges create a gradual transition.',
    ar: 'تستبدل المناطق البيضاء الخلفية؛ وتعيد الممحاة وحدات الصورة الأصلية المحمية. تحقّق من العنصر والسطح والظلال. توفّر الحواف الناعمة انتقالاً تدريجياً.',
  },
  保存背景区域: { en: 'Save background area', ar: 'حفظ منطقة الخلفية' },
  '背景候选 · 待核对': {
    en: 'Background candidate · Review needed',
    ar: 'خلفية مرشحة · تحتاج إلى مراجعة',
  },
  '背景区域由模型识别，当前为待核对候选；请检查后调整并确认。': {
    en: 'The model identified this background area as a candidate. Review, adjust and confirm it.',
    ar: 'حدّد النموذج منطقة الخلفية هذه كمرشح. راجعها وعدّلها وأكدها.',
  },
  '背景按已确认区域在本机合成，原候选仍保留。': {
    en: 'The background was composited locally using the confirmed area. The original candidate is kept.',
    ar: 'تم دمج الخلفية محلياً باستخدام المنطقة المؤكدة. تُحفظ النسخة المرشحة الأصلية.',
  },
  完成: { en: 'Done', ar: 'تم' },
  'Seedream（豆包生图）': { en: 'Seedream (image generation)', ar: 'Seedream (توليد الصور)' },
  'Seedream 5.0 Lite（豆包生图）': {
    en: 'Seedream 5.0 Lite (image generation)',
    ar: 'Seedream 5.0 Lite (توليد الصور)',
  },
  早上好: { en: 'Good morning', ar: 'صباح الخير' },
  中午好: { en: 'Good day', ar: 'طاب يومك' },
  下午好: { en: 'Good afternoon', ar: 'طاب مساؤك' },
  晚上好: { en: 'Good evening', ar: 'مساء الخير' },
  今天想: { en: 'Today, imagine', ar: 'تخيّل اليوم' },
  更多偏好: { en: 'More preferences', ar: 'تفضيلات إضافية' },
  继续此项目草稿: {
    en: 'Continue this project draft',
    ar: 'متابعة مسودة هذا المشروع',
  },
  '模型信息已重新核查，草稿已保留。请再次点击生成并确认报价。': {
    en: 'Model information was refreshed and your draft is saved. Click Generate again to review and confirm a new quote.',
    ar: 'تم تحديث معلومات النموذج وحفظ مسودتك. انقر على إنشاء مرة أخرى لمراجعة عرض سعر جديد وتأكيده.',
  },
  '模型信息未能更新，草稿已保留。请刷新模型信息后再次确认报价。': {
    en: 'Model information could not be refreshed. Your draft is saved. Refresh model information before confirming a new quote.',
    ar: 'تعذر تحديث معلومات النموذج. تم حفظ مسودتك. حدّث معلومات النموذج قبل تأكيد عرض سعر جديد.',
  },
  'Amazon（亚马逊）': { en: 'Amazon', ar: 'أمازون' },
  'TikTok（海外短视频平台）': { en: 'TikTok', ar: 'تيك توك' },
  '写一句想法，或选择下方灵感，就可以开始。': {
    en: 'Write an idea or choose an inspiration below to get started.',
    ar: 'اكتب فكرة أو اختر إلهاماً أدناه للبدء.',
  },
  '参数已更新 · 查看来源': {
    en: 'Parameters updated · View sources',
    ar: 'تم تحديث المعلمات · عرض المصادر',
  },
  '模型可用 · 使用已接入参数': {
    en: 'Model available · Using configured options',
    ar: 'النموذج متاح · استخدام الخيارات المهيأة',
  },
  没有找到相关工具: { en: 'No matching tools', ar: 'لا توجد أدوات مطابقة' },
  '换一个关键词，或清空筛选查看全部工具。': {
    en: 'Try another keyword or clear filters to see all tools.',
    ar: 'جرّب كلمة أخرى أو امسح المرشحات لعرض جميع الأدوات.',
  },
  本机工具: { en: 'Local tools', ar: 'أدوات محلية' },
  转换图片格式: { en: 'Convert an image to another format', ar: 'حوّل الصورة إلى صيغة أخرى' },
  把多张图片拼成一张长图: {
    en: 'Stitch images into one long image',
    ar: 'ادمج الصور في صورة طويلة واحدة',
  },
  截取需要的视频片段: {
    en: 'Keep the part of a video you need',
    ar: 'احتفظ بالمقطع الذي تحتاجه من الفيديو',
  },
  我的素材: { en: 'My assets', ar: 'موادي' },
  你的创作工作室: { en: 'Your creative workspace', ar: 'مساحة إبداعك' },
  '今天，想做点什么？': { en: 'What will you create today?', ar: 'ماذا ستبدع اليوم؟' },
  '从一张图片、一段视频，或一套商品详情页开始。': {
    en: 'Start with an image, a video, or a complete product story.',
    ar: 'ابدأ بصورة أو فيديو أو صفحات متكاملة لمنتجك.',
  },
  '主图、海报、品牌视觉': {
    en: 'Product shots, posters and brand visuals',
    ar: 'صور المنتجات والملصقات والهوية البصرية',
  },
  '产品短片、动态镜头': {
    en: 'Product films and scenes in motion',
    ar: 'أفلام المنتجات والمشاهد المتحركة',
  },
  '策划、逐屏确认、整套导出': {
    en: 'Plan, review each screen, export the set',
    ar: 'خطط وراجع كل صفحة ثم صدّر المجموعة',
  },
  '文字 / 参考图 → 图片': { en: 'Text / reference → image', ar: 'نص / مرجع ← صورة' },
  '文字 / 图片 → 视频': { en: 'Text / image → video', ar: 'نص / صورة ← فيديو' },
  '商品信息 → 多屏详情页': {
    en: 'Product brief → a complete story',
    ar: 'معلومات المنتج ← صفحات متكاملة',
  },
  填写需求: { en: 'Describe your idea', ar: 'صف فكرتك' },
  查看与下载作品: { en: 'Review and download', ar: 'راجع وحمّل' },
  继续上次的创作: { en: 'Pick up where you left off', ar: 'تابع من حيث توقفت' },
  最近项目: { en: 'Recent projects', ar: 'المشاريع الأخيرة' },
  生成记录: { en: 'Generations', ar: 'سجل الإنشاء' },
  这里会留下你的创作: { en: 'A home for your creations', ar: 'مكان لأعمالك الإبداعية' },
  '保存草稿或提交生成后，随时回来继续。': {
    en: 'Save a draft or start generating, then return to it anytime.',
    ar: 'احفظ مسودة أو ابدأ الإنشاء ثم عد للمتابعة متى شئت.',
  },
  让作品更进一步: { en: 'Take your work further', ar: 'ارتق بأعمالك' },
  '上传、整理与复用参考素材': {
    en: 'Upload, organize and reuse references',
    ar: 'ارفع المراجع ونظمها وأعد استخدامها',
  },
  作品将在这里呈现: { en: 'Your results belong here', ar: 'ستظهر نتائجك هنا' },
  '先写下创作需求。提交后，在同一个项目中查看进度和结果。': {
    en: 'Describe your idea to get started. Track progress and results in the same project.',
    ar: 'صف فكرتك للبدء. تابع التقدم والنتائج في المشروع نفسه.',
  },
  编辑创作需求: { en: 'Edit your brief', ar: 'عدّل وصف العمل' },
  '模型已就绪 · 查看参数说明': {
    en: 'Model ready · View parameter details',
    ar: 'النموذج جاهز · تفاصيل المعلمات',
  },
  '先填写商品信息，再开始策划。商品图可在生成前补充。': {
    en: 'Add your product details to start planning. You can add reference images before generation.',
    ar: 'أضف معلومات المنتج لبدء التخطيط. يمكنك إضافة صور مرجعية قبل الإنشاء.',
  },
  可查询的模型参数已更新: {
    en: 'Available model parameter details updated',
    ar: 'تم تحديث تفاصيل معلمات النموذج المتاحة للاستعلام',
  },
  随比例与清晰度确定: {
    en: 'Derived from aspect ratio and resolution',
    ar: 'تحددها نسبة الأبعاد والدقة',
  },
  首页: { en: 'Home', ar: 'الرئيسية' },
  快速创作: { en: 'Quick create', ar: 'إنشاء سريع' },
  灵感没有标准答案: { en: 'Make room for imagination', ar: 'أفسح المجال للخيال' },
  '放开想象，开始创作。': { en: 'Let imagination take shape.', ar: 'أطلق خيالك وابدأ الإبداع.' },
  '一句灵感，一张参考。让下一个好想法，在这里发生。': {
    en: 'An idea, a reference. Give your next great thought a place to begin.',
    ar: 'فكرة وصورة مرجعية. امنح فكرتك القادمة مكاناً لتبدأ.',
  },
  '写下灵感，其余交给创作。': { en: 'Start with an idea.', ar: 'ابدأ بفكرة.' },
  给灵感一个方向: { en: 'Follow your curiosity', ar: 'اتبع فضولك' },
  '不止一种，表达方式。': { en: 'More ways to make it yours.', ar: 'طرق أكثر للتعبير عن أفكارك.' },
  探索更多灵感: { en: 'Explore more ideas', ar: 'استكشف المزيد من الأفكار' },
  你的创作轨迹: { en: 'Your creative trail', ar: 'مسارك الإبداعي' },
  '好想法，接着发生。': { en: 'Keep the ideas flowing.', ar: 'دع الأفكار تتواصل.' },
  '从上次停下的地方继续，把喜欢的方向再推进一点。': {
    en: 'Pick up where you left off. Take the ideas you love a little further.',
    ar: 'تابع من حيث توقفت، وخذ الأفكار التي تحبها إلى أبعد قليلاً.',
  },
  请重新选择: { en: 'Choose again', ar: 'اختر مجدداً' },
};
