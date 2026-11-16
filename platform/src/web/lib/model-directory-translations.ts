export const MODEL_DIRECTORY_TRANSLATIONS = {
  模型选择需要更新: { en: 'Model selection needs updating', ar: 'يلزم تحديث اختيار النموذج' },
  '模型配置已更新，草稿中的模型已不可用。': {
    en: 'Model settings have changed. The model saved in this draft is no longer available.',
    ar: 'تغيّرت إعدادات النماذج. لم يعد النموذج المحفوظ في هذه المسودة متاحًا.',
  },
  '采用新模型时将使用其默认参数，创作需求与素材会保留。': {
    en: 'Choosing the new model applies its default parameters. Your prompt and assets are kept.',
    ar: 'سيُطبّق اختيار النموذج الجديد معاييره الافتراضية. سيُحتفظ بطلبك وموادك.',
  },
  '创作需求、素材与生成参数已保留，请选择模型并核对参数。': {
    en: 'Your prompt, assets and generation parameters are kept. Choose a model and review the parameters.',
    ar: 'تم الاحتفاظ بطلبك وموادك ومعايير التوليد. اختر نموذجًا وراجع المعايير.',
  },
  '使用已配置模型（{model}）': {
    en: 'Use configured model ({model})',
    ar: 'استخدم النموذج المضبوط ({model})',
  },
  重新选择模型: { en: 'Choose a model again', ar: 'اختر نموذجًا من جديد' },
  演示模式生成说明: { en: 'Generation in demo mode', ar: 'التوليد في الوضع التجريبي' },
  '演示模式不调用自定义模型，请在正式模式配置并生成': {
    en: 'Demo mode does not call custom models. Configure them and create in real mode.',
    ar: 'لا يستدعي الوضع التجريبي النماذج المخصصة. اضبطها وأنشئ المحتوى في الوضع الفعلي.',
  },
  '真实生成模式使用独立的账号、模型配置与数据；演示配置不会自动迁移。': {
    en: 'Real generation mode uses separate accounts, model settings and data. Demo settings are not transferred automatically.',
    ar: 'يستخدم وضع التوليد الفعلي حسابات وإعدادات نماذج وبيانات مستقلة. لا تُنقل إعدادات الوضع التجريبي تلقائيًا.',
  },
  打开本机真实生成: { en: 'Open local real generation', ar: 'افتح التوليد الفعلي على هذا الجهاز' },
  '这是本机的独立入口，不是线上环境。': {
    en: 'This is a separate entry on this computer, not an online environment.',
    ar: 'هذا مدخل مستقل على هذا الجهاز، وليس بيئة منشورة على الإنترنت.',
  },
  '请联系管理员提供正式模式入口。': {
    en: 'Ask your administrator for the real-mode address.',
    ar: 'اطلب من المسؤول عنوان الوضع الفعلي.',
  },
  配置模型: { en: 'Configure models', ar: 'اضبط النماذج' },
  请在模型配置中启用文本与图片服务: {
    en: 'Enable text and image services in model settings.',
    ar: 'فعّل خدمات النص والصور في إعدادات النماذج.',
  },
  '请在模型配置中启用文本、图片与视频服务': {
    en: 'Enable text, image and video services in model settings.',
    ar: 'فعّل خدمات النص والصور والفيديو في إعدادات النماذج.',
  },
  '请先安装 FFmpeg（媒体处理工具）与 ffprobe（媒体探测工具），再生成视频': {
    en: 'Install FFmpeg and ffprobe before generating videos.',
    ar: 'ثبّت FFmpeg وffprobe قبل توليد الفيديوهات.',
  },
  '生成图片需保存并启用文本规划与图片生成；生成视频还需启用视频生成。': {
    en: 'To create images, save and enable text planning and image generation. Videos also require video generation.',
    ar: 'لإنشاء الصور، احفظ وفعّل تخطيط النص وتوليد الصور. وتتطلب الفيديوهات تفعيل توليد الفيديو أيضًا.',
  },
  选择模型: { en: 'Choose a model', ar: 'اختر نموذجًا' },
  选择视觉模型: { en: 'Choose a vision model', ar: 'اختر نموذجًا بصريًا' },
  搜索模型: { en: 'Search models', ar: 'ابحث عن النماذج' },
  '搜索模型名称…': { en: 'Search model names…', ar: 'ابحث باسم النموذج…' },
  可选模型: { en: 'Available models', ar: 'النماذج المتاحة' },
  '已获取 {count} 个模型': { en: 'Loaded {count} models', ar: 'تم تحميل {count} نموذجًا' },
  '已获取 {count} 个模型，点击箭头选择。': {
    en: 'Loaded {count} models. Use the arrow to choose one.',
    ar: 'تم تحميل {count} نموذجًا. اضغط على السهم للاختيار.',
  },
  '当前模型不在此目录中，可重新选择或手动保留。': {
    en: 'The current model is not in this catalog. Choose another or keep the manual entry.',
    ar: 'النموذج الحالي غير موجود في هذه القائمة. اختر غيره أو احتفظ بالإدخال اليدوي.',
  },
  '正在获取模型列表…': { en: 'Loading model list…', ar: 'جارٍ تحميل قائمة النماذج…' },
  '正在连接服务商，请稍候。': {
    en: 'Connecting to the provider. Please wait.',
    ar: 'جارٍ الاتصال بمقدم الخدمة. يُرجى الانتظار.',
  },
  '点击模型输入框旁的箭头，可搜索并选择模型。': {
    en: 'Use the arrow next to the model field to search and choose a model.',
    ar: 'استخدم السهم بجانب حقل النموذج للبحث والاختيار.',
  },
  模型列表获取失败: { en: 'Could not load the model list', ar: 'تعذّر تحميل قائمة النماذج' },
  重试获取模型: { en: 'Retry model list', ar: 'أعد تحميل القائمة' },
  目录获取中: { en: 'Loading catalog', ar: 'جارٍ تحميل القائمة' },
  '获取模型列表超时，请重试或手动填写模型。': {
    en: 'Loading the model list timed out. Retry or enter a model manually.',
    ar: 'انتهت مهلة تحميل القائمة. أعد المحاولة أو أدخل النموذج يدويًا.',
  },
  '没有匹配的模型，可修改搜索词或手动填写。': {
    en: 'No matching models. Change the search or enter a model manually.',
    ar: 'لا توجد نماذج مطابقة. غيّر البحث أو أدخل النموذج يدويًا.',
  },
  '服务商返回了空目录，可手动填写模型标识。': {
    en: 'The provider returned an empty catalog. You can enter a model ID manually.',
    ar: 'أعاد مقدم الخدمة قائمة فارغة. يمكنك إدخال معرّف النموذج يدويًا.',
  },
  '目录尚未就绪，可先手动填写模型标识。': {
    en: 'The catalog is not ready. You can enter a model ID manually.',
    ar: 'القائمة غير جاهزة. يمكنك إدخال معرّف النموذج يدويًا.',
  },
} as const;
