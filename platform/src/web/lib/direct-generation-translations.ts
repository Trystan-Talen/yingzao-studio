export const DIRECT_GENERATION_TRANSLATIONS: Readonly<
  Record<string, Readonly<{ en: string; ar: string }>>
> = {
  关联配置: { en: 'Linked context', ar: 'المعلومات المرتبطة' },
  思考: { en: 'Thinking', ar: 'التفكير' },
  开: { en: 'On', ar: 'مفعّل' },
  关: { en: 'Off', ar: 'متوقف' },
  分析参考作品: { en: 'Analyze reference', ar: 'تحليل العمل المرجعي' },
  '补充完成，继续分析': { en: 'Continue analysis', ar: 'متابعة التحليل' },
  '参考素材类型须与当前复刻类型一致。': {
    en: 'The reference must match the selected recreation media type.',
    ar: 'يجب أن يتوافق المرجع مع نوع الوسائط المختار للمحاكاة.',
  },
  '复刻草稿已保留，前往独立复刻页': {
    en: 'Your recreation draft is saved. Open reference recreation',
    ar: 'تم حفظ مسودة المحاكاة. افتح صفحة محاكاة المراجع',
  },
  '关联资料需要核对，请打开关联配置。': {
    en: 'Review your linked information in Linked context.',
    ar: 'راجع معلوماتك المرتبطة في إعدادات المعلومات المرتبطة.',
  },
  '图片生成需启用图片服务；视频生成还需视频服务。开启思考模式时才需要文本规划。': {
    en: 'Images require an image service; video also requires a video service. Text planning is required only when thinking mode is on.',
    ar: 'تتطلب الصور خدمة صور، والفيديو خدمة فيديو أيضًا. التخطيط النصي مطلوب فقط عند تفعيل وضع التفكير.',
  },
  关联品牌与产品: { en: 'Brand and product', ar: 'العلامة التجارية والمنتج' },
  管理品牌: { en: 'Manage brands', ar: 'إدارة العلامات التجارية' },
  思考模式: { en: 'Thinking mode', ar: 'وضع التفكير' },
  '已关闭 · 直接生成': { en: 'Off · Generate directly', ar: 'متوقف · توليد مباشر' },
  '已开启 · 先规划再生成': { en: 'On · Plan before generating', ar: 'مفعّل · تخطيط قبل التوليد' },
  '直接使用需求与已选资料，跳过文本规划；视频仍可能需要生成首帧。': {
    en: 'Use your request and selected information directly, skipping text planning. Video may still require a generated first frame.',
    ar: 'استخدم طلبك والمعلومات المختارة مباشرة دون تخطيط نصي. قد يظل الفيديو بحاجة إلى توليد إطار أول.',
  },
  '直接使用需求与已选资料生成，跳过文本模型规划，减少规划费用。': {
    en: 'Generate from your request and selected information directly, skipping the text model to reduce planning costs.',
    ar: 'ولّد مباشرة من طلبك والمعلومات المختارة دون نموذج نصي لتقليل تكلفة التخطيط.',
  },
  '先由文本模型梳理需求，再调用生成模型；可关闭以跳过文本规划。': {
    en: 'A text model plans your request before generation. Turn this off to skip text planning.',
    ar: 'يخطط نموذج نصي لطلبك قبل التوليد. أوقفه لتجاوز التخطيط النصي.',
  },
  '参考复刻与分组物料需要思考模式，请开启后继续。': {
    en: 'Reference recreation and grouped materials require thinking mode. Enable it to continue.',
    ar: 'تحتاج محاكاة المراجع والمواد المجمّعة إلى وضع التفكير. فعّله للمتابعة.',
  },
  '思考模式需要文本模型。可关闭思考直接生成，或前往模型配置。': {
    en: 'Thinking mode requires a text model. Turn it off to generate directly, or configure a text model.',
    ar: 'يتطلب وضع التفكير نموذجًا نصيًا. أوقفه للتوليد المباشر، أو قم بإعداد نموذج نصي.',
  },
  '以下为本次直接生成的资料快照；后续编辑不改变已确认内容。': {
    en: 'This is the information snapshot for direct generation. Later edits do not change confirmed content.',
    ar: 'هذه لقطة المعلومات للتوليد المباشر. التعديلات اللاحقة لا تغيّر المحتوى المؤكد.',
  },
  生成内容: { en: 'Generation content', ar: 'محتوى التوليد' },
  '正在准备直接生成…': { en: 'Preparing direct generation…', ar: 'جارٍ إعداد التوليد المباشر…' },
  生成准备还没完成: { en: 'Generation preparation is incomplete', ar: 'لم يكتمل إعداد التوليد' },
  按最新资料更新: { en: 'Update with latest information', ar: 'تحديث بأحدث المعلومات' },
  '取消当前待确认报价。再次点击生成时读取最新资料，不调用文本规划模型。': {
    en: 'Discard the pending quote. The next Generate click reads the latest information without calling a text planning model.',
    ar: 'ألغِ عرض التكلفة المعلّق. عند الضغط على التوليد مجددًا تُقرأ أحدث المعلومات دون استدعاء نموذج تخطيط نصي.',
  },
  '原始需求与素材选择不变。': {
    en: 'Your original request and selected assets stay unchanged.',
    ar: 'يبقى طلبك الأصلي والملفات المختارة دون تغيير.',
  },
  '直接生成已准备，查看内容': {
    en: 'Direct generation ready · View content',
    ar: 'التوليد المباشر جاهز · عرض المحتوى',
  },
  '思考模式已关闭：本次跳过文本规划，直接生成。': {
    en: 'Thinking mode is off: this generation skips text planning.',
    ar: 'وضع التفكير متوقف: يتجاوز هذا التوليد التخطيط النصي.',
  },
};
