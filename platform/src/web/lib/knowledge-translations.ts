export const KNOWLEDGE_TRANSLATIONS: Readonly<
  Record<string, Readonly<{ en: string; ar: string }>>
> = {
  封面图片: { en: 'Cover image', ar: 'صورة الغلاف' },
  '提交内容已保存，之后的修改仍未保存。': {
    en: 'Your submitted changes are saved. Changes made afterward are still unsaved.',
    ar: 'تم حفظ التعديلات المرسلة. التعديلات اللاحقة لم تُحفظ بعد.',
  },
  只有产品创建者可以将共享产品设为私有: {
    en: 'Only the product creator can make a shared product private.',
    ar: 'يمكن لمنشئ المنتج فقط تحويل المنتج المشترك إلى خاص.',
  },
  '记录已被其他窗口修改，当前输入已保留。请核对最新记录后选择如何继续。': {
    en: 'Another window changed this record. Your input is preserved. Review the latest record and choose how to continue.',
    ar: 'عدّلت نافذة أخرى هذا السجل. تم الاحتفاظ بإدخالك. راجع أحدث سجل واختر كيفية المتابعة.',
  },
  服务器最新记录: { en: 'Latest saved record', ar: 'أحدث سجل محفوظ' },
  双方已修改: { en: 'Changed in both versions', ar: 'تم التعديل في النسختين' },
  当前输入: { en: 'Your current input', ar: 'إدخالك الحالي' },
  未设置: { en: 'Not set', ar: 'غير محدد' },
  '合并会采用未改动字段的最新内容；双方修改的字段保留当前输入。合并后仍需核对并保存。': {
    en: 'Merging uses the latest values for fields you did not change. Where both versions changed a field, your input is kept. Review and save after merging.',
    ar: 'يستخدم الدمج أحدث القيم للحقول التي لم تعدّلها. إذا عُدّل حقل في النسختين، يُحتفظ بإدخالك. راجع النتيجة واحفظها بعد الدمج.',
  },
  合并最新记录并继续编辑: {
    en: 'Merge latest record and keep editing',
    ar: 'دمج أحدث سجل ومتابعة التعديل',
  },
  '载入最新记录，放弃当前修改': {
    en: 'Load latest record and discard my changes',
    ar: 'تحميل أحدث سجل وتجاهل تعديلاتي',
  },
  启用: { en: 'Enable', ar: 'تفعيل' },
  停用: { en: 'Pause', ar: 'إيقاف مؤقت' },
  '分组物料暂不支持关联产品与个人记忆，请切换单张创作或取消关联': {
    en: 'Grouped materials do not yet support products or personal memories. Switch to a single creation or unlink the product.',
    ar: 'لا تدعم المواد المجمّعة المنتجات أو الذكريات الشخصية حالياً. انتقل إلى عمل فردي أو ألغِ ربط المنتج.',
  },
  取消产品关联: { en: 'Unlink product', ar: 'إلغاء ربط المنتج' },
  当时有效至: { en: 'Valid until when planned', ar: 'الصلاحية المسجلة وقت التخطيط' },
  '正在读取资料快照…': { en: 'Loading information snapshot…', ar: 'جارٍ تحميل لقطة المعلومات…' },
  '资料快照未能读取，请重试后确认。': {
    en: 'The information snapshot could not load. Retry before confirming.',
    ar: 'تعذر تحميل لقطة المعلومات. أعد المحاولة قبل التأكيد.',
  },
  关联品牌不可用: { en: 'Linked brand unavailable', ar: 'العلامة المرتبطة غير متاحة' },
  '关联品牌无法读取，请重试或在产品库修复关联。': {
    en: 'The linked brand could not load. Retry or repair the link in Products.',
    ar: 'تعذر تحميل العلامة المرتبطة. أعد المحاولة أو أصلح الرابط في مكتبة المنتجات.',
  },
  '最多2000字；请精简为需要跨次复用的内容。': {
    en: 'Up to 2,000 characters; keep only what you want to reuse across creations.',
    ar: 'حتى 2000 حرف؛ احتفظ فقط بما تريد إعادة استخدامه بين الأعمال.',
  },
  临时记忆必须设置未来的到期时间: {
    en: 'Temporary memories require a future expiry.',
    ar: 'تتطلب الذكريات المؤقتة تاريخ انتهاء في المستقبل.',
  },
  '此用途下已有同主题记忆，请编辑已有记录': {
    en: 'A memory with this topic already exists for this scope. Edit the existing record.',
    ar: 'توجد ذاكرة بهذا الموضوع لهذا النطاق. عدّل السجل الحالي.',
  },
  '最多保存100条个人创作记忆，请先整理已有记录': {
    en: 'You can save up to 100 personal creative memories. Organize existing records first.',
    ar: 'يمكنك حفظ حتى 100 ذاكرة إبداعية شخصية. نظّم السجلات الحالية أولاً.',
  },
  '记录已被修改，请刷新后再保存': {
    en: 'This record has changed. Refresh before saving.',
    ar: 'تم تغيير هذا السجل. حدّث الصفحة قبل الحفظ.',
  },
  关联私有品牌的产品也必须设为私有: {
    en: 'Products linked to a private brand must also be private.',
    ar: 'يجب أن تكون المنتجات المرتبطة بعلامة خاصة خاصة أيضاً.',
  },
  产品库: {
    en: 'Products',
    ar: 'مكتبة المنتجات',
  },
  产品: {
    en: 'Product',
    ar: 'المنتج',
  },
  创建产品: {
    en: 'Create product',
    ar: 'إنشاء منتج',
  },
  编辑产品: {
    en: 'Edit product',
    ar: 'تعديل المنتج',
  },
  查看产品: {
    en: 'View product',
    ar: 'عرض المنتج',
  },
  产品资料: {
    en: 'Product details',
    ar: 'معلومات المنتج',
  },
  产品名称: {
    en: 'Product name',
    ar: 'اسم المنتج',
  },
  产品描述: {
    en: 'Product description',
    ar: 'وصف المنتج',
  },
  产品事实: {
    en: 'Product facts',
    ar: 'حقائق المنتج',
  },
  '产品事实（每行一条）': {
    en: 'Product facts (one per line)',
    ar: 'حقائق المنتج (واحدة في كل سطر)',
  },
  '使用限制（每行一条）': {
    en: 'Usage constraints (one per line)',
    ar: 'قيود الاستخدام (واحد في كل سطر)',
  },
  关联品牌: {
    en: 'Linked brand',
    ar: 'العلامة التجارية المرتبطة',
  },
  产品有效期: {
    en: 'Product valid until',
    ar: 'صلاحية معلومات المنتج حتى',
  },
  产品参考图片: {
    en: 'Product reference images',
    ar: 'الصور المرجعية للمنتج',
  },
  保存产品: {
    en: 'Save product',
    ar: 'حفظ المنتج',
  },
  搜索产品: {
    en: 'Search products',
    ar: 'البحث عن المنتجات',
  },
  产品已恢复: {
    en: 'Product restored',
    ar: 'تمت استعادة المنتج',
  },
  产品资料已保存: {
    en: 'Product details saved',
    ar: 'تم حفظ معلومات المنتج',
  },
  产品已删除: {
    en: 'Product deleted',
    ar: 'تم حذف المنتج',
  },
  还没有产品资料: {
    en: 'No products yet',
    ar: 'لا توجد منتجات بعد',
  },
  '保存产品事实、使用限制与参考图片，在创作时明确选用。': {
    en: 'Save product facts, constraints and reference images, then select them when creating.',
    ar: 'احفظ حقائق المنتج وقيوده وصوره المرجعية، ثم اخترها عند الإنشاء.',
  },
  '产品资料由你确认保存；系统不会从创作对话中自动推断。': {
    en: 'You confirm saved product details; they are never inferred automatically from creative conversations.',
    ar: 'أنت تؤكد معلومات المنتج المحفوظة؛ ولا تُستنتج تلقائياً من محادثات الإنشاء.',
  },
  '仅填写已确认的规格、材质和卖点，最多16条。': {
    en: 'Add only confirmed specifications, materials and selling points, up to 16 items.',
    ar: 'أضف المواصفات والمواد ومزايا البيع المؤكدة فقط، بحد أقصى 16 عنصراً.',
  },
  '例如不可宣称的功效、不可改动的外观，最多8条。': {
    en: 'For example, prohibited claims or appearance details to preserve, up to 8 items.',
    ar: 'مثلاً الادعاءات المحظورة أو تفاصيل المظهر التي يجب الحفاظ عليها، بحد أقصى 8 عناصر.',
  },
  '包含价格、促销或阶段信息时请设置期限；到期后不能用于新规划。': {
    en: 'Set an expiry for prices, promotions or temporary details; expired information cannot be used in new plans.',
    ar: 'حدد انتهاء صلاحية الأسعار والعروض والمعلومات المؤقتة؛ لا تُستخدم المعلومات المنتهية في خطط جديدة.',
  },
  '部分参考图片不可用，请恢复素材或明确移除后保存。': {
    en: 'Some reference images are unavailable. Restore them or explicitly remove them before saving.',
    ar: 'بعض الصور المرجعية غير متاحة. استعدها أو أزلها صراحةً قبل الحفظ.',
  },
  移除不可用图片: {
    en: 'Remove unavailable images',
    ar: 'إزالة الصور غير المتاحة',
  },
  '保存资料不会调用模型。创作时默认只带入文字，勾选后才使用产品参考图。': {
    en: 'Saving does not call a model. Only text is used by default; product images require selection.',
    ar: 'الحفظ لا يستدعي نموذجاً. يُستخدم النص فقط افتراضياً؛ وتتطلب صور المنتج اختياراً صريحاً.',
  },
  '空间共享产品不能关联私有品牌。': {
    en: 'Workspace-shared products cannot link to private brands.',
    ar: 'لا يمكن ربط المنتجات المشتركة في المساحة بعلامات تجارية خاصة.',
  },
  管理品牌: {
    en: 'Manage brands',
    ar: 'إدارة العلامات التجارية',
  },
  '删除这个产品？': {
    en: 'Delete this product?',
    ar: 'هل تريد حذف هذا المنتج؟',
  },
  '产品进入回收记录，历史确认方案与作品保留。': {
    en: 'The product moves to trash. Previously confirmed plans and creations remain.',
    ar: 'يُنقل المنتج إلى سلة المحذوفات. تبقى الخطط المؤكدة والأعمال السابقة.',
  },
  不使用产品: {
    en: 'No product',
    ar: 'بدون منتج',
  },
  搜索更多品牌: {
    en: 'Search more brands',
    ar: 'البحث عن علامات تجارية أخرى',
  },
  搜索更多产品: {
    en: 'Search more products',
    ar: 'البحث عن منتجات أخرى',
  },
  查找品牌: {
    en: 'Find a brand',
    ar: 'العثور على علامة تجارية',
  },
  查找产品: {
    en: 'Find a product',
    ar: 'العثور على منتج',
  },
  '所选资料不可用，请重新选择': {
    en: 'Selected information is unavailable; choose again',
    ar: 'المعلومات المحددة غير متاحة؛ اختر مجدداً',
  },
  正在读取资料: {
    en: 'Loading information',
    ar: 'جارٍ تحميل المعلومات',
  },
  创作记忆: {
    en: 'Creative memory',
    ar: 'ذاكرة الإنشاء',
  },
  添加记忆: {
    en: 'Add memory',
    ar: 'إضافة ذاكرة',
  },
  编辑记忆: {
    en: 'Edit memory',
    ar: 'تعديل الذاكرة',
  },
  保存记忆: {
    en: 'Save memory',
    ar: 'حفظ الذاكرة',
  },
  创作记忆已保存: {
    en: 'Creative memory saved',
    ar: 'تم حفظ ذاكرة الإنشاء',
  },
  记忆主题: {
    en: 'Memory topic',
    ar: 'موضوع الذاكرة',
  },
  记忆内容: {
    en: 'Memory content',
    ar: 'محتوى الذاكرة',
  },
  记忆类型: {
    en: 'Memory type',
    ar: 'نوع الذاكرة',
  },
  记忆状态: {
    en: 'Memory status',
    ar: 'حالة الذاكرة',
  },
  适用创作: {
    en: 'Applies to',
    ar: 'نطاق الاستخدام',
  },
  长期背景: {
    en: 'Long-term background',
    ar: 'معلومات خلفية طويلة الأمد',
  },
  创作偏好: {
    en: 'Creative preference',
    ar: 'تفضيل إبداعي',
  },
  临时要求: {
    en: 'Temporary requirement',
    ar: 'متطلب مؤقت',
  },
  图片与视频: {
    en: 'Images and videos',
    ar: 'الصور والفيديو',
  },
  到期时间: {
    en: 'Expires at',
    ar: 'وقت انتهاء الصلاحية',
  },
  '半衰期（天）': {
    en: 'Half-life (days)',
    ar: 'فترة انخفاض الوزن إلى النصف (أيام)',
  },
  '只保存你明确确认的信息；本次需求不会自动变成长期记忆。': {
    en: 'Only information you explicitly confirm is saved. This request does not automatically become long-term memory.',
    ar: 'تُحفظ المعلومات التي تؤكدها صراحةً فقط. هذا الطلب لا يتحول تلقائياً إلى ذاكرة طويلة الأمد.',
  },
  '同一适用范围的相同主题请编辑原记忆，避免重复与矛盾。': {
    en: 'Edit the existing memory for the same topic and scope to avoid duplicates or conflicts.',
    ar: 'عدّل الذاكرة الحالية للموضوع والنطاق نفسيهما لتجنب التكرار أو التعارض.',
  },
  '临时要求必须设置期限；到期后不再带入新规划。': {
    en: 'Temporary requirements need an expiry and are excluded from new plans after it.',
    ar: 'تحتاج المتطلبات المؤقتة إلى تاريخ انتهاء، وتُستبعد بعده من الخطط الجديدة.',
  },
  '偏好权重随时间降低，低于四分之一后不再自动采用；重新确认可恢复权重。': {
    en: 'Preference weight decreases over time. Below one quarter it is excluded; reconfirming restores its weight.',
    ar: 'ينخفض وزن التفضيل بمرور الوقت. ويُستبعد عندما يقل عن الربع؛ وتُعيد إعادة التأكيد وزنه.',
  },
  '职业等长期背景不随时间衰减；发生变化时请编辑替换。': {
    en: 'Long-term background such as your profession does not decay; edit it when it changes.',
    ar: 'المعلومات طويلة الأمد، مثل المهنة، لا تتلاشى؛ عدّلها عند تغيرها.',
  },
  '记忆管理仅你在当前空间可见。被采用的信息可能出现在协作成员可见的方案和作品中；每次创作都可关闭记忆。':
    {
      en: 'Memory management is private to you in this workspace. Used information may appear in plans and creations visible to collaborators; you can turn memory off for each creation.',
      ar: 'إدارة الذاكرة خاصة بك في هذه المساحة. قد تظهر المعلومات المستخدمة في خطط وأعمال يراها المتعاونون؛ ويمكنك تعطيل الذاكرة لكل عملية إنشاء.',
    },
  '停用、过期或衰减过低的记忆不带入新规划。编辑或删除不会改写历史确认方案。': {
    en: 'Paused, expired or faded memories are excluded from new plans. Editing or deleting them does not rewrite confirmed plans.',
    ar: 'تُستبعد الذكريات المعطلة أو المنتهية أو المتلاشية من الخطط الجديدة. تعديلها أو حذفها لا يغيّر الخطط المؤكدة.',
  },
  搜索记忆: {
    en: 'Search memories',
    ar: 'البحث في الذكريات',
  },
  还没有创作记忆: {
    en: 'No creative memories yet',
    ar: 'لا توجد ذكريات إبداعية بعد',
  },
  '保存职业背景、常用风格或有期限的要求，下一次创作按需复用。': {
    en: 'Save your professional background, preferred styles or temporary requirements for future creations.',
    ar: 'احفظ خلفيتك المهنية أو الأنماط المفضلة أو المتطلبات المؤقتة لاستخدامها في أعمال لاحقة.',
  },
  可用于新规划: {
    en: 'Available for new plans',
    ar: 'متاحة للخطط الجديدة',
  },
  待重新确认: {
    en: 'Needs reconfirmation',
    ar: 'تحتاج إلى إعادة تأكيد',
  },
  最近确认: {
    en: 'Last confirmed',
    ar: 'آخر تأكيد',
  },
  当前权重: {
    en: 'Current weight',
    ar: 'الوزن الحالي',
  },
  重新确认: {
    en: 'Reconfirm',
    ar: 'إعادة التأكيد',
  },
  记忆已重新确认: {
    en: 'Memory reconfirmed',
    ar: 'تمت إعادة تأكيد الذاكرة',
  },
  '删除这条记忆？': {
    en: 'Delete this memory?',
    ar: 'هل تريد حذف هذه الذاكرة؟',
  },
  '删除后不再用于新规划；已经确认的历史方案仍保留当时快照。': {
    en: 'It will no longer be used in new plans. Confirmed plans retain their original snapshots.',
    ar: 'لن تُستخدم في خطط جديدة. تحتفظ الخطط المؤكدة بلقطاتها الأصلية.',
  },
  记忆已删除: {
    en: 'Memory deleted',
    ar: 'تم حذف الذاكرة',
  },
  参考产品: {
    en: 'Reference product',
    ar: 'المنتج المرجعي',
  },
  使用创作记忆: {
    en: 'Use creative memory',
    ar: 'استخدام ذاكرة الإنشاء',
  },
  管理创作记忆: {
    en: 'Manage creative memory',
    ar: 'إدارة ذاكرة الإنشاء',
  },
  '仅采用当前空间中你确认过且仍有效的记忆；本次明确要求优先。': {
    en: 'Only confirmed, valid memories from this workspace are used. Explicit requirements for this creation take priority.',
    ar: 'تُستخدم الذكريات المؤكدة والصالحة في هذه المساحة فقط. وتكون الأولوية للمتطلبات الصريحة لهذا العمل.',
  },
  '记忆预览读取失败，请重试；规划时会重新核对。': {
    en: 'Memory preview could not load. Retry; it will be checked again when planning.',
    ar: 'تعذر تحميل معاينة الذاكرة. أعد المحاولة؛ وستُراجع مجدداً عند التخطيط.',
  },
  当前可用记忆: {
    en: 'Currently available memories',
    ar: 'الذكريات المتاحة حالياً',
  },
  '这里只预览当前页，实际采用项以规划后的资料快照为准。': {
    en: 'This previews the current page. The planning snapshot shows what was actually used.',
    ar: 'هذه معاينة للصفحة الحالية. تعرض لقطة التخطيط ما استُخدم فعلياً.',
  },
  产品所属品牌: {
    en: 'Product brand',
    ar: 'العلامة التجارية للمنتج',
  },
  '未另选品牌时会采用产品所属品牌。': {
    en: 'The product brand is used unless another brand is selected.',
    ar: 'تُستخدم علامة المنتج ما لم تُحدد علامة أخرى.',
  },
  '所选品牌与产品所属品牌冲突，请改选品牌或产品。': {
    en: 'The selected brand conflicts with the product brand. Change the brand or product.',
    ar: 'العلامة المحددة تتعارض مع علامة المنتج. غيّر العلامة أو المنتج.',
  },
  采用产品所属品牌: {
    en: 'Use product brand',
    ar: 'استخدام علامة المنتج',
  },
  '产品资料已过期，请更新资料或重新选择。': {
    en: 'Product details have expired. Update them or choose again.',
    ar: 'انتهت صلاحية معلومات المنتج. حدّثها أو اختر مجدداً.',
  },
  带入产品参考图: {
    en: 'Include product reference images',
    ar: 'تضمين الصور المرجعية للمنتج',
  },
  '默认仅使用产品文字资料；参考图与本次素材共同受模型数量限制。': {
    en: "Only product text is used by default. Reference images share the model limit with this creation's assets.",
    ar: 'يُستخدم نص المنتج فقط افتراضياً. تشترك الصور المرجعية مع مواد العمل في الحد الأقصى للنموذج.',
  },
  管理产品库: {
    en: 'Manage products',
    ar: 'إدارة مكتبة المنتجات',
  },
  记住这次要求: {
    en: 'Remember this requirement',
    ar: 'تذكّر هذا المتطلب',
  },
  本次采用的资料: {
    en: 'Information used for this plan',
    ar: 'المعلومات المستخدمة في هذه الخطة',
  },
  '以下为本次规划的资料快照；后续编辑不改变已确认方案。': {
    en: 'This is the information snapshot for this plan. Later edits do not change confirmed plans.',
    ar: 'هذه لقطة المعلومات لهذه الخطة. التعديلات اللاحقة لا تغيّر الخطط المؤكدة.',
  },
  本次未采用的记忆: {
    en: 'Memories omitted from this plan',
    ar: 'الذكريات المستبعدة من هذه الخطة',
  },
  '仅取适用且有效的有限资料，避免无关信息干扰。': {
    en: 'Only a limited set of relevant, valid information is used to avoid irrelevant context.',
    ar: 'تُستخدم مجموعة محدودة من المعلومات المناسبة والصالحة لتجنب التشويش.',
  },
  版本: {
    en: 'Version',
    ar: 'الإصدار',
  },
};
