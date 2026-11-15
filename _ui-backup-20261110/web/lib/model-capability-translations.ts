export const MODEL_CAPABILITY_TRANSLATIONS: Record<string, { en: string; ar: string }> = {
  '参数已补齐 · 查看文档来源': {
    en: 'Parameters available · View documentation',
    ar: 'المعلمات متاحة · عرض الوثائق',
  },
  '模型可用性已实时核查；参数范围来自已核对的原厂文档。': {
    en: 'Model availability checked live; parameter ranges follow reviewed manufacturer documentation.',
    ar: 'تم التحقق من توفر النموذج مباشرة؛ نطاقات المعلمات وفق وثائق الشركة المُراجعة.',
  },
  原厂文档与当前接入: {
    en: 'Manufacturer documentation and integration',
    ar: 'وثائق الشركة والتكامل الحالي',
  },
  参数依据文档: { en: 'Parameter reference', ar: 'مرجع المعلمات' },
  文档核对日期: { en: 'Documentation reviewed', ar: 'تاريخ مراجعة الوثائق' },
  '服务商目录已同步；计费档位不作为生成参数范围。': {
    en: 'Provider catalog refreshed; billing tiers do not define generation options.',
    ar: 'تم تحديث دليل المزود؛ شرائح الفوترة لا تحدد خيارات التوليد.',
  },
  '服务商目录暂未同步；已保留文档参数范围。': {
    en: 'Provider catalog unavailable; documented parameter ranges are retained.',
    ar: 'دليل المزود غير متاح؛ تم الاحتفاظ بنطاقات المعلمات الموثقة.',
  },
  '此模型通过尺寸控制清晰度，没有独立的低、中、高画质选项。': {
    en: 'This model controls resolution through image size; it has no separate low, medium or high quality setting.',
    ar: 'يتحكم هذا النموذج في الدقة من خلال حجم الصورة؛ لا يوجد إعداد مستقل لجودة منخفضة أو متوسطة أو عالية.',
  },
  '可生成与画面同步的声音，也可关闭声音。': {
    en: 'Generate synchronized audio, or keep the video silent.',
    ar: 'توليد صوت متزامن أو إبقاء الفيديو صامتًا.',
  },
  '当前接入支持文字生成视频；参考素材和字幕暂未开放。': {
    en: 'Text-to-video is supported; reference media and subtitles are not yet integrated.',
    ar: 'يدعم التكامل توليد الفيديو من النص؛ الوسائط المرجعية والترجمة النصية لم تُدمج بعد.',
  },
  输出尺寸: { en: 'Output dimensions', ar: 'أبعاد الناتج' },
  像素: { en: 'pixels', ar: 'بكسل' },

  '报价已过期，请返回编辑并重新估价。': {
    en: 'This quote has expired. Return to editing and request a new quote.',
    ar: 'انتهت صلاحية عرض السعر. ارجع إلى التحرير واطلب عرض سعر جديدًا.',
  },
  固定: { en: 'Fixed', ar: 'ثابت' },
  '当前参考方式不受此模型支持，请在更多创作设置中重新选择。': {
    en: 'This model does not support the current reference mode. Choose another mode in More creation settings.',
    ar: 'لا يدعم هذا النموذج وضع المرجع الحالي. اختر وضعًا آخر من إعدادات الإنشاء الإضافية.',
  },
  '当前模型不支持画面文字，请在更多创作设置中关闭该选项。': {
    en: 'This model does not support on-screen text. Turn it off in More creation settings.',
    ar: 'لا يدعم هذا النموذج النص داخل الصورة. أوقف هذا الخيار من إعدادات الإنشاء الإضافية.',
  },
  '设置或模型信息已改变，请返回编辑并重新确认报价。': {
    en: 'The settings or model information have changed. Return to editing and request a new quote.',
    ar: 'تغيرت الإعدادات أو معلومات النموذج. ارجع إلى التحرير واطلب عرض سعر جديدًا.',
  },
  '当前设置暂不能提交，请返回编辑核对模型信息。': {
    en: 'These settings cannot be submitted right now. Return to editing and check the model information.',
    ar: 'لا يمكن إرسال هذه الإعدادات حاليًا. ارجع إلى التحرير وتحقق من معلومات النموذج.',
  },
  采用当前模型的固定参数: {
    en: 'Use this model’s fixed settings',
    ar: 'استخدام الإعدادات الثابتة لهذا النموذج',
  },
  '“{parameter}”的当前值不受此模型支持。原值已保留，请重新选择。': {
    en: 'The current {parameter} value is not supported by this model. Your value has been kept; choose another option.',
    ar: 'لا يدعم هذا النموذج القيمة الحالية لـ«{parameter}». تم الاحتفاظ بقيمتك؛ اختر قيمة أخرى.',
  },
  '当前模型最多支持 {count} 个结果。原数量已保留，请重新选择。': {
    en: 'This model supports up to {count} results. Your count has been kept; choose another value.',
    ar: 'يدعم هذا النموذج حتى {count} نتائج. تم الاحتفاظ بالعدد الحالي؛ اختر قيمة أخرى.',
  },
  '正在核查当前模型…': { en: 'Checking the current model…', ar: 'جارٍ التحقق من النموذج الحالي…' },
  '模型信息未能更新，请重试后再生成。': {
    en: 'Model information could not be updated. Retry before generating.',
    ar: 'تعذر تحديث معلومات النموذج. أعد المحاولة قبل التوليد.',
  },
  '模型信息已过期，请刷新后再生成。': {
    en: 'Model information has expired. Refresh before generating.',
    ar: 'انتهت صلاحية معلومات النموذج. حدّثها قبل التوليد.',
  },
  '请先选择可用的服务和模型。': {
    en: 'Choose an available service and model first.',
    ar: 'اختر أولًا خدمة ونموذجًا متاحين.',
  },
  '当前模型暂不可用，请刷新或更换模型。': {
    en: 'This model is currently unavailable. Refresh or choose another model.',
    ar: 'هذا النموذج غير متاح حاليًا. حدّث المعلومات أو اختر نموذجًا آخر.',
  },
  模型参数已更新: { en: 'Model parameters updated', ar: 'تم تحديث معلمات النموذج' },
  '当前接入未取得完整参数结构，使用已接入的选项。': {
    en: 'The current connection has not returned full parameter details. The supported options are shown.',
    ar: 'لم يُرجع الاتصال الحالي تفاصيل المعلمات كاملة. تُعرض الخيارات المدعومة في التطبيق.',
  },
  信息来源: { en: 'Information source', ar: 'مصدر المعلومات' },
  服务提供的参数: { en: 'Parameters from the service', ar: 'معلمات مقدمة من الخدمة' },
  服务提供的模型列表: { en: 'Model list from the service', ar: 'قائمة النماذج المقدمة من الخدمة' },
  当前接入设置: { en: 'Current connection settings', ar: 'إعدادات الاتصال الحالية' },
  暂未取得模型信息: { en: 'Model information unavailable', ar: 'معلومات النموذج غير متاحة' },
  核查时间: { en: 'Checked at', ar: 'وقت التحقق' },
  由当前服务固定: { en: 'Fixed by this service', ar: 'قيمة ثابتة تحددها الخدمة' },
  '当前已核实接口未返回完整参数结构，不能确认上游的全部可选项。': {
    en: 'The verified endpoint does not return full parameter details, so all upstream options cannot be confirmed.',
    ar: 'لا تُرجع الواجهة التي تم التحقق منها تفاصيل المعلمات كاملة، لذلك لا يمكن تأكيد جميع خيارات الخدمة.',
  },
  '核查模型信息不生成内容，也不代表已验证生成质量。': {
    en: 'Checking model information does not generate content or verify output quality.',
    ar: 'التحقق من معلومات النموذج لا يولّد محتوى ولا يؤكد جودة النتائج.',
  },
  刷新模型信息: { en: 'Refresh model information', ar: 'تحديث معلومات النموذج' },
  重试核查: { en: 'Retry check', ar: 'إعادة التحقق' },
  画面比例: { en: 'Aspect ratio', ar: 'نسبة الأبعاد' },
  清晰度: { en: 'Resolution', ar: 'الدقة' },
  时长: { en: 'Duration', ar: 'المدة' },
  质量: { en: 'Quality', ar: 'الجودة' },
  尺寸: { en: 'Size', ar: 'الحجم' },
  数量: { en: 'Count', ar: 'العدد' },
  格式: { en: 'Format', ar: 'التنسيق' },
  生成音频: { en: 'Generate audio', ar: 'توليد صوت' },
};
