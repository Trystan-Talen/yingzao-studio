/** Product copy only; never translates prompts, names, asset content, or persisted enum values. */
export const CREATION_TRANSLATIONS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>> =
  {
    视频内容分类: { en: 'Video content category', ar: 'فئة محتوى الفيديو' },
    全部视频内容: { en: 'All video categories', ar: 'جميع فئات الفيديو' },
    请在设置中连接服务: { en: 'Connect a service in Settings', ar: 'اربط خدمة في الإعدادات' },
    口播: { en: 'Talking head', ar: 'حديث أمام الكاميرا' },
    种草: { en: 'Product recommendations', ar: 'توصيات المنتجات' },
    剧情: { en: 'Story', ar: 'قصة' },
    未分类: { en: 'Uncategorized', ar: 'غير مصنف' },
    处理任务: { en: 'Processing tasks', ar: 'مهام المعالجة' },
    计费数量: { en: 'Billable quantity', ar: 'الكمية المحتسبة للفوترة' },
    次: { en: ' requests', ar: ' طلبات' },
    'MP3/WAV、3–30秒、不超过15MB；长于视频只使用前段，短于视频剩余静音。不是声音克隆或逐拍同步。': {
      en: 'MP3/WAV, 3–30 seconds, up to 15 MB. Longer audio uses only the beginning; shorter audio leaves the remaining video silent. This is not voice cloning or beat synchronization.',
      ar: 'ملفات MP3/WAV من 3 إلى 30 ثانية وبحد أقصى 15 ميغابايت. يُستخدم أول الصوت الأطول فقط، ويبقى ما بعد الصوت الأقصر صامتًا. هذه ليست محاكاة صوت أو مزامنة للإيقاع.',
    },
    '按模型生成音轨，不是声音克隆或保证精确字幕；真实音画效果未验证。': {
      en: 'Generate audio with the model. This is not voice cloning and does not guarantee exact subtitles. Real audiovisual quality has not been verified.',
      ar: 'يُولّد الصوت باستخدام النموذج. هذه ليست محاكاة صوت ولا تضمن ترجمة نصية دقيقة. لم تُتحقق جودة الصوت والصورة الفعلية.',
    },
    '画面文案与语言仅作为提示词指引，不能保证文字、语言或排版准确；当前没有逐字字幕合成能力。': {
      en: 'Text and language guide the prompt only. Exact wording, language and layout are not guaranteed. Word-for-word subtitle composition is not available.',
      ar: 'يوجّه النص واللغة الطلب فقط. لا تُضمن دقة النص أو اللغة أو التنسيق. تركيب ترجمة نصية كلمة بكلمة غير متاح.',
    },
    '画面文字与语言仅作为提示词指引，不保证精确字幕或文字生成。': {
      en: 'On-screen text and language guide the prompt only. Exact subtitles or text generation are not guaranteed.',
      ar: 'يوجّه نص الشاشة واللغة الطلب فقط. لا يُضمن توليد نص أو ترجمة نصية دقيقة.',
    },
    '浏览器存储不可用，当前修改仅保留在此页面。': {
      en: 'Browser storage is unavailable. Current edits are kept on this page only.',
      ar: 'تخزين المتصفح غير متاح. تُحفظ التعديلات الحالية في هذه الصفحة فقط.',
    },
    已恢复本机草稿: { en: 'Local draft restored', ar: 'استُعيدت المسودة المحلية' },
    草稿已保存在本机: { en: 'Draft saved locally', ar: 'حُفظت المسودة محليًا' },
    '当前修改仅保留在此页面。浏览器无法保存草稿，请使用“保存草稿”保存到项目。': {
      en: 'Current edits are kept on this page only. Browser storage is unavailable. Use Save draft to save them to a project.',
      ar: 'التعديلات الحالية محفوظة في هذه الصفحة فقط. لا يستطيع المتصفح حفظ المسودة. استخدم «حفظ المسودة» لحفظها في مشروع.',
    },
    '项目已创建，请保存草稿后进入项目。浏览器无法保存本机恢复记录。': {
      en: 'The project was created. Save the draft before opening it; the browser could not save the local recovery record.',
      ar: 'أُنشئ المشروع. احفظ المسودة قبل فتحه؛ تعذّر على المتصفح حفظ سجل الاسترداد المحلي.',
    },
    草稿已保存到项目: { en: 'Draft saved to project', ar: 'حُفظت المسودة في المشروع' },
    '项目已保存，但保存期间的最新修改未能转存。当前页面保留全部修改，请恢复浏览器存储后再次保存。':
      {
        en: 'The project was saved, but newer edits could not be transferred. All edits remain on this page. Restore browser storage and save again.',
        ar: 'حُفظ المشروع، لكن تعذّر نقل أحدث التعديلات. تبقى جميع التعديلات في هذه الصفحة. أعد إتاحة تخزين المتصفح واحفظ مجددًا.',
      },
    '当前角色不能编辑创作草稿。': {
      en: 'Your role cannot edit creation drafts.',
      ar: 'دورك لا يسمح بتعديل مسودات الإنشاء.',
    },
    '模型能力尚未读取完成，请稍后采用方案。': {
      en: 'Model capabilities are still loading. Wait before using this plan.',
      ar: 'ما زالت إمكانات النموذج قيد التحميل. انتظر قبل استخدام الخطة.',
    },
    '当前模式不支持视频参考，请先选择支持视频参考的模型与模式。': {
      en: 'This mode does not support video references. Choose a compatible model and mode first.',
      ar: 'هذا الوضع لا يدعم مراجع الفيديو. اختر نموذجًا ووضعًا متوافقين أولًا.',
    },
    '此结果不能用作媒体参考。': {
      en: 'This result cannot be used as a media reference.',
      ar: 'لا يمكن استخدام هذه النتيجة مرجعًا للوسائط.',
    },
    与画布保存分别记录: {
      en: 'saved separately from the canvas',
      ar: 'تُحفظ بشكل منفصل عن اللوحة',
    },
    '已核对项目草稿，用当前内容替换本机记录': {
      en: 'I reviewed the project draft; replace the local record with this content',
      ar: 'راجعت مسودة المشروع؛ استبدل السجل المحلي بهذا المحتوى',
    },
    已核对当前参数: { en: 'I reviewed the current settings', ar: 'راجعت الإعدادات الحالية' },
    '正在恢复参考素材，完成前暂不能提交。': {
      en: 'Restoring reference assets. Submission is unavailable until this finishes.',
      ar: 'جارٍ استعادة المواد المرجعية. يتعذّر الإرسال حتى تكتمل العملية.',
    },
    '部分参考素材未恢复。请重试，或明确移除失效引用后继续。': {
      en: 'Some reference assets could not be restored. Retry, or explicitly remove unavailable references to continue.',
      ar: 'تعذّر استعادة بعض المواد المرجعية. أعد المحاولة أو أزل المراجع غير المتاحة صراحةً للمتابعة.',
    },
    移除失效引用: { en: 'Remove unavailable reference', ar: 'إزالة المرجع غير المتاح' },
    重试恢复素材: { en: 'Retry restoring assets', ar: 'إعادة محاولة استعادة المواد' },
    '背景音乐（可选）': { en: 'Background music (optional)', ar: 'موسيقى خلفية (اختياري)' },
    '当前模型不支持背景音乐。原音频已保留，请移除音频或切换支持的模型后提交。': {
      en: 'This model does not support background music. Your audio is retained. Remove it or choose a compatible model before submitting.',
      ar: 'هذا النموذج لا يدعم موسيقى الخلفية. بقي الصوت محفوظًا. أزله أو اختر نموذجًا متوافقًا قبل الإرسال.',
    },
    生成视频音轨: { en: 'Generate video audio', ar: 'توليد صوت الفيديو' },
    '当前模型不支持生成音轨。请关闭此选项或切换支持的模型。': {
      en: 'This model does not support audio generation. Turn this option off or choose a compatible model.',
      ar: 'هذا النموذج لا يدعم توليد الصوت. أوقف هذا الخيار أو اختر نموذجًا متوافقًا.',
    },
    每模块生成数量: { en: 'Images per module', ar: 'عدد الصور لكل وحدة' },
    收起高级设置: { en: 'Hide advanced settings', ar: 'إخفاء الإعدادات المتقدمة' },
    模型与高级设置: { en: 'Model and advanced settings', ar: 'النموذج والإعدادات المتقدمة' },
    正在读取模型: { en: 'Loading models', ar: 'جارٍ تحميل النماذج' },
    服务已连接: { en: 'Service connected', ar: 'الخدمة متصلة' },
    服务未连接: { en: 'Service not connected', ar: 'الخدمة غير متصلة' },
    '物料规划 ·': { en: 'Design plan · ', ar: 'خطة المواد · ' },
    '个模块 · 共': { en: ' modules · ', ar: ' وحدات · ' },
    '张，展开编辑': { en: ' images; expand to edit', ar: ' صور؛ افتح للتعديل' },
    '移除失效素材及引用？': {
      en: 'Remove unavailable assets and references?',
      ar: 'إزالة المواد والمراجع غير المتاحة؟',
    },
    '将从当前草稿及物料模块移除此素材的引用，其他素材和文案保持不变。': {
      en: 'This reference will be removed from the current draft and design modules. Other assets and text will be kept.',
      ar: 'سيُزال هذا المرجع من المسودة الحالية ووحدات التصميم. ستبقى المواد والنصوص الأخرى.',
    },
    '任务已提交，但最新修改未能转存到项目。当前页面保留修改，请先保存草稿；可在任务中心查看已提交任务。':
      {
        en: 'The task was submitted, but newer edits could not be transferred to the project. They remain on this page. Save the draft first; the submitted task is available in Task Center.',
        ar: 'أُرسلت المهمة، لكن تعذّر نقل أحدث التعديلات إلى المشروع. تبقى في هذه الصفحة. احفظ المسودة أولًا؛ المهمة المرسلة متاحة في مركز المهام.',
      },
    '浏览器草稿存储不可用。': {
      en: 'Browser draft storage is unavailable.',
      ar: 'تخزين مسودات المتصفح غير متاح.',
    },
    工具草稿读取失败: { en: 'Could not load the tool draft', ar: 'تعذّر تحميل مسودة الأداة' },
    '本机草稿保存失败，请保存到项目后离开。': {
      en: 'Could not save the local draft. Save it to a project before leaving.',
      ar: 'تعذّر حفظ المسودة المحلية. احفظها في مشروع قبل المغادرة.',
    },
    '项目已创建，本机恢复记录无法保存，请保持此页重试。': {
      en: 'The project was created, but its local recovery record could not be saved. Stay on this page and retry.',
      ar: 'أُنشئ المشروع، لكن تعذّر حفظ سجل استرداده المحلي. ابقَ في هذه الصفحة وأعد المحاولة.',
    },
    工具草稿保存失败: { en: 'Could not save the tool draft', ar: 'تعذّر حفظ مسودة الأداة' },
    '正在读取识别结果与原图…': {
      en: 'Loading recognized text and the original image…',
      ar: 'جارٍ تحميل النص المتعرّف عليه والصورة الأصلية…',
    },
    重试导入: { en: 'Retry import', ar: 'إعادة محاولة الاستيراد' },
    '放弃导入，手动编辑': {
      en: 'Skip import and edit manually',
      ar: 'تجاوز الاستيراد والتعديل يدويًا',
    },
    '正在查找此工具的历史草稿…': {
      en: 'Looking for saved drafts for this tool…',
      ar: 'جارٍ البحث عن مسودات محفوظة لهذه الأداة…',
    },
    '已查找本批历史消息，尚未找到此工具草稿。更早消息尚未读取。': {
      en: 'No draft for this tool was found in these messages. Earlier messages have not been checked.',
      ar: 'لم تُعثر على مسودة لهذه الأداة في هذه الرسائل. لم تُفحص الرسائل الأقدم بعد.',
    },
    重试查找: { en: 'Retry search', ar: 'إعادة البحث' },
    继续查找更早草稿: { en: 'Search earlier drafts', ar: 'البحث عن مسودات أقدم' },
    '停止查找，使用空白草稿': {
      en: 'Stop searching and use a blank draft',
      ar: 'إيقاف البحث واستخدام مسودة فارغة',
    },
    '原参数仍保存在草稿中。请逐项选择当前支持的值后提交。': {
      en: 'The original settings are retained in the draft. Choose currently supported values before submitting.',
      ar: 'بقيت الإعدادات الأصلية في المسودة. اختر قيمًا مدعومة حاليًا قبل الإرسال.',
    },
    '正在恢复素材，完成前暂不能提交。': {
      en: 'Restoring assets. Submission is unavailable until this finishes.',
      ar: 'جارٍ استعادة المواد. يتعذّر الإرسال حتى اكتمال العملية.',
    },
    '部分素材未恢复，现有引用仍保留。请重试或明确移除后继续。': {
      en: 'Some assets could not be restored. Their references are retained. Retry or explicitly remove them to continue.',
      ar: 'تعذّر استعادة بعض المواد. بقيت مراجعها محفوظة. أعد المحاولة أو أزلها صراحةً للمتابعة.',
    },
    '移除失效引用？': { en: 'Remove the unavailable reference?', ar: 'إزالة المرجع غير المتاح؟' },
    '确认后将从当前工具草稿移除此素材引用；不会删除原文件。': {
      en: 'This removes the reference from the current tool draft. The original file will be kept.',
      ar: 'سيُزال المرجع من مسودة الأداة الحالية. سيبقى الملف الأصلي محفوظًا.',
    },
    '（当前不可用，原值保留）': {
      en: ' (currently unavailable; original value retained)',
      ar: ' (غير متاح حاليًا؛ القيمة الأصلية محفوظة)',
    },
    '（当前不支持，原值保留）': {
      en: ' (currently unsupported; original value retained)',
      ar: ' (غير مدعوم حاليًا؛ القيمة الأصلية محفوظة)',
    },
    '×（当前不支持，原值保留）': {
      en: '× (currently unsupported; original value retained)',
      ar: '× (غير مدعوم حاليًا؛ القيمة الأصلية محفوظة)',
    },
    查看设计方案: { en: 'View design plan', ar: 'عرض خطة التصميم' },
    '这里可查看、修改并复制方案。进入对应项目后，可从作品卡选择方向应用到创作草稿。': {
      en: 'Review, edit and copy the plan here. Open its project to apply a direction from the result card to your draft.',
      ar: 'راجع الخطة وعدّلها وانسخها هنا. افتح مشروعها لتطبيق اتجاه من بطاقة النتيجة على مسودتك.',
    },
    '这里可查看、修改并复制方案。此任务未关联项目，请将方案复制到新的创作草稿。': {
      en: 'Review, edit and copy the plan here. This task has no project; copy the plan into a new creation draft.',
      ar: 'راجع الخطة وعدّلها وانسخها هنا. هذه المهمة غير مرتبطة بمشروع؛ انسخ الخطة إلى مسودة إنشاء جديدة.',
    },
    原图: { en: 'Original', ar: 'الأصل' },
    参考: { en: 'Reference', ar: 'مرجع' },
    已建立重试任务: { en: 'A retry task already exists', ar: 'توجد مهمة إعادة محاولة بالفعل' },
    '，不会从本项重复发起。': {
      en: '; this item will not be submitted again.',
      ar: '؛ لن يُرسل هذا العنصر مرة أخرى.',
    },
    可重试: { en: 'Retryable', ar: 'يمكن إعادة المحاولة' },
    作为参考继续创作: {
      en: 'Continue creating with this reference',
      ar: 'متابعة الإنشاء باستخدام هذا المرجع',
    },
    打开项目采用方案: { en: 'Open project to use plan', ar: 'فتح المشروع لاستخدام الخطة' },
    '成功结果会保留。仅重试可重试且尚未建立重试任务的条目；结果待核对项需先核对。': {
      en: 'Successful results are kept. Retry only eligible items without an existing retry task. Reconcile uncertain results first.',
      ar: 'تبقى النتائج الناجحة. أعد محاولة العناصر المؤهلة التي لا توجد لها مهمة إعادة محاولة فقط. تحقّق من النتائج غير المؤكدة أولًا.',
    },
    为可重试项重新估价: {
      en: 'Requote retryable items',
      ar: 'إعادة تسعير العناصر القابلة للمحاولة',
    },
    历史草稿读取失败: { en: 'Could not load saved drafts', ar: 'تعذّر تحميل المسودات المحفوظة' },
    '正在打开项目…': { en: 'Opening project…', ar: 'جارٍ فتح المشروع…' },
    画布有未保存的修改: {
      en: 'The canvas has unsaved changes',
      ar: 'توجد تعديلات غير محفوظة في اللوحة',
    },
    创作会话: { en: 'Creation conversation', ar: 'محادثة الإنشاء' },
    '正在恢复创作草稿…': { en: 'Restoring creation draft…', ar: 'جارٍ استعادة مسودة الإنشاء…' },
    '近期会话中没有媒体草稿。可继续查找更早记录，或从项目描述开始。': {
      en: 'No media draft was found in recent messages. Search earlier records or start from the project description.',
      ar: 'لم تُعثر على مسودة وسائط في الرسائل الحديثة. ابحث في السجلات الأقدم أو ابدأ من وصف المشروع.',
    },
    继续查找历史草稿: { en: 'Search earlier drafts', ar: 'البحث عن مسودات أقدم' },
    从项目描述开始: { en: 'Start from project description', ar: 'البدء من وصف المشروع' },
    项目作品与编辑: { en: 'Project results and editing', ar: 'نتائج المشروع وتحريره' },
    项目作品: { en: 'Project results', ar: 'نتائج المشروع' },
    '任务、产物与编辑都保存在当前项目中。': {
      en: 'Tasks, outputs and edits are saved in this project.',
      ar: 'تُحفظ المهام والمخرجات والتعديلات في هذا المشروع.',
    },
    作品与任务: { en: 'Results and tasks', ar: 'النتائج والمهام' },
    画布编辑: { en: 'Canvas editor', ar: 'محرر اللوحة' },
    '正在读取项目任务…': { en: 'Loading project tasks…', ar: 'جارٍ تحميل مهام المشروع…' },
    '第一件作品，从这里开始': { en: 'Your first creation starts here', ar: 'يبدأ عملك الأول هنا' },
    '选择素材、写下需求并确认费用。任务提交后会在这里持续更新；离开或刷新仍可找回。': {
      en: 'Choose assets, write a brief and confirm the cost. Submitted tasks update here and remain available after leaving or refreshing.',
      ar: 'اختر المواد واكتب طلبك وأكّد التكلفة. تتحدث المهام المرسلة هنا وتبقى متاحة بعد المغادرة أو التحديث.',
    },
    先从空白画布编辑: { en: 'Start with a blank canvas', ar: 'البدء بلوحة فارغة' },
    '创作草稿尚未恢复，请先完成恢复。': {
      en: 'The creation draft has not been restored. Finish restoring it first.',
      ar: 'لم تُستعد مسودة الإنشاء بعد. أكمل استعادتها أولًا.',
    },
    '创作草稿尚未恢复，请先在创作区完成恢复。': {
      en: 'Restore the draft in the creation panel first.',
      ar: 'استعد المسودة في لوحة الإنشاء أولًا.',
    },
    原素材: { en: 'Source asset', ar: 'المادة الأصلية' },
    蒙版: { en: 'Mask', ar: 'قناع' },
    背景: { en: 'Background', ar: 'خلفية' },
    背景参考: { en: 'Background reference', ar: 'مرجع الخلفية' },
    背景音乐: { en: 'Background music', ar: 'موسيقى الخلفية' },
    开启: { en: 'On', ar: 'مفعّل' },
    原图与结果对比: { en: 'Original and result comparison', ar: 'مقارنة الأصل والنتيجة' },
    收起原图对比: { en: 'Hide original comparison', ar: 'إخفاء مقارنة الأصل' },
    查看原图对比: { en: 'Compare with original', ar: 'مقارنة بالأصل' },
    选择输入素材: { en: 'Choose input asset', ar: 'اختيار المادة المدخلة' },
    输入: { en: 'Input', ar: 'الإدخال' },
    '此输入不是图片，请在素材库查看原文件。': {
      en: 'This input is not an image. View its original file in the asset library.',
      ar: 'هذا الإدخال ليس صورة. اعرض الملف الأصلي في مكتبة المواد.',
    },
    输入原图: { en: 'Input original', ar: 'الصورة الأصلية المدخلة' },
    处理结果: { en: 'Processed result', ar: 'نتيجة المعالجة' },
    '按各自比例完整显示，不裁切；可下载原件检查细节。': {
      en: 'Each image is shown in full at its own aspect ratio. Download originals to inspect details.',
      ar: 'تُعرض كل صورة كاملة بنسبتها الأصلية دون قص. نزّل الملفات الأصلية لفحص التفاصيل.',
    },
  };
