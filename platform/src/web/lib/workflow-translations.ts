/** Static workflow controls. Model output and user-authored content remain unchanged. */
export const WORKFLOW_TRANSLATIONS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>> =
  {
    '为下一次创作建立一致的视觉参考。': {
      en: 'Build a consistent visual reference for your next creation.',
      ar: 'أنشئ مرجعًا بصريًا متناسقًا لإبداعك القادم.',
    },
    已达到对应合同的品牌数量上限: {
      en: 'The brand limit for the applicable contract has been reached.',
      ar: 'تم بلوغ حد العلامات التجارية للعقد المعمول به.',
    },
    '品牌配额合同无效，请核对套餐配置': {
      en: 'The brand quota contract is invalid. Check the plan configuration.',
      ar: 'عقد حصة العلامات التجارية غير صالح. تحقّق من إعدادات الباقة.',
    },
    回收记录: { en: 'Deleted records', ar: 'السجلات المحذوفة' },
    暂无回收记录: { en: 'No deleted records', ar: 'لا توجد سجلات محذوفة' },
    品牌额度: { en: 'Brand quota', ar: 'حصة العلامات التجارية' },
    我的品牌用量: { en: 'My brand usage', ar: 'استخدامي للعلامات التجارية' },
    每成员品牌上限: { en: 'Brand limit per member', ar: 'حد العلامات التجارية لكل عضو' },
    空间共用品牌: {
      en: 'Shared workspace brands',
      ar: 'العلامات التجارية المشتركة في مساحة العمل',
    },
    空间品牌总量: { en: 'Workspace brand total', ar: 'إجمالي العلامات التجارية في مساحة العمل' },
    '两种合同分别检查，满足任一可用资格即可；额度不相加。': {
      en: 'The two contracts are checked separately. Either eligible contract can grant access; quotas are not added together.',
      ar: 'يُتحقق من العقدين بشكل منفصل. يكفي استيفاء أهلية أحدهما؛ ولا تُجمع الحصص.',
    },
    '合同并发上限仍受已配置服务容量与工作进程数量限制。': {
      en: 'The contract concurrency limit remains subject to configured service capacity and the number of worker processes.',
      ar: 'يظل حد التزامن التعاقدي خاضعًا لسعة الخدمة المضبوطة وعدد عمليات المعالجة.',
    },
    '拖入视频文件，或从素材选择器添加': {
      en: 'Drop video files here, or add them with the asset picker',
      ar: 'أفلت ملفات الفيديو هنا، أو أضفها باستخدام منتقي المواد',
    },
    '拖入音频文件，或从素材选择器添加': {
      en: 'Drop audio files here, or add them with the asset picker',
      ar: 'أفلت الملفات الصوتية هنا، أو أضفها باستخدام منتقي المواد',
    },
    '拖入文档文件，或从素材选择器添加': {
      en: 'Drop document files here, or add them with the asset picker',
      ar: 'أفلت ملفات المستندات هنا، أو أضفها باستخدام منتقي المواد',
    },
    '人物库支持分别保存图片与视频。当前普通人物创作只接受图片参考；含视频的人物不会自动转换或丢弃视频。':
      {
        en: 'The character library stores images and videos separately. Current character creation accepts image references only; a character’s videos will never be silently converted or discarded.',
        ar: 'تحفظ مكتبة الشخصيات الصور والفيديوهات بشكل منفصل. يقبل إنشاء الشخصيات الحالي مراجع صور فقط؛ ولن تُحوَّل فيديوهات الشخصية أو تُحذف بصمت.',
      },
    '人物视频参考尚不能用于当前创作；资料和草稿已保留，请选择仅含图片的人物参考。': {
      en: 'Character video references are not supported by the current creation flow. The profile and draft are retained. Select a character with image references only.',
      ar: 'مراجع فيديو الشخصية غير مدعومة في مسار الإنشاء الحالي. تبقى البيانات والمسودة محفوظتين. اختر شخصية ذات مراجع صور فقط.',
    },
    人物参考素材必须是图片或视频: {
      en: 'Character reference assets must be images or videos.',
      ar: 'يجب أن تكون مواد مرجع الشخصية صورًا أو فيديوهات.',
    },
    '添加人物名称、参考图片或视频，建立自己的角色素材库。': {
      en: 'Add a character name and reference images or videos to build your character library.',
      ar: 'أضف اسم الشخصية وصورًا أو فيديوهات مرجعية لبناء مكتبتك.',
    },
    '正在读取人物素材，完成前不能保存。': {
      en: 'Loading character assets. Saving is unavailable until this finishes.',
      ar: 'جارٍ تحميل مواد الشخصية. لا يمكن الحفظ حتى اكتمال التحميل.',
    },
    '部分人物素材已删除或无法访问。原引用仍保留；请恢复素材，或明确移除失效引用后保存。': {
      en: 'Some character assets were deleted or are unavailable. Their references are retained. Restore the assets, or explicitly remove unavailable references before saving.',
      ar: 'حُذفت بعض مواد الشخصية أو تعذر الوصول إليها. تبقى مراجعها محفوظة. استعد المواد أو أزل المراجع غير المتاحة صراحةً قبل الحفظ.',
    },
    移除失效引用: { en: 'Remove unavailable references', ar: 'إزالة المراجع غير المتاحة' },
    人物参考视频: { en: 'Character reference videos', ar: 'فيديوهات مرجعية للشخصية' },
    '{value} 份参考素材': { en: '{value} reference assets', ar: '{value} مواد مرجعية' },
    系统消息: { en: 'System messages', ar: 'رسائل النظام' },
    审核通知: { en: 'Review notifications', ar: 'إشعارات المراجعة' },
    '当前空间未读 {value} 条': {
      en: '{value} unread in this workspace',
      ar: '{value} غير مقروء في مساحة العمل هذه',
    },
    '未读数量暂不可用，请重试。': {
      en: 'Unread counts are unavailable. Please retry.',
      ar: 'عدد الإشعارات غير المقروءة غير متاح. أعد المحاولة.',
    },
    '正在加载未读数量…': {
      en: 'Loading unread counts…',
      ar: 'جارٍ تحميل عدد الإشعارات غير المقروءة…',
    },
    '项目草稿读取失败；恢复成功前不能保存或提交，以免覆盖已有需求。': {
      en: 'Could not load the project draft. Saving and submitting are unavailable until recovery succeeds, to protect the existing brief.',
      ar: 'تعذّر تحميل مسودة المشروع. يتعذّر الحفظ والإرسال حتى تنجح الاستعادة لحماية الطلب القائم.',
    },
    重试恢复项目草稿: {
      en: 'Retry project draft recovery',
      ar: 'إعادة محاولة استعادة مسودة المشروع',
    },
    '正在查找并恢复此工具的项目草稿，完成前不能保存或提交。': {
      en: 'Finding and restoring this tool’s project draft. Saving and submitting are unavailable until this finishes.',
      ar: 'جارٍ البحث عن مسودة المشروع لهذه الأداة واستعادتها. يتعذّر الحفظ والإرسال حتى اكتمال العملية.',
    },
    进入视频复刻: { en: 'Open video recreation', ar: 'فتح إعادة إنشاء الفيديو' },
    '动作复刻会继承视频；请补充主体图片、检查片段及授权，再确认费用。仅支持人物动作参考；超过30秒先预选前30秒，不会自动生成。':
      {
        en: 'Motion recreation retains the video. Add a character image, review the clip and permissions, then confirm the cost. Only character motion reference is supported. Videos over 30 seconds initially select the first 30 seconds. Generation does not start automatically.',
        ar: 'تحتفظ إعادة إنشاء الحركة بالفيديو. أضف صورة الشخصية وراجع المقطع والتفويض ثم أكّد التكلفة. تُدعم مراجع حركة الشخصيات فقط. للفيديو الأطول من 30 ثانية، تُحدَّد أول 30 ثانية مبدئيًا. لا يبدأ التوليد تلقائيًا.',
      },
    '已核对，保留当前设置': {
      en: 'Reviewed; keep current settings',
      ar: 'تمت المراجعة؛ إبقاء الإعدادات الحالية',
    },
    '已继承参考视频；请补充主体图片、检查动作片段，再确认人物与视频使用授权及外部费用。当前仅支持人物动作参考，不支持服装、人脸或商品精准替换。':
      {
        en: 'The reference video is retained. Add a character image, review the motion clip, and confirm permission to use both media and the external cost. Only character motion reference is supported, without precise clothing, face or product replacement.',
        ar: 'بقي الفيديو المرجعي محفوظًا. أضف صورة الشخصية وراجع مقطع الحركة وأكّد إذن استخدام الوسيطين والتكلفة الخارجية. تُدعم مراجع حركة الشخصيات فقط، دون استبدال دقيق للملابس أو الوجه أو المنتج.',
      },
    '参考视频超过30秒，当前预选前30秒；请在提交前检查并调整动作片段。': {
      en: 'The reference video exceeds 30 seconds, so the first 30 seconds are initially selected. Review and adjust the motion clip before submitting.',
      ar: 'يتجاوز الفيديو المرجعي 30 ثانية، لذا تُحدَّد أول 30 ثانية مبدئيًا. راجع مقطع الحركة وعدّله قبل الإرسال.',
    },
    '画布已保存 · 版本 {revision}': {
      en: 'Canvas saved · Version {revision}',
      ar: 'حُفظت اللوحة · الإصدار {revision}',
    },
    '原模型当前不可选，已切换为 {value}，请确认参数。': {
      en: 'The original model is unavailable; changed to {value}. Review the settings.',
      ar: 'النموذج الأصلي غير متاح؛ جرى التبديل إلى {value}. راجع الإعدادات.',
    },
    '当前模型不支持比例 {value}，已调整为 {next}。': {
      en: 'This model does not support aspect ratio {value}; changed to {next}.',
      ar: 'هذا النموذج لا يدعم نسبة {value}؛ جرى التعديل إلى {next}.',
    },
    '当前模型不支持清晰度 {value}，已调整为 {next}。': {
      en: 'This model does not support resolution {value}; changed to {next}.',
      ar: 'هذا النموذج لا يدعم دقة {value}؛ جرى التعديل إلى {next}.',
    },
    '当前模型不支持 {value} 秒，已调整为 {next} 秒。': {
      en: 'This model does not support {value} seconds; changed to {next} seconds.',
      ar: 'هذا النموذج لا يدعم مدة {value} ثانية؛ جرى التعديل إلى {next} ثانية.',
    },
    '保存的服务“{value}”当前不可用，请明确重新选择。': {
      en: 'The saved service "{value}" is unavailable. Explicitly select another service.',
      ar: 'الخدمة المحفوظة «{value}» غير متاحة. اختر خدمة أخرى صراحةً.',
    },
    '保存的模型“{value}”当前不受支持，请明确重新选择。': {
      en: 'The saved model "{value}" is unsupported. Explicitly select another model.',
      ar: 'النموذج المحفوظ «{value}» غير مدعوم. اختر نموذجًا آخر صراحةً.',
    },
    '保存的时长“{value}秒”不受当前模型支持，原值已保留。': {
      en: 'The saved duration of {value} seconds is unsupported. Its original value is retained.',
      ar: 'المدة المحفوظة البالغة {value} ثانية غير مدعومة. بقيت قيمتها الأصلية.',
    },
    '保存的分辨率“{value}”不受当前模型支持，原值已保留。': {
      en: 'The saved resolution "{value}" is unsupported. Its original value is retained.',
      ar: 'الدقة المحفوظة «{value}» غير مدعومة. بقيت قيمتها الأصلية.',
    },
    '保存的目标语言“{value}”当前不受支持，原值已保留。': {
      en: 'The saved target language "{value}" is unsupported. Its original value is retained.',
      ar: 'اللغة الهدف المحفوظة «{value}» غير مدعومة. بقيت قيمتها الأصلية.',
    },
    '保存的放大倍数“{value}”当前不受支持，原值已保留。': {
      en: 'The saved scale "{value}" is unsupported. Its original value is retained.',
      ar: 'معامل التكبير المحفوظ «{value}» غير مدعوم. بقيت قيمته الأصلية.',
    },
    '方案比例“{value}”不在当前模型支持范围内；保留当前设置，请手动确认。': {
      en: 'The plan’s aspect ratio "{value}" is unsupported. Current settings are retained; review them manually.',
      ar: 'نسبة الخطة «{value}» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
    },
    '方案分辨率“{value}”不在当前模型支持范围内；保留当前设置，请手动确认。': {
      en: 'The plan’s resolution "{value}" is unsupported. Current settings are retained; review them manually.',
      ar: 'دقة الخطة «{value}» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
    },
    '方案语言“{value}”不在当前模型支持范围内；保留当前设置，请手动确认。': {
      en: 'The plan’s language "{value}" is unsupported. Current settings are retained; review them manually.',
      ar: 'لغة الخطة «{value}» غير مدعومة. بقيت الإعدادات الحالية؛ راجعها يدويًا.',
    },
    '正在上传素材，请等待本批完成后再添加文件。': {
      en: 'Assets are uploading. Wait for this batch to finish before adding files.',
      ar: 'جارٍ رفع المواد. انتظر انتهاء هذه الدفعة قبل إضافة ملفات.',
    },
    '上传已保存到素材库，但原草稿的素材槽已满。请从素材库选择，或先移除不需要的素材。': {
      en: 'The upload was saved to the asset library, but the original draft has no free asset slots. Choose it from the library, or remove unneeded assets first.',
      ar: 'حُفظ الملف المرفوع في مكتبة المواد، لكن مسودة المصدر لا تحتوي على خانات مواد شاغرة. اختره من المكتبة أو أزل المواد غير المطلوبة أولًا.',
    },
    从视频分享链接导入: {
      en: 'Import from a shared video link',
      ar: 'الاستيراد من رابط فيديو مشارك',
    },
    本项目已保存的建议与方案: {
      en: 'Suggestions and plans saved in this project',
      ar: 'الاقتراحات والخطط المحفوظة في هذا المشروع',
    },
    选择历史任务: { en: 'Choose a previous task', ar: 'اختيار مهمة سابقة' },
    设计方案: { en: 'Design plan', ar: 'خطة التصميم' },
    结构化设计方案: { en: 'Structured design plan', ar: 'خطة تصميم منظمة' },
    原始方案已保存: { en: 'Original plan saved', ar: 'حُفظت الخطة الأصلية' },
    '选择一个方向并核对需求。应用后保存到当前创作草稿；原始方案保留在任务中。': {
      en: 'Choose a direction and review the brief. Applying it saves it to the current creation draft; the original plan remains in the task.',
      ar: 'اختر اتجاهًا وراجع الطلب. يُحفظ التطبيق في مسودة الإنشاء الحالية، وتبقى الخطة الأصلية في المهمة.',
    },
    创作目标: { en: 'Creative objective', ar: 'هدف العمل' },
    视觉风格: { en: 'Visual style', ar: 'النمط البصري' },
    构图与版式: { en: 'Composition and layout', ar: 'التكوين والتخطيط' },
    场景: { en: 'Scene', ar: 'المشهد' },
    '配色（每行一种）': { en: 'Palette (one color per line)', ar: 'الألوان (لون واحد لكل سطر)' },
    '文案（每行一句，可留空）': {
      en: 'Copy (one line per phrase; optional)',
      ar: 'النص (عبارة لكل سطر؛ اختياري)',
    },
    建议分辨率: { en: 'Suggested resolution', ar: 'الدقة المقترحة' },
    建议语言: { en: 'Suggested language', ar: 'اللغة المقترحة' },
    选择一个创作方向: { en: 'Choose a creative direction', ar: 'اختيار اتجاه للعمل' },
    方向: { en: 'Direction', ar: 'الاتجاه' },
    '方向 {n} 标题': { en: 'Direction {n} title', ar: 'عنوان الاتجاه {n}' },
    '方向 {n} 画面要求': { en: 'Direction {n} visual brief', ar: 'متطلبات الصورة للاتجاه {n}' },
    '请填写完整方案、最多 12 种配色及 12 句文案；空白行请删除。': {
      en: 'Complete the plan, with at most 12 colors and 12 phrases. Remove empty lines.',
      ar: 'أكمل الخطة بحد أقصى 12 لونًا و12 عبارة. احذف الأسطر الفارغة.',
    },
    方案已复制: { en: 'Plan copied', ar: 'نُسخت الخطة' },
    复制完整方案: { en: 'Copy complete plan', ar: 'نسخ الخطة كاملة' },
    应用方向: { en: 'Apply direction', ar: 'تطبيق الاتجاه' },
    到创作: { en: 'to creation', ar: 'على العمل' },
    '部分模块参考素材未恢复；现有引用仍保留，请在上方重试或明确移除。': {
      en: 'Some module reference assets could not be restored. References are retained; retry above or explicitly remove them.',
      ar: 'تعذّر استعادة بعض مراجع الوحدات. بقيت المراجع محفوظة؛ أعد المحاولة أعلاه أو أزلها صراحةً.',
    },
    暂不可用: { en: 'currently unavailable', ar: 'غير متاح حاليًا' },
    移除失效参考: { en: 'Remove unavailable reference', ar: 'إزالة المرجع غير المتاح' },
    '浏览器存储不可用，无法可靠记录提交。请检查浏览器设置。': {
      en: 'Browser storage is unavailable, so submissions cannot be recorded reliably. Check your browser settings.',
      ar: 'تخزين المتصفح غير متاح، لذا يتعذّر تسجيل الإرسال بشكل موثوق. تحقق من إعدادات المتصفح.',
    },
    '无法保存提交记录，本次尚未发送。请检查浏览器存储后重试。': {
      en: 'Could not save the submission record. Nothing was sent. Check browser storage and retry.',
      ar: 'تعذّر حفظ سجل الإرسال. لم يُرسل شيء. تحقق من تخزين المتصفح وأعد المحاولة.',
    },
    '无法保存提交记录，本次尚未发送。': {
      en: 'Could not save the submission record. Nothing was sent.',
      ar: 'تعذّر حفظ سجل الإرسال. لم يُرسل شيء.',
    },
    '任务已提交，但本机记录清理失败。再次进入时请核对该任务。': {
      en: 'The task was submitted, but the local record could not be cleared. Reconcile this task when you return.',
      ar: 'أُرسلت المهمة، لكن تعذّر مسح السجل المحلي. تحقق من هذه المهمة عند العودة.',
    },
    '请先核对上次提交结果。': {
      en: 'Reconcile the previous submission first.',
      ar: 'تحقق من نتيجة الإرسال السابق أولًا.',
    },
    提交结果已核对: { en: 'Submission result reconciled', ar: 'تم التحقق من نتيجة الإرسال' },
    上次提交结果待核对: {
      en: 'Previous submission needs reconciliation',
      ar: 'الإرسال السابق بانتظار التحقق',
    },
    已确认的创作任务: { en: 'Confirmed creation task', ar: 'مهمة إنشاء مؤكدة' },
    '核对不会再次生成。请先找回原任务，避免重复提交。': {
      en: 'Reconciliation does not generate again. Recover the original task first to avoid duplicate submissions.',
      ar: 'التحقق لا يعيد التوليد. استعد المهمة الأصلية أولًا لتجنب الإرسال المكرر.',
    },
    核对提交结果: { en: 'Reconcile submission', ar: 'التحقق من الإرسال' },
    '暂未找到原任务。你可以继续提交同一份已确认请求，系统会按原编号避免重复创建。': {
      en: 'The original task has not been found. You can resubmit the same confirmed request; its original identifier prevents duplicate creation.',
      ar: 'لم تُعثر على المهمة الأصلية بعد. يمكنك إعادة إرسال الطلب المؤكد نفسه؛ يمنع معرّفه الأصلي إنشاء نسخة مكررة.',
    },
    原请求已提交: { en: 'Original request submitted', ar: 'أُرسل الطلب الأصلي' },
    继续提交原请求: { en: 'Continue the original submission', ar: 'متابعة إرسال الطلب الأصلي' },
    本次处理组合: { en: 'Processing combinations', ar: 'تركيبات المعالجة' },
    文字输入: { en: 'Text input', ar: 'الإدخال النصي' },
    颜色: { en: 'Color', ar: 'اللون' },
    语言: { en: 'Language', ar: 'اللغة' },
    '解析服务按调用另行收费，链接失效或解析后无法下载也可能收费。确认仅对当前链接执行一次；连接中断时请先核对原任务。':
      {
        en: 'The parser charges separately per call, including expired links or downloads that fail after parsing. Confirm one attempt for this link only. Reconcile the original task first if the connection is interrupted.',
        ar: 'تفرض خدمة التحليل رسومًا منفصلة لكل استدعاء، وقد تُفرض على الروابط المنتهية أو التنزيل الذي يفشل بعد التحليل. أكّد محاولة واحدة لهذا الرابط فقط. تحقق من المهمة الأصلية أولًا عند انقطاع الاتصال.',
      },
    '链接无法识别。': { en: 'The link could not be recognized.', ar: 'تعذّر التعرف على الرابط.' },
    '支持抖音和 TikTok（国际版抖音）公开视频，导入后可用于视频创作或编辑。最多 100 MiB（兆字节）。小红书视频暂不支持链接导入，请上传文件。':
      {
        en: 'Import public Douyin and TikTok videos for video creation or editing, up to 100 MiB. Xiaohongshu link import is not supported; upload a file instead.',
        ar: 'استورد فيديوهات Douyin وTikTok العامة للإنشاء أو التحرير، بحد أقصى 100 ميبيبايت. استيراد روابط Xiaohongshu غير مدعوم؛ ارفع ملفًا بدلًا منه.',
      },
    视频分享链接: { en: 'Shared video link', ar: 'رابط الفيديو المشارك' },
    '可粘贴包含一个链接的分享文字；不支持登录后才能查看的内容。': {
      en: 'Paste share text containing one link. Content that requires signing in is not supported.',
      ar: 'الصق نص مشاركة يحتوي على رابط واحد. المحتوى الذي يتطلب تسجيل الدخول غير مدعوم.',
    },
    我有权下载并使用这段视频: {
      en: 'I am authorized to download and use this video',
      ar: 'لدي إذن بتنزيل هذا الفيديو واستخدامه',
    },
    '我确认解析服务按调用另行收费，失效链接或下载失败也可能收费': {
      en: 'I accept separate parser charges per call, including expired links or failed downloads',
      ar: 'أوافق على رسوم تحليل منفصلة لكل استدعاء، بما في ذلك الروابط المنتهية أو التنزيلات الفاشلة',
    },
    确认导入视频: { en: 'Confirm video import', ar: 'تأكيد استيراد الفيديو' },
    我的最近导入: { en: 'My recent imports', ar: 'عمليات الاستيراد الحديثة' },
    '提交后可以关闭窗口；刷新或重新打开仍可查看任务和选用结果。连接中断时，先核对原任务，避免重复解析。':
      {
        en: 'You can close this window after submitting. Tasks and results remain available after refreshing or reopening. Reconcile the original task after an interruption to avoid parsing twice.',
        ar: 'يمكنك إغلاق النافذة بعد الإرسال. تبقى المهام والنتائج متاحة بعد التحديث أو إعادة الفتح. تحقق من المهمة الأصلية بعد الانقطاع لتجنب التحليل مرتين.',
      },
    '还没有导入任务。': { en: 'No import tasks yet.', ar: 'لا توجد مهام استيراد بعد.' },
    '请在任务中心核对服务商记录。这里不会自动重新解析。': {
      en: 'Reconcile the provider record in Task Center. This page does not automatically parse again.',
      ar: 'تحقق من سجل المزوّد في مركز المهام. لن تُعيد هذه الصفحة التحليل تلقائيًا.',
    },
    选用视频: { en: 'Use this video', ar: 'استخدام هذا الفيديو' },
    查看: { en: 'View', ar: 'عرض' },
  };
