/** Static product copy only. Never pass user names, prompts, document text or asset names to t().
 * Unknown strings remain unchanged; no substring replacement or external translation is performed.
 * Generated from the actual UI inventory and reviewed translations, not an online runtime service.
 */
import { ACCOUNT_TRANSLATIONS } from './account-translations';
import { CREATION_TRANSLATIONS } from './creation-translations';
import { CREDIT_TRANSLATIONS } from './credit-translations';
import { WORKFLOW_TRANSLATIONS } from './workflow-translations';
import { SUPPORT_TRANSLATIONS } from './support-translations';
import { TEAM_CREATION_TRANSLATIONS } from './team-creation-translations';
export type Locale = 'zh-CN' | 'en' | 'ar';
export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-CN', 'en', 'ar'];
export const TRANSLATIONS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>> = {
  魔法消除: { en: 'Object eraser', ar: 'إزالة العناصر' },
  模特替换: { en: 'Model replacement', ar: 'استبدال العارض' },
  '涂画移除物体，补全背景并保留未编辑区域': {
    en: 'Paint to remove objects, rebuild the background and preserve untouched areas',
    ar: 'حدّد العناصر بالرسم لإزالتها وإكمال الخلفية مع الحفاظ على المناطق الأخرى',
  },
  '保留服装细节，替换为指定模特与可选背景': {
    en: 'Transfer clothing to a chosen model with an optional background',
    ar: 'انقل الملابس إلى عارض محدد مع خلفية اختيارية',
  },
  '从细节调整到画面重构，为每一步创作提供独立工具。': {
    en: 'Dedicated tools for every step, from fine adjustments to a new composition.',
    ar: 'أدوات مخصصة لكل خطوة، من تعديل التفاصيل إلى إعادة تكوين الصورة.',
  },
  '服装 / 人台原图': {
    en: 'Clothing or mannequin source',
    ar: 'صورة الملابس أو المانيكان الأصلية',
  },
  目标模特图: { en: 'Target model image', ar: 'صورة العارض المستهدف' },
  '背景参考（可选）': { en: 'Background reference (optional)', ar: 'مرجع الخلفية (اختياري)' },
  '补充说明（可选）': { en: 'Additional instructions (optional)', ar: 'تعليمات إضافية (اختيارية)' },
  '涂画要移除的物体，未涂画区域保留原图像素。图片最多10MiB、宽高8192、6400万像素、长短边比不超过5。':
    {
      en: 'Paint over objects to remove. Untouched pixels remain from the original. Maximum 10 MiB, 8192 pixels per side, 64 megapixels and 5:1 aspect ratio.',
      ar: 'ارسم فوق العناصر المراد إزالتها. تبقى البكسلات غير المحددة من الأصل. الحد الأقصى 10 ميبيبايت و8192 بكسل لكل ضلع و64 مليون بكسل ونسبة أبعاد 5:1.',
    },
  '服装、目标模特与背景分别保存。请使用获授权的素材，服装细节与人物一致性需检查真实结果。': {
    en: 'Clothing, target model and background are saved separately. Use authorized images and inspect clothing details and identity in the actual result.',
    ar: 'تُحفظ الملابس والعارض والخلفية بشكل منفصل. استخدم صورًا مصرحًا بها وتحقق من تفاصيل الملابس وهوية العارض في النتيجة الفعلية.',
  },
  '此消除模型只接受原图与蒙版、最多2500万像素；补充说明请选择OpenAI服务。': {
    en: 'This eraser accepts an image and mask up to 25 megapixels. Choose OpenAI for additional instructions.',
    ar: 'تقبل أداة الإزالة صورة وقناعًا حتى 25 مليون بكسل. اختر OpenAI للتعليمات الإضافية.',
  },
  '此试衣模型只接受服装与目标模特；使用背景或补充说明请选择OpenAI服务。': {
    en: 'This try-on model accepts only clothing and a target person. Choose OpenAI for a background or additional instructions.',
    ar: 'يقبل نموذج تجربة الملابس صورة الملابس والشخص المستهدف فقط. اختر OpenAI للخلفية أو التعليمات الإضافية.',
  },
  '请先涂画需要消除的区域，空遮罩不能提交。': {
    en: 'Paint the area to erase first. An empty mask cannot be submitted.',
    ar: 'ارسم المنطقة المراد إزالتها أولًا. لا يمكن إرسال قناع فارغ.',
  },
  消除区域已保存: { en: 'Erasure region saved', ar: 'تم حفظ منطقة الإزالة' },
  在原图上涂画需要消除的物体: {
    en: 'Paint over objects to erase in the original image',
    ar: 'ارسم فوق العناصر المراد إزالتها في الصورة الأصلية',
  },
  '白色涂画区域中的物体将被移除。蒙版按原图尺寸保存。': {
    en: 'Objects in the white painted area will be removed. The mask keeps the original dimensions.',
    ar: 'ستُزال العناصر في المنطقة المرسومة بالأبيض. يُحفظ القناع بأبعاد الصورة الأصلية.',
  },
  保存消除区域: { en: 'Save erasure region', ar: 'حفظ منطقة الإزالة' },
  '授权地址无法验证，请重新开始。': {
    en: 'The authorization address could not be verified. Please start again.',
    ar: 'تعذّر التحقق من عنوان التفويض. يُرجى البدء مجددًا.',
  },
  'Google 账户已关联。后续可使用该账户登录。': {
    en: 'Google account linked. You can now use it to sign in.',
    ar: 'تم ربط حساب Google. يمكنك الآن استخدامه لتسجيل الدخول.',
  },
  '此邮箱已有本地账户。请先使用密码登录，再在设置中明确关联 Google 账户。': {
    en: 'A local account already uses this email. Sign in with your password, then explicitly link Google in Settings.',
    ar: 'يوجد حساب محلي بهذا البريد. سجّل الدخول بكلمة المرور، ثم اربط حساب Google صراحةً من الإعدادات.',
  },
  'Google 授权未完成。请重新开始，或使用已有登录方式。': {
    en: 'Google authorization was not completed. Start again or use an existing sign-in method.',
    ar: 'لم يكتمل تفويض Google. ابدأ مجددًا أو استخدم طريقة تسجيل الدخول الحالية.',
  },
  '使用 Google 继续': { en: 'Continue with Google', ar: 'المتابعة باستخدام Google' },
  '新账户仍受当前注册与团队邀请规则限制。': {
    en: 'New accounts remain subject to the current registration and team invitation rules.',
    ar: 'تظل الحسابات الجديدة خاضعة لقواعد التسجيل ودعوات الفريق الحالية.',
  },
  已关联: { en: 'Linked', ar: 'مرتبط' },
  未关联: { en: 'Not linked', ar: 'غير مرتبط' },
  关联邮箱: { en: 'Linked email', ar: 'البريد المرتبط' },
  关联时间: { en: 'Linked at', ar: 'تاريخ الربط' },
  '此实例尚未启用可用的 Google 登录服务。': {
    en: 'Google sign-in is not enabled for this installation.',
    ar: 'تسجيل الدخول عبر Google غير مفعّل في هذا التثبيت.',
  },
  '使用当前本地密码确认后，前往 Google 完成关联；相同邮箱不会自动合并账户。': {
    en: 'Confirm your current local password, then complete linking at Google. Matching email addresses do not merge accounts automatically.',
    ar: 'أكّد كلمة المرور المحلية الحالية، ثم أكمل الربط لدى Google. لا تُدمج الحسابات تلقائيًا عند تطابق البريد.',
  },
  '关联 Google 账户': { en: 'Link Google account', ar: 'ربط حساب Google' },
  '此账户通过 Google 创建，尚未设置本地密码，不能解除唯一登录方式。': {
    en: 'This account was created with Google and has no local password. Its only sign-in method cannot be removed.',
    ar: 'أُنشئ هذا الحساب عبر Google ولا يملك كلمة مرور محلية. لا يمكن إزالة طريقة الدخول الوحيدة.',
  },
  '仅已有本地密码的账户可解除关联，不能移除唯一登录方式。解除后其他会话将退出。': {
    en: 'Only accounts with a local password can unlink Google. The only sign-in method cannot be removed. Other sessions will be signed out.',
    ar: 'يمكن فقط للحسابات ذات كلمة مرور محلية إلغاء ربط Google. لا يمكن إزالة طريقة الدخول الوحيدة. سيُنهى تسجيل الدخول في الجلسات الأخرى.',
  },
  '解除 Google 关联': { en: 'Unlink Google', ar: 'إلغاء ربط Google' },
  'Google 关联已解除': { en: 'Google account unlinked', ar: 'تم إلغاء ربط حساب Google' },
  '此操作会解除关联并撤销其他会话。当前会话保留。': {
    en: 'This unlinks the account and revokes other sessions. Your current session stays signed in.',
    ar: 'يلغي هذا الإجراء ربط الحساب والجلسات الأخرى. تبقى جلستك الحالية مسجّلة الدخول.',
  },
  '确认本地密码后会跳转到 Google。请核对将要关联的账户。': {
    en: 'After confirming your local password, you will go to Google. Check which account you are linking.',
    ar: 'بعد تأكيد كلمة المرور المحلية ستنتقل إلى Google. تأكّد من الحساب الذي تريد ربطه.',
  },
  当前本地密码: { en: 'Current local password', ar: 'كلمة المرور المحلية الحالية' },
  确认解除关联: { en: 'Confirm unlinking', ar: 'تأكيد إلغاء الربط' },
  '验证并前往 Google': { en: 'Verify and continue to Google', ar: 'التحقق والمتابعة إلى Google' },
  邮件已排队: { en: 'Email queued', ar: 'البريد في قائمة الانتظار' },
  正在投递: { en: 'Submitting email', ar: 'جارٍ إرسال البريد' },
  等待重试: { en: 'Waiting to retry', ar: 'بانتظار إعادة المحاولة' },
  邮件服务器已接受: { en: 'Accepted by mail server', ar: 'قبله خادم البريد' },
  投递失败: { en: 'Submission failed', ar: 'فشل الإرسال' },
  投递结果待核对: { en: 'Submission needs review', ar: 'نتيجة الإرسال تحتاج إلى مراجعة' },
  邮件记录仅供空间管理员查看: {
    en: 'Email records are available to workspace administrators only',
    ar: 'سجلات البريد متاحة لمسؤولي مساحة العمل فقط',
  },
  '请联系当前空间的创建者或管理员。': {
    en: 'Contact the owner or administrator of this workspace.',
    ar: 'تواصل مع مالك مساحة العمل أو مسؤولها.',
  },
  邮件投递状态: { en: 'Email submission status', ar: 'حالة إرسال البريد' },
  '当前工作空间最近 50 条投递记录。这里只展示状态，不展示收件人或邮件正文。': {
    en: 'The latest 50 email records for this workspace. Only status is shown; recipients and message content are hidden.',
    ar: 'آخر 50 سجل إرسال لهذه المساحة. تظهر الحالة فقط، دون المستلمين أو محتوى الرسائل.',
  },
  '邮件服务已启用。排队不代表发送成功；服务器已接受也不保证邮件进入收件箱。': {
    en: 'Email is enabled. Queuing does not mean successful sending, and server acceptance does not guarantee inbox delivery.',
    ar: 'خدمة البريد مفعّلة. الإدراج في الانتظار لا يعني نجاح الإرسال، وقبول الخادم لا يضمن الوصول إلى صندوق الوارد.',
  },
  '当前未启用邮件服务。团队邀请仍可复制链接后自行发送。': {
    en: 'Email is currently disabled. You can still copy and share team invitation links yourself.',
    ar: 'خدمة البريد غير مفعّلة حاليًا. لا يزال بإمكانك نسخ روابط دعوات الفريق وإرسالها بنفسك.',
  },
  投递状态: { en: 'Submission status', ar: 'حالة الإرسال' },
  暂无符合条件的邮件记录: {
    en: 'No email records match these filters',
    ar: 'لا توجد سجلات بريد مطابقة للتصفية',
  },
  '启用服务后，符合规则的团队邀请与支持通知会记录实际投递状态。': {
    en: 'Once email is enabled, eligible team invitations and support notifications will show their actual submission status.',
    ar: 'بعد تفعيل البريد، ستظهر حالة الإرسال الفعلية لدعوات الفريق وإشعارات الدعم المستوفية للشروط.',
  },
  记录: { en: 'Record', ar: 'السجل' },
  尝试次数: { en: 'Attempts', ar: 'المحاولات' },
  下次重试: { en: 'Next retry', ar: 'المحاولة التالية' },
  更新时间: { en: 'Updated at', ar: 'آخر تحديث' },
  状态详情: { en: 'Status details', ar: 'تفاصيل الحالة' },
  服务器接受时间: { en: 'Server acceptance time', ar: 'وقت قبول الخادم' },
  '等待重试由服务端按计划处理；结果待核对时不会自动重复发送。此页不提供强制重发。': {
    en: 'The server schedules retries. Ambiguous results are not sent again automatically. This page does not force resending.',
    ar: 'يجدول الخادم إعادة المحاولة. لا تُرسل النتائج غير المؤكدة مجددًا تلقائيًا. لا تتيح هذه الصفحة فرض إعادة الإرسال.',
  },
  邮件投递: { en: 'Email status', ar: 'حالة البريد' },
  '仅展示当前实例实际可用的登录方式，不会发送演示验证码。': {
    en: 'Only sign-in methods available in this installation are shown. No demo verification codes are sent.',
    ar: 'تظهر فقط طرق الدخول المتاحة فعليًا في هذا التثبيت. لا تُرسل رموز تحقق تجريبية.',
  },
  '生成专属链接并将邀请邮件加入投递队列。仅指定邮箱的账户可以加入。': {
    en: 'Create a dedicated link and queue an invitation email. Only an account with the specified email can join.',
    ar: 'أنشئ رابطًا خاصًا وأضف بريد الدعوة إلى قائمة الإرسال. لا يمكن الانضمام إلا بحساب يستخدم البريد المحدد.',
  },
  '生成专属链接；邮件服务未启用时请自行发送链接。仅指定邮箱的账户可以加入。': {
    en: 'Create a dedicated link. If email is disabled, share the link yourself. Only an account with the specified email can join.',
    ar: 'أنشئ رابطًا خاصًا. أرسل الرابط بنفسك إذا كان البريد غير مفعّل. لا يمكن الانضمام إلا بحساب يستخدم البريد المحدد.',
  },
  '关闭后不会再次显示完整邀请令牌。请保管好链接。': {
    en: 'The full invitation token will not be shown again after closing. Keep the link safe.',
    ar: 'لن يظهر رمز الدعوة كاملًا مرة أخرى بعد الإغلاق. احتفظ بالرابط بأمان.',
  },
  '邀请邮件已排队，尚不代表送达。可在设置中查看实际投递状态。': {
    en: 'The invitation email is queued; this does not confirm delivery. Check its actual status in Settings.',
    ar: 'أُضيف بريد الدعوة إلى الانتظار؛ وهذا لا يؤكد وصوله. يمكنك مراجعة حالته الفعلية في الإعدادات.',
  },
  '此邀请已有邮件投递记录，未重复排队。请在设置中核对实际状态。': {
    en: 'This invitation already has an email record and was not queued again. Check its actual status in Settings.',
    ar: 'يوجد سجل بريد لهذه الدعوة، ولم تُضف إلى الانتظار مرة أخرى. راجع حالتها الفعلية في الإعدادات.',
  },
  '当前未自动发送邮件，请复制链接后自行发送给成员。': {
    en: 'No email was sent automatically. Copy the link and share it with the member yourself.',
    ar: 'لم يُرسل بريد تلقائيًا. انسخ الرابط وأرسله إلى العضو بنفسك.',
  },
  'Stripe 账单': { en: 'Stripe invoice', ar: 'فاتورة Stripe' },
  '这是支付服务商提供的订阅账单，不代表本地税务发票已开具。': {
    en: 'This is the payment provider’s subscription invoice. It does not confirm issuance of a local tax invoice.',
    ar: 'هذه فاتورة اشتراك من مزوّد الدفع، ولا تؤكد إصدار فاتورة ضريبية محلية.',
  },
  查看服务商账单: { en: 'View provider invoice', ar: 'عرض فاتورة المزوّد' },
  '打开账单 PDF': { en: 'Open invoice PDF', ar: 'فتح الفاتورة بصيغة PDF' },
  '服务商暂未提供此账单的查看链接。': {
    en: 'The provider has not supplied viewing links for this invoice yet.',
    ar: 'لم يوفّر المزوّد روابط لعرض هذه الفاتورة بعد.',
  },
  当前账户已登录: { en: 'This account is already signed in', ar: 'هذا الحساب مسجّل الدخول بالفعل' },
  '注册邀请供新账户使用；当前账户可以继续使用工作空间。': {
    en: 'Registration invitations are for new accounts. You can continue using your current workspace.',
    ar: 'دعوات التسجيل مخصّصة للحسابات الجديدة. يمكنك متابعة استخدام مساحة العمل بحسابك الحالي.',
  },
  初始额度: { en: 'Initial credits', ar: 'الرصيد الأولي' },
  历史导入: { en: 'Historical import', ar: 'استيراد السجل السابق' },
  会员额度: { en: 'Subscription credits', ar: 'رصيد الاشتراك' },
  推荐奖励: { en: 'Referral reward', ar: 'مكافأة الإحالة' },
  管理员调整: { en: 'Administrator adjustment', ar: 'تعديل المسؤول' },
  历史退款: { en: 'Historical refund', ar: 'استرداد سابق' },
  已封存: { en: 'Frozen', ar: 'مجمّد' },
  已失效: { en: 'Expired', ar: 'منتهي الصلاحية' },
  额度来源与有效期: { en: 'Credit sources and validity', ar: 'مصادر الرصيد وصلاحيته' },
  '每笔额度分别记录有效期，封存额度不能用于新任务。': {
    en: 'Each credit grant has its own validity period. Frozen credits cannot be used for new tasks.',
    ar: 'لكل دفعة رصيد فترة صلاحية مستقلة. ولا يمكن استخدام الرصيد المجمّد لمهام جديدة.',
  },
  '会员额度到期后封存 3 个月；封存期内有效续费可恢复，超过封存期清零。额度包自付款起有效 1 年，再次购买会延长尚未失效的同类额度包。':
    {
      en: 'Subscription credits are frozen for 3 months after expiry. A valid renewal during that period restores them; after it, they are cleared. Credit packs are valid for 1 year from payment. Buying again extends unexpired packs of the same type.',
      ar: 'يُجمّد رصيد الاشتراك لمدة 3 أشهر بعد انتهاء صلاحيته. ويُستعاد بالتجديد الساري خلال هذه الفترة، ثم يُصفّر بعدها. تسري حزم الرصيد سنة واحدة من الدفع، ويُمدّد الشراء مجددًا صلاحية الحزم المماثلة التي لم تنتهِ.',
    },
  当前可用: { en: 'Currently available', ar: 'المتاح حاليًا' },
  各有效来源的可用额度合计: {
    en: 'Total available credits across valid sources',
    ar: 'إجمالي الرصيد المتاح من المصادر السارية',
  },
  封存不可用: { en: 'Frozen and unavailable', ar: 'مجمّد وغير متاح' },
  不包含已经预留给任务的额度: {
    en: 'Excludes credits already reserved for tasks',
    ar: 'لا يشمل الرصيد المحجوز للمهام',
  },
  '30 天内到期': { en: 'Expires within 30 days', ar: 'ينتهي خلال 30 يومًا' },
  仅统计当前仍可用的额度: {
    en: 'Counts only credits that are still available',
    ar: 'يحتسب الرصيد الذي لا يزال متاحًا فقط',
  },
  来源记录: { en: 'Source records', ar: 'سجلات المصادر' },
  额度有效状态: { en: 'Credit validity status', ar: 'حالة صلاحية الرصيد' },
  原始发放: { en: 'Originally granted', ar: 'الممنوح أصلاً' },
  '可用 / 封存': { en: 'Available / frozen', ar: 'المتاح / المجمّد' },
  在途预留: { en: 'Reserved for active tasks', ar: 'المحجوز للمهام الجارية' },
  '历史有效期未知，当前不设到期': {
    en: 'Historical validity is unknown; no expiry is currently set',
    ar: 'فترة الصلاحية السابقة غير معروفة؛ لا يوجد انتهاء محدد حاليًا',
  },
  未设置到期时间: { en: 'No expiry set', ar: 'لا يوجد تاريخ انتهاء محدد' },
  '封存截止：': { en: 'Frozen until:', ar: 'مجمّد حتى:' },
  没有符合筛选的额度来源: {
    en: 'No credit sources match these filters',
    ar: 'لا توجد مصادر رصيد مطابقة للتصفية',
  },
  '额度发放后会在这里显示来源和有效期。': {
    en: 'Credit sources and validity periods appear here after credits are granted.',
    ar: 'تظهر هنا مصادر الرصيد وفترات صلاحيته بعد منحه.',
  },
  '到期或封存不会重复扣减在途预留；任务完成后按原来源结算。恢复和延长有效期以已确认付款或管理员审计记录为准。':
    {
      en: 'Expiry or freezing does not deduct active reservations again. Completed tasks settle against the original source. Restoration and extensions require confirmed payment or an audited administrator action.',
      ar: 'لا يخصم الانتهاء أو التجميد الحجوزات الجارية مرة ثانية. وتُسوّى المهام المكتملة من مصدرها الأصلي. تتطلب الاستعادة والتمديد دفعًا مؤكدًا أو إجراءً إداريًا مسجّلًا للتدقيق.',
    },
  '此空间的应用导出会添加水印，导出时将重新核对当前策略。': {
    en: 'Application exports in this workspace include a watermark. The current policy is checked again when exporting.',
    ar: 'تتضمن صادرات التطبيق في هذه المساحة علامة مائية. وتُفحص السياسة الحالية مجددًا عند التصدير.',
  },
  '导出时会重新核对当前水印策略；策略读取失败时不会继续下载。': {
    en: 'The watermark policy is checked again on export. Downloads stop if the policy cannot be read.',
    ar: 'تُفحص سياسة العلامة المائية مجددًا عند التصدير. ويتوقف التنزيل إذا تعذرت قراءتها.',
  },
  '导出时将核对水印策略。': {
    en: 'The watermark policy will be checked when exporting.',
    ar: 'ستُفحص سياسة العلامة المائية عند التصدير.',
  },
  '当前应用导出将添加工作空间水印。': {
    en: 'Current application exports will include the workspace watermark.',
    ar: 'ستتضمن صادرات التطبيق الحالية العلامة المائية لمساحة العمل.',
  },
  '当前有效订阅享有应用导出无水印权益。': {
    en: 'The current active subscription includes watermark-free application exports.',
    ar: 'يتضمن الاشتراك الساري الحالي تصديرًا من التطبيق بلا علامة مائية.',
  },
  '当前应用导出不添加水印。': {
    en: 'Current application exports have no watermark.',
    ar: 'صادرات التطبيق الحالية بلا علامة مائية.',
  },
  '导出时将重新核对策略；此规则不限制原素材下载，也不能防止客户端修改。': {
    en: 'The policy is checked again on export. It does not restrict original-asset downloads or prevent client-side modifications.',
    ar: 'تُفحص السياسة مجددًا عند التصدير. ولا تقيّد تنزيل المواد الأصلية أو تمنع التعديلات من جهة العميل.',
  },
  待处理: { en: 'Pending', ar: 'قيد الانتظار' },
  已处理: { en: 'Resolved', ar: 'تمت المعالجة' },
  '默认先检查文字，无文字返回原图并释放平台额度；预检可能产生供应商费用。识别有遗漏时可强制翻译，按正常任务结算。提交前仍需具备报价所需额度。':
    {
      en: 'Text is checked first by default. If none is found, the original image is returned and platform credits are released; the provider may charge for the check. If text was missed, force translation with normal settlement. The quoted credits are still required before submission.',
      ar: 'يُفحص النص أولًا افتراضيًا. إذا لم يُعثر عليه، تُعاد الصورة الأصلية ويُحرّر رصيد المنصة؛ وقد يفرض المزوّد رسوم الفحص. عند تفويت نص، يمكن فرض الترجمة بالتسوية العادية. يظل الرصيد المحدد في العرض مطلوبًا قبل الإرسال.',
    },
  仍然翻译未识别到文字的图片: {
    en: 'Translate even when no text was detected',
    ar: 'الترجمة حتى عند عدم اكتشاف نص',
  },
  来源与有效期: { en: 'Sources and validity', ar: 'المصادر والصلاحية' },
  月: { en: 'month', ar: 'شهر' },
  年: { en: 'year', ar: 'سنة' },
  读取画布: { en: 'Reading canvas', ar: 'جارٍ قراءة اللوحة' },
  '所选画布导出总像素超过 1 亿，请减少项目或降低倍率。': {
    en: 'The selected canvases exceed 100 million export pixels. Select fewer projects or a lower scale.',
    ar: 'تتجاوز اللوحات المحددة 100 مليون بكسل عند التصدير. قلّل عدد المشاريع أو معامل التكبير.',
  },
  '所选画布素材超过 250 MB，请分批导出。': {
    en: 'The selected canvas assets exceed 250 MB. Export in smaller batches.',
    ar: 'تتجاوز مواد اللوحات المحددة 250 ميغابايت. صدّر على دفعات أصغر.',
  },
  '正在渲染并打包画布…': {
    en: 'Rendering and archiving canvases…',
    ar: 'جارٍ تصيير اللوحات وتجميعها في أرشيف…',
  },
  项目画布已打包下载: {
    en: 'Project canvases downloaded as an archive',
    ar: 'تم تنزيل لوحات المشاريع في أرشيف',
  },
  批量导出项目画布: { en: 'Batch export project canvases', ar: 'تصدير لوحات المشاريع دفعة واحدة' },
  '导出各项目当前已保存的画布，并提供可选的来源参数清单。': {
    en: "Export each project's currently saved canvas, optionally including a manifest of source parameters.",
    ar: 'صدّر اللوحة المحفوظة حاليًا لكل مشروع، مع إمكانية تضمين قائمة بمعلمات المصدر.',
  },
  个项目: { en: 'projects', ar: 'مشاريع' },
  '包含 AI 参数与来源清单': {
    en: 'Include AI parameters and source manifest',
    ar: 'تضمين معلمات الذكاء الاصطناعي وقائمة المصادر',
  },
  '每次最多 20 个项目，总导出像素不超过 1 亿。视频原件请从素材库下载，画布导出保留当前静态构图。': {
    en: 'Up to 20 projects and 100 million export pixels per batch. Download original videos from the asset library; canvas exports preserve the current still composition.',
    ar: 'حتى 20 مشروعًا و100 مليون بكسل في كل دفعة. نزّل مقاطع الفيديو الأصلية من مكتبة المواد؛ يحفظ تصدير اللوحات التكوين الثابت الحالي.',
  },
  取消导出: { en: 'Cancel export', ar: 'إلغاء التصدير' },
  '导出 ZIP': { en: 'Export ZIP', ar: 'تصدير ZIP' },
  批量导出画布: { en: 'Batch export canvases', ar: 'تصدير اللوحات دفعة واحدة' },
  清空选择: { en: 'Clear selection', ar: 'مسح التحديد' },
  选择项目: { en: 'Select project', ar: 'اختيار مشروع' },
  选择: { en: 'Select', ar: 'اختيار' },
  '关联任务 ID（必填）': { en: 'Linked task ID (required)', ar: 'معرّف المهمة المرتبطة (مطلوب)' },
  '使用通用编辑模型处理短视频文字区域，效果需预览确认': {
    en: 'Use a general editing model on text regions in short videos; preview and confirm the result',
    ar: 'استخدم نموذج تحرير عام لمعالجة مناطق النص في المقاطع القصيرة؛ عاين النتيجة وتحقق منها',
  },
  'Bria · 短片文字区域擦除': {
    en: 'Bria · Short-video text region erasure',
    ar: 'Bria · إزالة مناطق النص من المقاطع القصيرة',
  },
  '仅支持小于 5 秒的源视频，保留音轨，不会自动裁短。通用编辑模型的处理效果需要预览确认，不保证无痕去字幕。':
    {
      en: 'Only source videos shorter than 5 seconds are supported. Audio is preserved and videos are never automatically trimmed. Preview the general editing model’s result; seamless subtitle removal is not guaranteed.',
      ar: 'تُدعم فقط مقاطع المصدر الأقصر من 5 ثوانٍ. يُحفظ الصوت ولا تُقصّر المقاطع تلقائيًا. عاين نتيجة نموذج التحرير العام؛ لا تُضمن إزالة الترجمة بلا أثر.',
    },
  '请先裁剪视频到 5 秒以下，再提交处理。': {
    en: 'Trim the video to less than 5 seconds before submitting it.',
    ar: 'قصّر الفيديو إلى أقل من 5 ثوانٍ قبل إرساله للمعالجة.',
  },

  创作建议: { en: 'Creative suggestions', ar: 'اقتراحات إبداعية' },
  完整设计方案: { en: 'Complete design plan', ar: 'خطة تصميم متكاملة' },
  '生成包含目标、受众、视觉方向、文案与物料规划的设计方案。': {
    en: 'Create a design plan covering goals, audience, visual direction, copy, and deliverables.',
    ar: 'أنشئ خطة تصميم تتضمن الأهداف والجمهور والتوجه البصري والنصوص والمخرجات.',
  },
  '会参考本项目最近的创作对话，最多 8 条、6000 字符。': {
    en: "Uses this project's recent creative conversation, up to 8 messages and 6,000 characters.",
    ar: 'يستند إلى أحدث محادثات الإبداع في هذا المشروع، بحد أقصى 8 رسائل و6000 حرف.',
  },
  今日文案免费剩余: {
    en: 'Free copywriting uses left today',
    ar: 'مرات كتابة النصوص المجانية المتبقية اليوم',
  },
  '下次重置：': { en: 'Next reset:', ar: 'إعادة التعيين التالية:' },
  '免费次数按工作空间统计，提交即消耗，失败不返还；供应商仍可能收费。': {
    en: 'Free uses are counted per workspace and consumed on submission, with no refund on failure. The provider may still charge.',
    ar: 'تُحتسب الاستخدامات المجانية لكل مساحة عمل وتُستهلك عند الإرسال، ولا تُسترد عند الفشل. وقد يفرض المزوّد رسومًا.',
  },
  生成设计方案: { en: 'Generate design plan', ar: 'إنشاء خطة تصميم' },
  '该任务没有可导入的结构化文字区域。': {
    en: 'This task has no structured text regions to import.',
    ar: 'لا تتضمن هذه المهمة مناطق نصية منظّمة قابلة للاستيراد.',
  },
  当前暂无已连接的适配能力: {
    en: 'No connected adapter is currently available',
    ar: 'لا يتوفر حاليًا محوّل خدمة متصل',
  },
  预计输出尺寸: { en: 'Estimated output dimensions', ar: 'الأبعاد المتوقعة للمخرجات' },
  选择源视频后显示: {
    en: 'Shown after selecting a source video',
    ar: 'تظهر بعد اختيار فيديو المصدر',
  },
  原文字: { en: 'Original text', ar: 'النص الأصلي' },
  '已达到素材数量上限，请先移除部分素材。': {
    en: 'Asset limit reached. Remove some assets first.',
    ar: 'بلغت الحد الأقصى للمواد. أزل بعض المواد أولًا.',
  },
  '部分文件不符合当前素材类型，已跳过。': {
    en: 'Some files did not match the required asset type and were skipped.',
    ar: 'تم تخطي بعض الملفات لأنها لا تطابق نوع المادة المطلوب.',
  },
  '拖入文件，或聚焦这里粘贴图片': {
    en: 'Drop files, or focus here to paste an image',
    ar: 'اسحب الملفات هنا، أو ركّز هذا الحقل للصق صورة',
  },
  已保存: { en: 'Saved', ar: 'تم الحفظ' },
  '正在校验并保存…': { en: 'Validating and saving…', ar: 'جارٍ التحقق والحفظ…' },
  上传进度: { en: 'Upload progress', ar: 'تقدم الرفع' },
  团队席位: { en: 'Team seats', ar: 'مقاعد الفريق' },
  'API 密钥': { en: 'API keys', ar: 'مفاتيح API' },
  当前空间权益: { en: 'Current workspace entitlements', ar: 'استحقاقات مساحة العمل الحالية' },
  有效订阅权益: { en: 'Active subscription entitlements', ar: 'استحقاقات الاشتراك الساري' },
  基础权益: { en: 'Basic entitlements', ar: 'الاستحقاقات الأساسية' },
  '已用 / 上限': { en: 'Used / limit', ar: 'المستخدم / الحد' },
  并发任务上限: { en: 'Concurrent task limit', ar: 'حد المهام المتزامنة' },
  '权益限制在创建资源和提交任务时检查；已有资源不会因额度调整而被删除。': {
    en: 'Limits are checked when creating resources and submitting tasks. Existing resources are not deleted when limits change.',
    ar: 'تُفحص الحدود عند إنشاء الموارد وإرسال المهام. ولا تُحذف الموارد الحالية عند تغيير الحدود.',
  },
  每日文案免费次数: {
    en: 'Daily free copywriting uses',
    ar: 'الاستخدامات اليومية المجانية لكتابة النصوص',
  },
  '按 UTC 日期与工作空间统计，成功提交即消耗次数，失败不会返还。它不等同于余额，也不代表供应商免费。':
    {
      en: 'Counted per workspace by UTC date. A successful submission consumes a use, with no refund on failure. This is separate from your balance and does not make the provider free.',
      ar: 'تُحتسب لكل مساحة عمل وفق تاريخ UTC. يستهلك الإرسال الناجح استخدامًا ولا يُسترد عند الفشل. وهي منفصلة عن الرصيد ولا تعني أن خدمة المزوّد مجانية.',
    },
  '请先涂画需要重绘的区域，空遮罩不能提交。': {
    en: 'Paint the area to redraw first. An empty mask cannot be submitted.',
    ar: 'لوّن المنطقة المطلوب إعادة رسمها أولًا. لا يمكن إرسال قناع فارغ.',
  },
  画笔大小: { en: 'Brush size', ar: 'حجم الفرشاة' },
  '文字与框选区域为模型识别建议，坐标按原图像素记录。提交改字前请核对内容和位置。': {
    en: 'Text and boxes are model suggestions, with coordinates in original-image pixels. Check the content and position before replacing text.',
    ar: 'النصوص والمربعات اقتراحات من النموذج، وإحداثياتها ببكسلات الصورة الأصلية. تحقّق من المحتوى والموضع قبل استبدال النص.',
  },
  选择文字区域: { en: 'Select text region', ar: 'اختيار منطقة النص' },
  空文字区域: { en: 'Empty text region', ar: 'منطقة نص فارغة' },
  用所选区域创建改字草稿: {
    en: 'Create a text-edit draft from the selected region',
    ar: 'إنشاء مسودة تعديل نص من المنطقة المحددة',
  },
  任务结果已打包下载: {
    en: 'Task results downloaded as an archive',
    ar: 'تم تنزيل نتائج المهمة في أرشيف',
  },
  打包下载结果与参数: {
    en: 'Download results and parameters as an archive',
    ar: 'تنزيل النتائج والمعلمات في أرشيف',
  },
  已恢复历史记录: { en: 'History restored', ar: 'تمت استعادة السجل' },
  历史记录已归档: { en: 'History archived', ar: 'تمت أرشفة السجل' },
  恢复历史记录: { en: 'Restore history', ar: 'استعادة السجل' },
  归档历史记录: { en: 'Archive history', ar: 'أرشفة السجل' },
  筛选历史记录: { en: 'Filter history', ar: 'تصفية السجل' },
  搜索任务: { en: 'Search tasks', ar: 'البحث عن مهام' },
  任务状态: { en: 'Task status', ar: 'حالة المهمة' },
  处理类型: { en: 'Processing type', ar: 'نوع المعالجة' },
  全部项目: { en: 'All projects', ar: 'جميع المشاريع' },
  创建成员: { en: 'Created by', ar: 'أنشأه' },
  我的历史: { en: 'My history', ar: 'سجلي' },
  下载状态: { en: 'Download status', ar: 'حالة التنزيل' },
  已下载: { en: 'Downloaded', ar: 'تم التنزيل' },
  未下载: { en: 'Not downloaded', ar: 'لم يُنزَّل' },
  查看已归档记录: { en: 'View archived records', ar: 'عرض السجلات المؤرشفة' },
  '归档只隐藏自己的历史记录，不删除作品或额度账本。': {
    en: 'Archiving hides only your history. It does not delete creations or the credit ledger.',
    ar: 'تخفي الأرشفة سجلك فقط، ولا تحذف الأعمال أو دفتر الرصيد.',
  },
  打包下载所选结果: {
    en: 'Download selected results as an archive',
    ar: 'تنزيل النتائج المحددة في أرشيف',
  },
  选择此任务: { en: 'Select this task', ar: 'اختيار هذه المهمة' },
  '实际图层结果（按层级顺序）': {
    en: 'Actual layer results (in layer order)',
    ar: 'نتائج الطبقات الفعلية (بترتيب الطبقات)',
  },
  '请先选择可见图层。': { en: 'Select visible layers first.', ar: 'اختر طبقات مرئية أولًا.' },
  导出范围: { en: 'Export scope', ar: 'نطاق التصدير' },
  整张画布: { en: 'Entire canvas', ar: 'اللوحة كاملة' },
  '选中图层（裁切边界）': {
    en: 'Selected layers (crop to bounds)',
    ar: 'الطبقات المحددة (الاقتصاص إلى الحدود)',
  },
  '选中图层分别打包 ZIP': {
    en: 'Export selected layers individually in ZIP',
    ar: 'تصدير الطبقات المحددة منفصلة في ZIP',
  },
  '多画板打包 ZIP': { en: 'Export multiple artboards in ZIP', ar: 'تصدير عدة لوحات في ZIP' },
  按各选区或画板的实际像素导出: {
    en: "Export at each selection's or artboard's actual pixel dimensions",
    ar: 'التصدير بأبعاد البكسل الفعلية لكل منطقة أو لوحة',
  },
  '包含 AI 来源记录与可用参数（ZIP）': {
    en: 'Include AI source records and available parameters (ZIP)',
    ar: 'تضمين سجلات مصدر الذكاء الاصطناعي والمعلمات المتاحة (ZIP)',
  },
  '来源信息写入 manifest.json，仅包含已有记录；不向图片伪造嵌入式 AI 元信息。': {
    en: 'Source details are saved in manifest.json using existing records only. No embedded AI metadata is fabricated in images.',
    ar: 'تُحفظ تفاصيل المصدر في manifest.json اعتمادًا على السجلات الموجودة فقط. ولا تُضاف بيانات ذكاء اصطناعي مضمّنة مختلقة إلى الصور.',
  },
  '分享仅提供视频缩略图，未授权原件播放。': {
    en: 'This share provides only a video thumbnail. Original playback is not authorized.',
    ar: 'توفر هذه المشاركة صورة مصغرة للفيديو فقط. تشغيل الأصل غير مصرّح به.',
  },
  '每次打包需要1–20个画板或图层。': {
    en: 'Each archive requires 1–20 artboards or layers.',
    ar: 'يتطلب كل أرشيف من 1 إلى 20 لوحة أو طبقة.',
  },
  '打包总像素超过上限，请减少画板或降低倍率。': {
    en: 'The archive exceeds the total pixel limit. Use fewer artboards or a lower scale.',
    ar: 'يتجاوز الأرشيف حد البكسلات الإجمالي. قلّل عدد اللوحات أو معامل التكبير.',
  },
  '打包内容超过150MB，请分批导出。': {
    en: 'The archive contents exceed 150 MB. Export in smaller batches.',
    ar: 'يتجاوز محتوى الأرشيف 150 ميغابايت. صدّر على دفعات أصغر.',
  },
  '来源记录过大，请关闭来源参数导出。': {
    en: 'Source records are too large. Turn off source-parameter export.',
    ar: 'سجلات المصدر كبيرة جدًا. أوقف تصدير معلمات المصدر.',
  },
  '导出倍率无效。': { en: 'Invalid export scale.', ar: 'معامل التصدير غير صالح.' },
  '原件下载未授权，不能导出原始画布。': {
    en: 'Original download is not authorized, so the original canvas cannot be exported.',
    ar: 'تنزيل الأصل غير مصرّح به، لذا لا يمكن تصدير اللوحة الأصلية.',
  },
  '素材上传未完成，请重试。': {
    en: 'The asset upload did not complete. Please retry.',
    ar: 'لم يكتمل رفع المادة. يُرجى المحاولة مجددًا.',
  },
  '上传连接中断，请重试。': {
    en: 'The upload connection was interrupted. Please retry.',
    ar: 'انقطع اتصال الرفع. يُرجى المحاولة مجددًا.',
  },
  '上传已取消。': { en: 'Upload cancelled.', ar: 'تم إلغاء الرفع.' },
  '素材上传超时，请重试。': {
    en: 'The asset upload timed out. Please retry.',
    ar: 'انتهت مهلة رفع المادة. يُرجى المحاولة مجددًا.',
  },
  '文件下载失败，请稍后重试。': {
    en: 'File download failed. Please try again later.',
    ar: 'فشل تنزيل الملف. يُرجى المحاولة لاحقًا.',
  },
  以此形象创作: { en: 'Create with this character', ar: 'إنشاء عمل بهذه الشخصية' },
  '请先在人物资料中登记有效的参考使用授权。': {
    en: 'First record a valid reference-use authorization in the character profile.',
    ar: 'سجّل أولًا تفويضًا صالحًا لاستخدام المرجع في ملف الشخصية.',
  },
  原始文件压缩包已下载: {
    en: 'Original-file archive downloaded',
    ar: 'تم تنزيل أرشيف الملفات الأصلية',
  },
  打包下载原件: { en: 'Download originals as an archive', ar: 'تنزيل الملفات الأصلية في أرشيف' },
  '此链接只提供预览，原件下载已关闭；预览仍可能被截图或保存。': {
    en: 'This link offers previews only; original downloads are disabled. Previews may still be captured or saved.',
    ar: 'يوفر هذا الرابط معاينات فقط؛ تنزيل الأصول معطّل. وقد تظل المعاينات قابلة للالتقاط أو الحفظ.',
  },
  '部分素材没有可用预览，且未授权下载原件，因此无法播放或显示。': {
    en: 'Some assets have no preview and original access is not authorized, so they cannot be played or displayed.',
    ar: 'بعض المواد بلا معاينة متاحة، والوصول إلى أصولها غير مصرّح به؛ لذلك يتعذر تشغيلها أو عرضها.',
  },
  审核结果: { en: 'Review result', ar: 'نتيجة المراجعة' },
  已通过: { en: 'Approved', ar: 'تمت الموافقة' },
  已返还额度: { en: 'Credits refunded', ar: 'تم ردّ الرصيد' },
  '关闭原件下载不会阻止截图或保存预览。': {
    en: 'Disabling original downloads does not prevent screenshots or saving previews.',
    ar: 'تعطيل تنزيل الأصول لا يمنع لقطات الشاشة أو حفظ المعاينات.',
  },
  允许下载原件: { en: 'Allow original downloads', ar: 'السماح بتنزيل الأصول' },
  仅预览: { en: 'Preview only', ar: 'معاينة فقط' },
  使用同一图片作为首尾帧: {
    en: 'Use the same image for both end frames',
    ar: 'استخدام الصورة نفسها للإطارين الأول والأخير',
  },
  未声明授权: { en: 'Authorization not declared', ar: 'لم يُصرَّح بالتفويض' },
  已声明参考授权: { en: 'Reference authorization declared', ar: 'تم التصريح بتفويض المرجع' },
  授权已撤回: { en: 'Authorization withdrawn', ar: 'تم سحب التفويض' },
  '参考素材已更新，需重新声明': {
    en: 'References changed; a new declaration is required',
    ar: 'تغيّرت المراجع؛ يلزم تصريح جديد',
  },
  人物参考授权: { en: 'Character reference authorization', ar: 'تفويض مرجع الشخصية' },
  '这是对当前参考素材使用权的自述声明，只用于普通人物参考，不等同于实名认证、活体检测或身份核验。':
    {
      en: 'This is a self-declaration of your right to use the current references for ordinary character reference. It is not identity verification or a liveness check.',
      ar: 'هذا تصريح ذاتي بحقك في استخدام المراجع الحالية كمرجع عادي للشخصية. ولا يُعدّ تحققًا من الهوية أو فحصًا للحيوية.',
    },
  参考素材版本: { en: 'Reference version', ar: 'إصدار المرجع' },
  声明版本: { en: 'Declaration version', ar: 'إصدار التصريح' },
  声明时间: { en: 'Declared at', ar: 'وقت التصريح' },
  撤回参考授权: { en: 'Withdraw reference authorization', ar: 'سحب تفويض المرجع' },
  你与人物的关系: { en: 'Your relationship to the person', ar: 'علاقتك بالشخص' },
  人物为本人: { en: 'This person is me', ar: 'أنا هذا الشخص' },
  我已获得本人授权: { en: "I have this person's authorization", ar: 'لديّ تفويض من هذا الشخص' },
  '我确认有权将当前参考素材用于创作，已获得素材中人物所需的授权，并了解这项声明不代表身份认证。': {
    en: 'I confirm that I may use these references to create content, have the required permission from the people shown, and understand that this declaration is not identity verification.',
    ar: 'أؤكد أن لديّ الحق في استخدام هذه المراجع لإنشاء المحتوى، وأنني حصلت على التفويض المطلوب من الأشخاص الظاهرين، وأفهم أن هذا التصريح ليس تحققًا من الهوية.',
  },
  参考授权声明已保存: {
    en: 'Reference authorization declaration saved',
    ar: 'تم حفظ تصريح تفويض المرجع',
  },
  保存授权声明: { en: 'Save authorization declaration', ar: 'حفظ تصريح التفويض' },
  身份核验: { en: 'Identity verification', ar: 'التحقق من الهوية' },
  '身份核验需要单独的服务与有效核验记录。参考授权不会把人物标记为已认证。': {
    en: 'Identity verification requires a separate service and a valid verification record. Reference authorization does not mark the person as verified.',
    ar: 'يتطلب التحقق من الهوية خدمة مستقلة وسجل تحقق صالحًا. ولا يجعل تفويض المرجع الشخص موثّق الهوية.',
  },
  开始身份核验: { en: 'Start identity verification', ar: 'بدء التحقق من الهوية' },
  身份核验服务未连接: {
    en: 'Identity verification service not connected',
    ar: 'خدمة التحقق من الهوية غير متصلة',
  },
  撤回人物参考授权: {
    en: 'Withdraw character reference authorization',
    ar: 'سحب تفويض مرجع الشخصية',
  },
  '撤回记录会保留。此操作不会删除已有作品或原始素材。': {
    en: 'The withdrawal record will be retained. Existing creations and original assets will remain.',
    ar: 'سيُحتفَظ بسجل السحب. وستبقى الأعمال الحالية والمواد الأصلية.',
  },
  撤回原因: { en: 'Reason for withdrawal', ar: 'سبب السحب' },
  参考授权已撤回: { en: 'Reference authorization withdrawn', ar: 'تم سحب تفويض المرجع' },
  确认撤回: { en: 'Confirm withdrawal', ar: 'تأكيد السحب' },
  选择引用素材: { en: 'Choose a reference asset', ar: 'اختيار مادة مرجعية' },
  '先添加参考素材，再输入 @ 选择引用。': {
    en: 'Add reference assets, then type @ to cite one.',
    ar: 'أضف مواد مرجعية، ثم اكتب @ لاختيار مرجع.',
  },
  引用素材: { en: 'Reference asset', ar: 'مادة مرجعية' },
  首帧: { en: 'First frame', ar: 'الإطار الأول' },
  尾帧: { en: 'Last frame', ar: 'الإطار الأخير' },
  '首帧与尾帧（按顺序）': {
    en: 'First and last frames (in order)',
    ar: 'الإطاران الأول والأخير (بالترتيب)',
  },
  视频创作参考素材: { en: 'Video generation references', ar: 'مراجع إنشاء الفيديو' },
  交换首尾帧: { en: 'Swap first and last frames', ar: 'تبديل الإطارين الأول والأخير' },
  '额外参考素材（可选）': { en: 'Additional references (optional)', ar: 'مراجع إضافية (اختياري)' },
  '首帧与尾帧必须是两张图片，并按先后顺序排列。': {
    en: 'Provide two images in order: first frame, then last frame.',
    ar: 'أضف صورتين بالترتيب: الإطار الأول ثم الإطار الأخير.',
  },
  '参考模式需要 1–7 份素材。': {
    en: 'Reference mode requires 1–7 assets.',
    ar: 'يتطلب وضع المراجع من مادة واحدة إلى 7 مواد.',
  },
  '图片宽高至少 300px，比例 0.4–2.5。提示词最多 2100 字符。': {
    en: 'Images must be at least 300px in both dimensions, with a 0.4–2.5 aspect ratio. Prompts allow up to 2100 characters.',
    ar: 'يجب ألا يقل بُعدا الصورة عن 300 بكسل، وبنسبة أبعاد من 0.4 إلى 2.5. الحد الأقصى للوصف 2100 حرف.',
  },
  '最多参考一个视频，3–10 秒、720–2160px、24–60fps。': {
    en: 'Use at most one reference video: 3–10 seconds, 720–2160px in both dimensions, and 24–60 fps.',
    ar: 'استخدم فيديو مرجعيًا واحدًا على الأكثر: من 3 إلى 10 ثوانٍ، ومن 720 إلى 2160 بكسل في كلا البُعدين، ومن 24 إلى 60 إطارًا في الثانية.',
  },
  '请按当前视频模型要求调整参考素材数量、类型或提示词长度。': {
    en: "Adjust the number and type of references or the prompt length to meet this video model's requirements.",
    ar: 'عدّل عدد المراجع ونوعها أو طول الوصف وفق متطلبات نموذج الفيديو الحالي.',
  },
  '移除素材与引用？': { en: 'Remove assets and citations?', ar: 'إزالة المواد والإشارات إليها؟' },
  '创作需求正在引用这些素材。确认后将同时移除素材和对应的 @ 引用，其他文案保持不变。': {
    en: 'Your prompt cites these assets. Confirming removes the assets and their @ citations while keeping the rest of your text.',
    ar: 'يشير وصفك إلى هذه المواد. سيؤدي التأكيد إلى إزالة المواد وإشارات @ المقابلة مع إبقاء بقية النص.',
  },
  已归因注册: { en: 'Attributed signups', ar: 'تسجيلات منسوبة للإحالة' },
  '推荐链接可用于注册归因，是否获得奖励以实际规则和付款核验为准。': {
    en: 'Referral links can attribute signups. Rewards depend on the applicable rules and verified payments.',
    ar: 'يمكن لروابط الإحالة إسناد التسجيلات. وتعتمد المكافآت على القواعد المعمول بها والتحقق من الدفع.',
  },
  '自由注册尚未开放。推荐链接不会绕过注册规则，有效团队邀请仍可用于注册。': {
    en: 'Open registration is not available. Referral links do not bypass registration rules; valid team invitations can still be used to register.',
    ar: 'التسجيل المفتوح غير متاح. لا تتجاوز روابط الإحالة قواعد التسجيل؛ ويمكن استخدام دعوات الفريق الصالحة للتسجيل.',
  },
  奖励条件: { en: 'Reward conditions', ar: 'شروط المكافأة' },
  自动返奖尚未就绪: { en: 'Automatic rewards are not ready', ar: 'المكافآت التلقائية غير جاهزة' },
  该版本未启用奖励: {
    en: 'Rewards are disabled for this version',
    ar: 'المكافآت غير مفعلة لهذا الإصدار',
  },
  每位被邀请人首次达标奖励一次: {
    en: 'One reward per invitee on their first qualifying payment',
    ar: 'مكافأة واحدة لكل مدعو عند أول دفعة مؤهلة',
  },
  计入邀请人的个人空间: {
    en: 'Credited to the referrer’s personal workspace',
    ar: 'تضاف إلى المساحة الشخصية للداعي',
  },
  '注册后30天内首次购买个人会员：邀请人获得套餐算力15%，被邀请人获得10%。奖励发放后7天有效，分别计入双方个人空间。':
    {
      en: 'First personal membership purchase within 30 days of signup: the referrer receives 15% of the package credits and the invitee 10%. Each reward goes to the recipient’s personal workspace and expires 7 days after issue.',
      ar: 'عند أول شراء لعضوية شخصية خلال 30 يومًا من التسجيل، يحصل الداعي على 15٪ من رصيد الباقة والمدعو على 10٪. تضاف المكافآت إلى المساحتين الشخصيتين وتنتهي بعد 7 أيام من الإصدار.',
    },
  '算力包、团队订阅、接口充值和测试付款不参与；退款按比例冲回奖励。': {
    en: 'Credit packs, team subscriptions, API top-ups and test payments are excluded. Refunds reverse rewards proportionally.',
    ar: 'لا تشمل المكافآت حزم الرصيد واشتراكات الفرق وشحن الواجهة ومدفوعات الاختبار. تسترد المكافآت نسبيًا عند رد الأموال.',
  },
  本部署已确认规则: {
    en: 'Confirmed rules for this installation',
    ar: 'القواعد المؤكدة لهذا التثبيت',
  },
  向下取整: { en: 'Round down', ar: 'التقريب للأسفل' },
  向上取整: { en: 'Round up', ar: 'التقريب للأعلى' },
  四舍五入: { en: 'Round to nearest integer', ar: 'التقريب لأقرب عدد صحيح' },
  不额外要求会员身份: { en: 'No additional membership requirement', ar: 'لا يشترط اشتراك إضافي' },
  付款时邀请人须为有效个人会员: {
    en: 'Referrer must have an active personal membership at payment',
    ar: 'يجب أن يكون للداعي اشتراك شخصي نشط عند الدفع',
  },
  付款时被邀请人须为有效个人会员: {
    en: 'Invitee must have an active personal membership at payment',
    ar: 'يجب أن يكون للمدعو اشتراك شخصي نشط عند الدفع',
  },
  付款时双方须为有效个人会员: {
    en: 'Both must have active personal memberships at payment',
    ar: 'يجب أن يكون لكليهما اشتراك شخصي نشط عند الدفع',
  },
  当前新注册适用规则: {
    en: 'Current rules for new signups',
    ar: 'القواعد الحالية للتسجيلات الجديدة',
  },
  '历史邀请按注册时保存的规则结算，不随当前规则更新；累计奖励不等于当前可用余额。': {
    en: 'Past referrals use the rules saved at signup. Later changes do not alter them. Cumulative rewards are not the currently available balance.',
    ar: 'تستخدم الإحالات السابقة القواعد المحفوظة عند التسجيل ولا تغيرها التحديثات اللاحقة. المكافآت التراكمية ليست الرصيد المتاح حاليًا.',
  },
  注册时适用规则: { en: 'Rules at signup', ar: 'القواعد عند التسجيل' },
  待配置或核对: { en: 'Awaiting configuration or review', ar: 'بانتظار الإعداد أو المراجعة' },
  规则版本: { en: 'Rule version', ar: 'إصدار القواعد' },
  邀请人: { en: 'Referrer', ar: 'الداعي' },
  被邀请人: { en: 'Invitee', ar: 'المدعو' },
  最低已支付金额: { en: 'Minimum paid amount', ar: 'الحد الأدنى للمبلغ المدفوع' },
  每次符合条件奖励: {
    en: 'Reward per qualifying referral',
    ar: 'المكافأة لكل إحالة مستوفية للشروط',
  },
  '推荐奖励未启用，当前只保留注册归因，不承诺现金或额度奖励。': {
    en: 'Referral rewards are disabled. Signup attribution is retained, with no promise of cash or credit rewards.',
    ar: 'مكافآت الإحالة غير مفعّلة. يُحتفَظ بإسناد التسجيلات دون وعد بمكافآت نقدية أو رصيد.',
  },
  推荐记录: { en: 'Referral history', ar: 'سجل الإحالات' },
  注册时间: { en: 'Signed up at', ar: 'وقت التسجيل' },
  达成条件: { en: 'Qualification', ar: 'استيفاء الشروط' },
  奖励额度: { en: 'Reward credits', ar: 'رصيد المكافأة' },
  已冲回额度: { en: 'Reversed credits', ar: 'الرصيد المسترد' },
  已达成: { en: 'Qualified', ar: 'مستوفٍ للشروط' },
  未达成: { en: 'Not qualified', ar: 'غير مستوفٍ للشروط' },
  暂无推荐注册记录: { en: 'No referred signups yet', ar: 'لا توجد تسجيلات بالإحالة بعد' },
  渠道概览: { en: 'Channel overview', ar: 'نظرة عامة على القناة' },
  渠道报表已下载: { en: 'Channel report downloaded', ar: 'تم تنزيل تقرير القناة' },
  导出渠道报表: { en: 'Export channel report', ar: 'تصدير تقرير القناة' },
  已付款订单: { en: 'Paid orders', ar: 'الطلبات المدفوعة' },
  已付款金额: { en: 'Paid amount', ar: 'المبلغ المدفوع' },
  新增灵感: { en: 'Add inspiration', ar: 'إضافة إلهام' },
  灵感类型: { en: 'Inspiration type', ar: 'نوع الإلهام' },
  所有类型: { en: 'All types', ar: 'كل الأنواع' },
  所有平台: { en: 'All platforms', ar: 'كل المنصات' },
  包含已下架: { en: 'Include unpublished items', ar: 'تضمين العناصر غير المنشورة' },
  素材已不可用: { en: 'Asset no longer available', ar: 'المادة لم تعد متاحة' },
  视频灵感: { en: 'Video inspiration', ar: 'إلهام الفيديو' },
  已下架: { en: 'Unpublished', ar: 'غير منشور' },
  '原素材已删除，请联系空间管理员。': {
    en: 'The original asset was deleted. Contact a workspace administrator.',
    ar: 'حُذفت المادة الأصلية. تواصل مع مسؤول مساحة العمل.',
  },
  重新上架: { en: 'Publish again', ar: 'إعادة النشر' },
  下架灵感: { en: 'Unpublish inspiration', ar: 'إلغاء نشر الإلهام' },
  '仅在当前工作空间展示，请使用拥有使用权的图片或视频。': {
    en: 'Visible only in this workspace. Use images or videos you have the right to use.',
    ar: 'تظهر في مساحة العمل الحالية فقط. استخدم صورًا أو فيديوهات تملك حق استخدامها.',
  },
  灵感标题: { en: 'Inspiration title', ar: 'عنوان الإلهام' },
  行业分类: { en: 'Industry category', ar: 'تصنيف القطاع' },
  主题标签: { en: 'Topic tags', ar: 'وسوم الموضوع' },
  素材来源与使用权说明: { en: 'Asset source and usage rights', ar: 'مصدر المادة وحقوق استخدامها' },
  灵感素材: { en: 'Inspiration asset', ar: 'مادة الإلهام' },
  保存灵感: { en: 'Save inspiration', ar: 'حفظ الإلهام' },
  '当前暂未开放自由注册。推荐链接不会绕过注册或团队邀请规则。': {
    en: 'Open registration is currently unavailable. Referral links do not bypass registration or team invitation rules.',
    ar: 'التسجيل المفتوح غير متاح حاليًا. لا تتجاوز روابط الإحالة قواعد التسجيل أو دعوات الفريق.',
  },
  '已登记申请，未发送': { en: 'Request recorded, not sent', ar: 'تم تسجيل الطلب ولم يُرسل' },
  已撤回: { en: 'Withdrawn', ar: 'مسحوب' },
  退款后需重新核对: { en: 'Review required after refund', ar: 'يلزم التدقيق مجددًا بعد الاسترداد' },
  查看申请: { en: 'View request', ar: 'عرض الطلب' },
  '申请已登记，尚未发送至开票服务': {
    en: 'Request recorded; not yet sent to an invoicing service',
    ar: 'تم تسجيل الطلب ولم يُرسل إلى خدمة الفواتير بعد',
  },
  登记开票申请: { en: 'Record invoice request', ar: 'تسجيل طلب فاتورة' },
  '仅已支付且有可申请余额的订单可以登记申请。服务未连接时不会发送开票请求或生成正式发票。': {
    en: 'Requests can be recorded only for paid orders with an eligible remaining amount. Without a connected service, no invoice request is sent and no official invoice is issued.',
    ar: 'يمكن تسجيل الطلبات للطلبات المدفوعة التي لها مبلغ متبقٍ مؤهل فقط. دون خدمة متصلة، لا يُرسل طلب فاتورة ولا تصدر فاتورة رسمية.',
  },
  编辑抬头: { en: 'Edit billing details', ar: 'تعديل بيانات الفوترة' },
  开票申请详情: { en: 'Invoice request details', ar: 'تفاصيل طلب الفاتورة' },
  申请金额: { en: 'Requested amount', ar: 'المبلغ المطلوب' },
  发送状态: { en: 'Delivery status', ar: 'حالة الإرسال' },
  未发送: { en: 'Not sent', ar: 'لم يُرسل' },
  '当前没有接通正式开票服务。记录仅为本地申请，不代表已发送或已开具发票。': {
    en: 'No official invoicing service is connected. This is a local request record, not confirmation of submission or an issued invoice.',
    ar: 'لا توجد خدمة فواتير رسمية متصلة. هذا سجل طلب محلي ولا يؤكد إرسال الطلب أو إصدار فاتورة.',
  },
  申请记录: { en: 'Request history', ar: 'سجل الطلبات' },
  创建申请: { en: 'Create request', ar: 'إنشاء طلب' },
  登记申请: { en: 'Record request', ar: 'تسجيل الطلب' },
  撤回申请: { en: 'Withdraw request', ar: 'سحب الطلب' },
  退款后核对: { en: 'Review after refund', ar: 'مراجعة بعد الاسترداد' },
  撤回开票申请: { en: 'Withdraw invoice request', ar: 'سحب طلب الفاتورة' },
  '撤回后释放可申请金额，申请及撤回记录仍然保留。': {
    en: 'Withdrawing releases the amount for another request. The original request and withdrawal records are retained.',
    ar: 'يتيح السحب المبلغ لطلب آخر. ويُحتفَظ بسجلي الطلب الأصلي والسحب.',
  },
  申请已撤回: { en: 'Request withdrawn', ar: 'تم سحب الطلب' },
  编辑发票抬头: { en: 'Edit invoice billing details', ar: 'تعديل بيانات الفاتورة' },
  'Kling O1 · 首尾帧': {
    en: 'Kling O1 · First & last frames',
    ar: 'Kling O1 · الإطاران الأول والأخير',
  },
  'Kling O1 · 多图参考': {
    en: 'Kling O1 · Multiple image references',
    ar: 'Kling O1 · مراجع صور متعددة',
  },
  'Kling O3 · 4K 多模态参考': {
    en: 'Kling O3 · 4K multimodal references',
    ar: 'Kling O3 · مراجع متعددة الوسائط بدقة 4K',
  },
  '保存后再离开？': {
    en: 'Save before leaving?',
    ar: 'الحفظ قبل المغادرة؟',
  },
  '画布有尚未保存的修改，可以保存后继续，或保留当前页面。': {
    en: 'The canvas has unsaved changes. Save to continue, or stay on this page.',
    ar: 'توجد تغييرات غير محفوظة على اللوحة. احفظها للمتابعة أو ابقَ في هذه الصفحة.',
  },
  放弃修改并离开: {
    en: 'Discard changes and leave',
    ar: 'تجاهل التغييرات والمغادرة',
  },
  保存并离开: {
    en: 'Save and leave',
    ar: 'حفظ ومغادرة',
  },
  '正在确认支付，请以订单状态为准。': {
    en: 'Confirming payment. Check the order status for the final outcome.',
    ar: 'جارٍ تأكيد الدفع. راجع حالة الطلب لمعرفة النتيجة النهائية.',
  },
  '已返回工作空间，订单是否支付以实际状态为准。': {
    en: 'Back in your workspace. The actual order status determines whether payment completed.',
    ar: 'عدت إلى مساحة العمل. تحدد حالة الطلب الفعلية ما إذا كان الدفع قد اكتمل.',
  },
  创作完成: {
    en: 'Creation completed',
    ar: 'اكتمل الإنشاء',
  },
  等待处理: {
    en: 'Waiting to process',
    ar: 'بانتظار المعالجة',
  },
  撤销编辑: { en: 'Undo', ar: 'تراجع' },
  此页面暂时无法显示: {
    en: 'This page is temporarily unavailable',
    ar: 'هذه الصفحة غير متاحة مؤقتًا',
  },
  '你的已保存内容仍然保留。请重新打开页面，或把问题反馈给管理员。': {
    en: 'Your saved content is safe. Reopen this page or report the issue to an administrator.',
    ar: 'لا يزال محتواك المحفوظ موجودًا. أعد فتح الصفحة أو أبلغ المسؤول بالمشكلة.',
  },
  重新加载: {
    en: 'Reload',
    ar: 'إعادة التحميل',
  },
  这个页面暂不存在: {
    en: 'This page does not exist',
    ar: 'هذه الصفحة غير موجودة',
  },
  回到灵感广场: {
    en: 'Back to Inspiration',
    ar: 'العودة إلى الإلهام',
  },
  'AI 创作助手': {
    en: 'AI creative assistant',
    ar: 'مساعد الإبداع بالذكاء الاصطناعي',
  },
  '完善需求、组织画面细节或起草创意方案。生成前会明确确认报价。': {
    en: 'Refine your brief, plan visual details, or draft a concept. You will confirm the quote before generation.',
    ar: 'حسّن طلبك ونظّم تفاصيل المشهد أو اكتب فكرة إبداعية. ستؤكد السعر قبل التوليد.',
  },
  你的需求: {
    en: 'Your brief',
    ar: 'طلبك',
  },
  '例如：帮我把这份需求整理成一个清晰、可执行的产品主图创作提示词…': {
    en: 'For example: turn this brief into a clear, actionable prompt for a product hero image…',
    ar: 'مثال: حوّل هذا الطلب إلى وصف واضح وقابل للتنفيذ لصورة منتج رئيسية…',
  },
  文案服务: {
    en: 'Writing service',
    ar: 'خدمة الكتابة',
  },
  '（未连接）': {
    en: '(Not connected)',
    ar: '(غير متصل)',
  },
  同时参考当前选择的: {
    en: 'Also using the selected ',
    ar: 'استخدام المواد المحددة وعددها ',
  },
  '份素材。': {
    en: ' assets.',
    ar: ' مواد.',
  },
  生成创作建议: {
    en: 'Generate creative suggestions',
    ar: 'توليد اقتراحات إبداعية',
  },
  真实生成建议: {
    en: 'Generated suggestions',
    ar: 'الاقتراحات المولّدة',
  },
  建议已复制: {
    en: 'Suggestion copied',
    ar: 'تم نسخ الاقتراح',
  },
  复制: {
    en: 'Copy',
    ar: 'نسخ',
  },
  采用这份建议: {
    en: 'Use this suggestion',
    ar: 'استخدام هذا الاقتراح',
  },
  图片文字识别: {
    en: 'Image text recognition',
    ar: 'التعرّف على نص الصورة',
  },
  '读取图片中的文字，保留真实识别结果': {
    en: 'Extract the actual text recognized in an image',
    ar: 'استخراج النص الذي يتم التعرّف عليه في الصورة',
  },
  图片改字: {
    en: 'Edit image text',
    ar: 'تعديل نص الصورة',
  },
  '替换指定文字与区域，保留画面风格': {
    en: 'Replace selected text and regions while preserving the visual style',
    ar: 'استبدال النص والمناطق المحددة مع الحفاظ على الأسلوب البصري',
  },
  图层拆分: {
    en: 'Split into layers',
    ar: 'تقسيم إلى طبقات',
  },
  将图片拆解成可独立使用的元素: {
    en: 'Separate an image into independently usable elements',
    ar: 'فصل الصورة إلى عناصر يمكن استخدامها بشكل مستقل',
  },
  视频延长: {
    en: 'Extend video',
    ar: 'تمديد الفيديو',
  },
  从已有片段继续生成后续内容: {
    en: 'Generate what comes next from an existing clip',
    ar: 'توليد تتمة لمقطع موجود',
  },
  视频编辑: {
    en: 'Edit video',
    ar: 'تعديل الفيديو',
  },
  按描述调整视频画面与场景: {
    en: 'Adjust video visuals and scenes using a description',
    ar: 'تعديل مشاهد الفيديو ومظهره باستخدام وصف',
  },
  视频超分: {
    en: 'Video upscaling',
    ar: 'رفع دقة الفيديو',
  },
  改善原视频分辨率与清晰度: {
    en: 'Improve the resolution and clarity of the original video',
    ar: 'تحسين دقة الفيديو الأصلي ووضوحه',
  },
  视频去字幕: {
    en: 'Remove video subtitles',
    ar: 'إزالة الترجمة من الفيديو',
  },
  处理画面中原有的字幕区域: {
    en: 'Process existing subtitle regions in the video',
    ar: 'معالجة مناطق الترجمة الموجودة في الفيديو',
  },
  视频翻译: {
    en: 'Translate video',
    ar: 'ترجمة الفيديو',
  },
  将视频中的语言转换为目标语言: {
    en: 'Convert the language in a video to the target language',
    ar: 'تحويل لغة الفيديو إلى اللغة المستهدفة',
  },
  进阶工作流: {
    en: 'Advanced workflows',
    ar: 'مسارات العمل المتقدمة',
  },
  '从文字识别到视频后期，连接对应服务后执行。': {
    en: 'From text recognition to video editing. Connect the required service to run a workflow.',
    ar: 'من التعرّف على النص إلى معالجة الفيديو. صِل الخدمة المطلوبة لتشغيل المسار.',
  },
  图片与视频: {
    en: 'Images and video',
    ar: 'الصور والفيديو',
  },
  图片处理: {
    en: 'Image processing',
    ar: 'معالجة الصور',
  },
  视频后期: {
    en: 'Video post-production',
    ar: 'معالجة الفيديو',
  },
  未找到此工作流: {
    en: 'Workflow not found',
    ar: 'لم يتم العثور على مسار العمل',
  },
  返回工具箱: {
    en: 'Back to tools',
    ar: 'العودة إلى الأدوات',
  },
  全部工具: {
    en: 'All tools',
    ar: 'كل الأدوات',
  },
  输入与参数: {
    en: 'Inputs and settings',
    ar: 'المدخلات والإعدادات',
  },
  原始图片: {
    en: 'Original image',
    ar: 'الصورة الأصلية',
  },
  原始视频: {
    en: 'Original video',
    ar: 'الفيديو الأصلي',
  },
  '参考图片（可选）': {
    en: 'Reference images (optional)',
    ar: 'صور مرجعية (اختياري)',
  },
  处理说明: {
    en: 'Instructions',
    ar: 'تعليمات المعالجة',
  },
  '可选：说明需要关注的文字区域': {
    en: 'Optional: specify the text region to focus on',
    ar: 'اختياري: حدد منطقة النص التي تريد التركيز عليها',
  },
  '描述你希望得到的结果…': {
    en: 'Describe the result you want…',
    ar: 'صِف النتيجة التي تريدها…',
  },
  处理服务: {
    en: 'Processing service',
    ar: 'خدمة المعالجة',
  },
  '正在加载能力…': {
    en: 'Loading capabilities…',
    ar: 'جارٍ تحميل الإمكانات…',
  },
  模型: {
    en: 'Model',
    ar: 'النموذج',
  },
  '延长时长（秒）': {
    en: 'Extension length (seconds)',
    ar: 'مدة التمديد (ثوانٍ)',
  },
  放大倍数: {
    en: 'Scale factor',
    ar: 'معامل التكبير',
  },
  目标清晰度: {
    en: 'Target resolution',
    ar: 'الدقة المستهدفة',
  },
  目标语言: {
    en: 'Target language',
    ar: 'اللغة المستهدفة',
  },
  文字替换: {
    en: 'Text replacements',
    ar: 'استبدال النص',
  },
  添加: {
    en: 'Add',
    ar: 'إضافة',
  },
  替换为: {
    en: 'Replace with',
    ar: 'استبدال بـ',
  },
  宽度: {
    en: 'Width',
    ar: 'العرض',
  },
  高度: {
    en: 'Height',
    ar: 'الارتفاع',
  },
  移除: {
    en: 'Remove',
    ar: 'إزالة',
  },
  '区域坐标为原图像素的 X、Y、宽、高。识别结果中的四角坐标需要先换算，不能直接填入这里。': {
    en: 'Use X, Y, width and height in original-image pixels. Convert the four-corner coordinates from OCR before entering them here.',
    ar: 'استخدم X وY والعرض والارتفاع ببكسلات الصورة الأصلية. حوّل إحداثيات الزوايا الأربع من التعرّف على النص قبل إدخالها هنا.',
  },
  '拆分结果会按图层保存为真实素材，可在画布中分别插入和编辑。': {
    en: 'Layers are saved as assets that can be inserted and edited individually on the canvas.',
    ar: 'تُحفظ الطبقات كمواد يمكن إدراجها وتعديلها بشكل مستقل على اللوحة.',
  },
  开始处理: {
    en: 'Start processing',
    ar: 'بدء المعالجة',
  },
  处理记录: {
    en: 'Processing history',
    ar: 'سجل المعالجة',
  },
  '准备好素材，开始下一步': {
    en: 'Prepare your assets for the next step',
    ar: 'جهّز موادك للخطوة التالية',
  },
  '真实处理结果与文字输出会保存在任务记录中。': {
    en: 'Processed assets and text outputs are saved in the task history.',
    ar: 'تُحفظ المواد المعالجة والنصوص الناتجة في سجل المهام.',
  },
  视频: {
    en: 'Video',
    ar: 'فيديو',
  },
  音频: {
    en: 'Audio',
    ar: 'صوت',
  },
  文档: {
    en: 'Document',
    ar: 'مستند',
  },
  参考素材: {
    en: 'Reference assets',
    ar: 'المواد المرجعية',
  },
  添加素材: {
    en: 'Add assets',
    ar: 'إضافة مواد',
  },
  '从当前工作空间选择，或上传自己的素材。': {
    en: 'Choose from this workspace or upload your own assets.',
    ar: 'اختر من مساحة العمل الحالية أو ارفع موادك الخاصة.',
  },
  搜索素材: {
    en: 'Search assets',
    ar: 'البحث في المواد',
  },
  上传: {
    en: 'Upload',
    ar: 'رفع',
  },
  还没有可用素材: {
    en: 'No assets available yet',
    ar: 'لا توجد مواد متاحة بعد',
  },
  '上传的原件会保存在当前空间，可在各个项目间复用。': {
    en: 'Uploaded originals are saved in this workspace and can be reused across projects.',
    ar: 'تُحفظ الملفات الأصلية المرفوعة في مساحة العمل ويمكن إعادة استخدامها في المشاريع.',
  },
  上传素材: {
    en: 'Upload assets',
    ar: 'رفع مواد',
  },
  已选择: {
    en: 'Selected ',
    ar: 'المحدد ',
  },
  项: {
    en: ' items',
    ar: ' عناصر',
  },
  完成选择: {
    en: 'Done selecting',
    ar: 'إتمام التحديد',
  },
  通用电商: {
    en: 'General ecommerce',
    ar: 'تجارة إلكترونية عامة',
  },
  草稿素材加载失败: {
    en: 'Could not load draft assets',
    ar: 'تعذّر تحميل مواد المسودة',
  },
  未命名创作: {
    en: 'Untitled creation',
    ar: 'عمل بلا عنوان',
  },
  新的创作草稿: {
    en: 'New creative draft',
    ar: 'مسودة إبداعية جديدة',
  },
  草稿已保存: {
    en: 'Draft saved',
    ar: 'تم حفظ المسودة',
  },
  图片创作: {
    en: 'Create an image',
    ar: 'إنشاء صورة',
  },
  视频创作: {
    en: 'Create a video',
    ar: 'إنشاء فيديو',
  },
  让灵感更进一步: {
    en: 'Take your idea further',
    ar: 'طوّر فكرتك',
  },
  创作需求: {
    en: 'Creative brief',
    ar: 'وصف العمل',
  },
  '描述你的下一件作品，比如：为一款植物精华设计自然、清新的商品主图…': {
    en: 'Describe your next creation, such as a fresh, natural hero image for a botanical serum…',
    ar: 'صِف عملك القادم، مثل صورة رئيسية طبيعية ومنعشة لمصل نباتي…',
  },
  '描述画面、主体动作与镜头，比如：一束晨光缓缓掠过产品，镜头轻轻推进…': {
    en: 'Describe the scene, subject and camera: morning light moves across the product as the camera gently pushes in…',
    ar: 'صِف المشهد وحركة العنصر والكاميرا: ضوء الصباح يمر فوق المنتج والكاميرا تقترب ببطء…',
  },
  模型与服务: {
    en: 'Models and services',
    ar: 'النماذج والخدمات',
  },
  '加载模型…': {
    en: 'Loading models…',
    ar: 'جارٍ تحميل النماذج…',
  },
  '· 未连接': {
    en: '· Not connected',
    ar: '· غير متصل',
  },
  生成模型: {
    en: 'Generation model',
    ar: 'نموذج التوليد',
  },
  比例: {
    en: 'Aspect ratio',
    ar: 'نسبة الأبعاد',
  },
  智能比例: {
    en: 'Automatic ratio',
    ar: 'نسبة تلقائية',
  },
  生成数量: {
    en: 'Output count',
    ar: 'عدد النتائج',
  },
  张: {
    en: ' images',
    ar: ' صور',
  },
  时长: {
    en: 'Duration',
    ar: 'المدة',
  },
  秒: {
    en: ' s',
    ar: ' ثوانٍ',
  },
  收起: {
    en: 'Collapse',
    ar: 'طي',
  },
  更多设置: {
    en: 'More settings',
    ar: 'المزيد من الإعدادات',
  },
  '参考图片、视频或文档': {
    en: 'Reference images, videos or documents',
    ar: 'صور أو فيديوهات أو مستندات مرجعية',
  },
  创作类型: {
    en: 'Creation type',
    ar: 'نوع العمل',
  },
  清晰度: {
    en: 'Resolution',
    ar: 'الدقة',
  },
  参考品牌: {
    en: 'Brand reference',
    ar: 'مرجع العلامة التجارية',
  },
  不使用品牌: {
    en: 'No brand reference',
    ar: 'دون مرجع للعلامة التجارية',
  },
  发布平台: {
    en: 'Publishing platform',
    ar: 'منصة النشر',
  },
  画面文字语言: {
    en: 'On-image text language',
    ar: 'لغة النص في الصورة',
  },
  参考方式: {
    en: 'Reference mode',
    ar: 'وضع المراجع',
  },
  全能参考: {
    en: 'All references',
    ar: 'جميع المراجع',
  },
  首尾帧: {
    en: 'First and last frames',
    ar: 'الإطار الأول والأخير',
  },
  '生成画面文案 / 字幕': {
    en: 'Generate on-screen copy / captions',
    ar: 'توليد نصوص / ترجمة على الشاشة',
  },
  'AI 帮我写': {
    en: 'Write with AI',
    ar: 'الكتابة بالذكاء الاصطناعي',
  },
  保存草稿: {
    en: 'Save draft',
    ar: 'حفظ المسودة',
  },
  开始创作: {
    en: 'Start creating',
    ar: 'بدء الإنشاء',
  },
  '任务已提交，可在任务中心查看进度': {
    en: 'Task submitted. Track its progress in Task Center.',
    ar: 'تم إرسال المهمة. تابع تقدمها في مركز المهام.',
  },
  '该能力尚未连接生成服务。素材与参数仍可编辑并保存。': {
    en: 'This capability is not connected to a generation service yet. You can still edit and save assets and settings.',
    ar: 'هذه الإمكانية غير متصلة بخدمة توليد بعد. يمكنك تعديل المواد والإعدادات وحفظها.',
  },
  连接服务: {
    en: 'Connect a service',
    ar: 'توصيل خدمة',
  },
  提交前确认实际估价: {
    en: 'Confirm the quote before submitting',
    ar: 'تأكيد السعر قبل الإرسال',
  },
  连接服务后估价: {
    en: 'Connect a service to get a quote',
    ar: 'صِل خدمة للحصول على تقدير',
  },
  确认创作: {
    en: 'Confirm creation',
    ar: 'تأكيد الإنشاء',
  },
  '本次任务会按以下配置执行，任务开始后可在任务中心查看结果。': {
    en: 'This task will use the settings below. View its results in Task Center once it starts.',
    ar: 'ستستخدم المهمة الإعدادات التالية. يمكنك عرض نتائجها في مركز المهام بعد بدئها.',
  },
  处理方式: {
    en: 'Processing mode',
    ar: 'وضع المعالجة',
  },
  素材: {
    en: 'Assets',
    ar: 'المواد',
  },
  输出: {
    en: 'Output',
    ar: 'النتيجة',
  },
  预留额度上限: {
    en: 'Maximum credits reserved',
    ar: 'الحد الأقصى للأرصدة المحجوزة',
  },
  额度: {
    en: 'credits',
    ar: 'أرصدة',
  },
  '这里显示的是工作空间额度。供应商可能按实际调用另行收取费用。失败与取消按实际执行情况结算。': {
    en: 'These are workspace credits. Your provider may charge separately for actual API usage. Failed and cancelled tasks are settled based on work performed.',
    ar: 'هذه أرصدة مساحة العمل. قد يفرض المزوّد رسومًا منفصلة مقابل الاستخدام الفعلي. تُسوّى المهام الفاشلة والملغاة حسب العمل المنفّذ.',
  },
  继续编辑: {
    en: 'Continue editing',
    ar: 'متابعة التعديل',
  },
  确认并提交: {
    en: 'Confirm and submit',
    ar: 'تأكيد وإرسال',
  },
  创作: {
    en: 'Create',
    ar: 'إنشاء',
  },
  灵感广场: {
    en: 'Inspiration',
    ar: 'الإلهام',
  },
  创作工作台: {
    en: 'Studio',
    ar: 'الاستوديو',
  },
  'AI 工具': {
    en: 'AI tools',
    ar: 'أدوات الذكاء الاصطناعي',
  },
  管理: {
    en: 'Manage',
    ar: 'إدارة',
  },
  项目: {
    en: 'Projects',
    ar: 'المشاريع',
  },
  品牌: {
    en: 'Brands',
    ar: 'العلامات التجارية',
  },
  人物: {
    en: 'Characters',
    ar: 'الشخصيات',
  },
  协作: {
    en: 'Collaborate',
    ar: 'التعاون',
  },
  团队: {
    en: 'Team',
    ar: 'الفريق',
  },
  用量与订单: {
    en: 'Usage and orders',
    ar: 'الاستخدام والطلبات',
  },
  映: {
    en: 'Y',
    ar: 'Y',
  },
  映造: {
    en: 'Yingzao',
    ar: 'Yingzao',
  },
  我: {
    en: 'Me',
    ar: 'أنا',
  },
  选择工作空间: {
    en: 'Choose a workspace',
    ar: 'اختيار مساحة عمل',
  },
  团队空间: {
    en: 'Team workspace',
    ar: 'مساحة عمل الفريق',
  },
  个人空间: {
    en: 'Personal workspace',
    ar: 'مساحة العمل الشخصية',
  },
  '· 演示': {
    en: '· Demo',
    ar: '· تجريبي',
  },
  当前: {
    en: 'Current',
    ar: 'الحالي',
  },
  '＋ 创建团队空间': {
    en: '＋ Create team workspace',
    ar: '＋ إنشاء مساحة عمل للفريق',
  },
  主导航: {
    en: 'Main navigation',
    ar: 'التنقل الرئيسي',
  },
  本机测试额度: {
    en: 'Local test credits',
    ar: 'أرصدة اختبار محلية',
  },
  可用额度: {
    en: 'Available credits',
    ar: 'الأرصدة المتاحة',
  },
  查看额度明细: {
    en: 'View credit details',
    ar: 'عرض تفاصيل الأرصدة',
  },
  '详情 ↗': {
    en: 'Details ↗',
    ar: 'التفاصيل ↗',
  },
  开发者: {
    en: 'Developer',
    ar: 'المطوّر',
  },
  设置: {
    en: 'Settings',
    ar: 'الإعدادات',
  },
  帮助与支持: {
    en: 'Help and support',
    ar: 'المساعدة والدعم',
  },
  空间创建者: {
    en: 'Workspace owner',
    ar: 'مالك مساحة العمل',
  },
  只读成员: {
    en: 'Viewer',
    ar: 'مشاهد',
  },
  空间成员: {
    en: 'Workspace member',
    ar: 'عضو مساحة العمل',
  },
  退出登录: {
    en: 'Sign out',
    ar: 'تسجيل الخروج',
  },
  展开导航: {
    en: 'Expand navigation',
    ar: 'توسيع التنقل',
  },
  工作空间: {
    en: 'Workspace',
    ar: 'مساحة العمل',
  },
  '映造 Studio': {
    en: 'Yingzao Studio',
    ar: 'استوديو Yingzao',
  },
  演示空间: {
    en: 'Demo workspace',
    ar: 'مساحة عمل تجريبية',
  },
  全局搜索: {
    en: 'Global search',
    ar: 'البحث الشامل',
  },
  通知: {
    en: 'Notifications',
    ar: 'الإشعارات',
  },
  任务中心: {
    en: 'Task Center',
    ar: 'مركز المهام',
  },
  '从想法出发，让创作发生。': {
    en: 'Start with an idea. Make it real.',
    ar: 'ابدأ بفكرة وحوّلها إلى عمل.',
  },
  搜索工作空间: {
    en: 'Search workspace',
    ar: 'البحث في مساحة العمل',
  },
  '搜索项目名称…': {
    en: 'Search project names…',
    ar: 'البحث بأسماء المشاريع…',
  },
  搜索项目: {
    en: 'Search projects',
    ar: 'البحث في المشاريع',
  },
  没有找到相关项目: {
    en: 'No matching projects',
    ar: 'لا توجد مشاريع مطابقة',
  },
  创建团队空间: {
    en: 'Create team workspace',
    ar: 'إنشاء مساحة عمل للفريق',
  },
  '团队拥有独立的项目、素材与用量。': {
    en: 'Teams have their own projects, assets and usage.',
    ar: 'لكل فريق مشاريعه ومواده وسجل استخدامه المستقل.',
  },
  团队空间已创建: {
    en: 'Team workspace created',
    ar: 'تم إنشاء مساحة عمل الفريق',
  },
  团队名称: {
    en: 'Team name',
    ar: 'اسم الفريق',
  },
  创建团队: {
    en: 'Create team',
    ar: 'إنشاء فريق',
  },
  标为已读: {
    en: 'Mark as read',
    ar: 'تحديد كمقروء',
  },
  暂时没有新消息: {
    en: 'No new notifications',
    ar: 'لا توجد إشعارات جديدة',
  },
  '任务结果与工作空间动态会在这里通知你。': {
    en: 'Task results and workspace updates will appear here.',
    ar: 'ستظهر نتائج المهام وتحديثات مساحة العمل هنا.',
  },
  遮罩画板不可用: {
    en: 'Mask canvas is unavailable',
    ar: 'لوحة القناع غير متاحة',
  },
  遮罩导出失败: {
    en: 'Mask export failed',
    ar: 'فشل تصدير القناع',
  },
  重绘区域已保存: {
    en: 'Edit region saved',
    ar: 'تم حفظ منطقة التعديل',
  },
  画笔: {
    en: 'Brush',
    ar: 'فرشاة',
  },
  橡皮: {
    en: 'Eraser',
    ar: 'ممحاة',
  },
  清空: {
    en: 'Clear',
    ar: 'مسح',
  },
  在原图上涂画需要重绘的区域: {
    en: 'Paint the region you want to edit on the original image',
    ar: 'لوّن المنطقة التي تريد تعديلها على الصورة الأصلية',
  },
  '白色涂画区域将被修改。遮罩按原图尺寸保存。': {
    en: 'White regions will be edited. The mask is saved at the original image size.',
    ar: 'ستُعدّل المناطق البيضاء. يُحفظ القناع بحجم الصورة الأصلية.',
  },
  保存重绘区域: {
    en: 'Save edit region',
    ar: 'حفظ منطقة التعديل',
  },
  查看详情: {
    en: 'View details',
    ar: 'عرض التفاصيل',
  },
  已提交取消请求: {
    en: 'Cancellation requested',
    ar: 'تم طلب الإلغاء',
  },
  取消: {
    en: 'Cancel',
    ar: 'إلغاء',
  },
  任务详情: {
    en: 'Task details',
    ar: 'تفاصيل المهمة',
  },
  状态: {
    en: 'Status',
    ar: 'الحالة',
  },
  任务说明: {
    en: 'Task description',
    ar: 'وصف المهمة',
  },
  未填写描述: {
    en: 'No description',
    ar: 'دون وصف',
  },
  已结算: {
    en: 'Settled',
    ar: 'تمت التسوية',
  },
  '服务请求结果尚未确认。系统会保留额度等待核对，避免重复生成和重复扣费。': {
    en: 'The service result is not confirmed yet. Credits remain reserved while we reconcile the request, avoiding duplicate generation or charges.',
    ar: 'لم تتأكد نتيجة الخدمة بعد. تبقى الأرصدة محجوزة لحين التحقق من الطلب لتجنب تكرار التوليد أو الخصم.',
  },
  第: {
    en: '#',
    ar: 'رقم ',
  },
  文本结果已复制: {
    en: 'Text result copied',
    ar: 'تم نسخ النتيجة النصية',
  },
  复制文本: {
    en: 'Copy text',
    ar: 'نسخ النص',
  },
  已下载原件: {
    en: 'Original downloaded',
    ar: 'تم تنزيل الملف الأصلي',
  },
  下载原件: {
    en: 'Download original',
    ar: 'تنزيل الملف الأصلي',
  },
  打开项目: {
    en: 'Open project',
    ar: 'فتح المشروع',
  },
  '已完成的素材会保留，只重试未成功的条目，不会重复处理成功项。': {
    en: 'Completed assets are kept. Only unsuccessful items will be retried.',
    ar: 'تُحفظ المواد المكتملة. ستُعاد محاولة العناصر غير الناجحة فقط.',
  },
  为未成功项重新估价: {
    en: 'Get a new quote for unsuccessful items',
    ar: 'تقدير جديد للعناصر غير الناجحة',
  },
  确认重试未成功项: {
    en: 'Confirm retry of unsuccessful items',
    ar: 'تأكيد إعادة محاولة العناصر غير الناجحة',
  },
  '已经成功的条目不会再次提交。': {
    en: 'Successful items will not be submitted again.',
    ar: 'لن تُرسل العناصر الناجحة مرة أخرى.',
  },
  本次预留上限: {
    en: 'Maximum reservation',
    ar: 'الحد الأقصى للحجز',
  },
  处理数量: {
    en: 'Item count',
    ar: 'عدد العناصر',
  },
  重试任务已提交: {
    en: 'Retry task submitted',
    ar: 'تم إرسال مهمة إعادة المحاولة',
  },
  确认重试: {
    en: 'Confirm retry',
    ar: 'تأكيد إعادة المحاولة',
  },
  '每一次创作，都有迹可循': {
    en: 'Every creation has a history',
    ar: 'لكل عمل سجل',
  },
  刷新: {
    en: 'Refresh',
    ar: 'تحديث',
  },
  '你的下一件作品，从这里开始': {
    en: 'Your next creation starts here',
    ar: 'عملك القادم يبدأ هنا',
  },
  '提交创作或本地处理后，进度与结果会持续保存在这里。': {
    en: 'Once you submit a generation or local task, its progress and results are saved here.',
    ar: 'بعد إرسال مهمة توليد أو معالجة محلية، يُحفظ تقدمها ونتائجها هنا.',
  },
  团队额度使用方式: {
    en: 'Team credit policy',
    ar: 'سياسة أرصدة الفريق',
  },
  共享额度: {
    en: 'Shared credits',
    ar: 'أرصدة مشتركة',
  },
  按成员分配: {
    en: 'Allocate by member',
    ar: 'توزيع حسب العضو',
  },
  '共享模式下成员使用团队可用额度，并遵守个人上限。分配模式下，未分配预算的成员不能提交新任务。': {
    en: 'Shared mode uses the team balance with individual limits. In allocated mode, members without a budget cannot submit tasks.',
    ar: 'في الوضع المشترك يستخدم الأعضاء رصيد الفريق ضمن حدودهم الفردية. في وضع التوزيع، لا يمكن لمن ليس لديه ميزانية إرسال مهام.',
  },
  '变更团队额度方式？': {
    en: 'Change the team credit policy?',
    ar: 'تغيير سياسة أرصدة الفريق؟',
  },
  '已有任务的预留与结算记录保留。切换至分配模式后，请为每位需要创作的成员设置预算。': {
    en: 'Existing reservations and settlements are preserved. After switching to allocated mode, set a budget for each member who needs to create.',
    ar: 'تُحفظ الحجوزات والتسويات السابقة. بعد الانتقال إلى التوزيع، حدد ميزانية لكل عضو يحتاج إلى الإنشاء.',
  },
  额度模式已更新: {
    en: 'Credit policy updated',
    ar: 'تم تحديث سياسة الأرصدة',
  },
  '成员,成功结算任务,已用额度': {
    en: 'Member,Settled tasks,Credits used',
    ar: 'العضو,المهام المسوّاة,الأرصدة المستخدمة',
  },
  开始日期: {
    en: 'Start date',
    ar: 'تاريخ البداية',
  },
  结束日期: {
    en: 'End date',
    ar: 'تاريخ النهاية',
  },
  导出统计: {
    en: 'Export statistics',
    ar: 'تصدير الإحصاءات',
  },
  '结束日期不能早于开始日期。': {
    en: 'The end date cannot be before the start date.',
    ar: 'لا يمكن أن يسبق تاريخ النهاية تاريخ البداية.',
  },
  成员: {
    en: 'Member',
    ar: 'العضو',
  },
  成功结算任务: {
    en: 'Settled tasks',
    ar: 'المهام المسوّاة',
  },
  已使用额度: {
    en: 'Credits used',
    ar: 'الأرصدة المستخدمة',
  },
  所选日期没有已结算任务: {
    en: 'No settled tasks in this date range',
    ar: 'لا توجد مهام مسوّاة ضمن هذه الفترة',
  },
  '统计来自真实账本，不包含灵感示例或未执行的草稿。': {
    en: 'Statistics come from the actual ledger, excluding inspiration examples and unexecuted drafts.',
    ar: 'تُستخرج الإحصاءات من السجل الفعلي، دون أمثلة الإلهام أو المسودات غير المنفّذة.',
  },
  成员预算与预留: {
    en: 'Member budgets and reservations',
    ar: 'ميزانيات الأعضاء وحجوزاتهم',
  },
  当前状态: {
    en: 'Current status',
    ar: 'الحالة الحالية',
  },
  预算上限: {
    en: 'Budget limit',
    ar: 'حد الميزانية',
  },
  累计使用: {
    en: 'Total used',
    ar: 'إجمالي الاستخدام',
  },
  当前预留: {
    en: 'Currently reserved',
    ar: 'المحجوز حاليًا',
  },
  预算余量: {
    en: 'Remaining budget',
    ar: 'الميزانية المتبقية',
  },
  遵循空间余额: {
    en: 'Use workspace balance',
    ar: 'استخدام رصيد مساحة العمل',
  },
  关闭: {
    en: 'Close',
    ar: 'إغلاق',
  },
  '正在加载…': {
    en: 'Loading…',
    ar: 'جارٍ التحميل…',
  },
  暂时无法完成: {
    en: 'Unable to complete right now',
    ar: 'تعذّر الإكمال حاليًا',
  },
  重试: {
    en: 'Retry',
    ar: 'إعادة المحاولة',
  },
  共: {
    en: 'Total ',
    ar: 'الإجمالي ',
  },
  上一页: {
    en: 'Previous page',
    ar: 'الصفحة السابقة',
  },
  下一页: {
    en: 'Next page',
    ar: 'الصفحة التالية',
  },
  关闭提示: {
    en: 'Dismiss notification',
    ar: 'إغلاق التنبيه',
  },
  保留: {
    en: 'Keep',
    ar: 'إبقاء',
  },
  确认: {
    en: 'Confirm',
    ar: 'تأكيد',
  },
  '正在打开映造工作空间…': {
    en: 'Opening your Yingzao workspace…',
    ar: 'جارٍ فتح مساحة عمل Yingzao…',
  },
  '服务返回了无法识别的内容。': {
    en: 'The service returned an unrecognized response.',
    ar: 'أعادت الخدمة استجابة غير معروفة.',
  },
  '操作未完成，请重试。': {
    en: 'The operation did not complete. Please try again.',
    ar: 'لم تكتمل العملية. يُرجى المحاولة مرة أخرى.',
  },
  '文件下载失败，请检查权限后重试。': {
    en: 'Download failed. Check your permissions and try again.',
    ar: 'فشل التنزيل. تحقق من صلاحياتك وحاول مرة أخرى.',
  },
  '文件内容为空。': {
    en: 'The file is empty.',
    ar: 'الملف فارغ.',
  },
  排队中: {
    en: 'Queued',
    ar: 'في قائمة الانتظار',
  },
  处理中: {
    en: 'Processing',
    ar: 'قيد المعالجة',
  },
  已完成: {
    en: 'Completed',
    ar: 'مكتمل',
  },
  部分完成: {
    en: 'Partially completed',
    ar: 'مكتمل جزئيًا',
  },
  未完成: {
    en: 'Unsuccessful',
    ar: 'غير ناجح',
  },
  已取消: {
    en: 'Cancelled',
    ar: 'ملغى',
  },
  等待核对: {
    en: 'Awaiting reconciliation',
    ar: 'بانتظار التحقق',
  },
  '让你的应用，与同一个创作工作空间连接。': {
    en: 'Connect your application to the same creative workspace.',
    ar: 'صِل تطبيقك بمساحة العمل الإبداعية نفسها.',
  },
  '创建 API Key': {
    en: 'Create API key',
    ar: 'إنشاء مفتاح API',
  },
  '一套 API，连接素材与创作。': {
    en: 'One API for your assets and creative work.',
    ar: 'واجهة API واحدة لموادك وأعمالك الإبداعية.',
  },
  '访问项目与素材、提交真实任务、查询执行状态。API 与工作台使用相同的空间权限和额度规则。': {
    en: 'Access projects and assets, submit tasks, and check progress. The API uses the same workspace permissions and credit rules as the studio.',
    ar: 'يمكنك الوصول إلى المشاريع والمواد وإرسال المهام وتتبعها. تستخدم API صلاحيات مساحة العمل وقواعد الأرصدة نفسها.',
  },
  '查看 API 文档 ↗': {
    en: 'View API documentation ↗',
    ar: 'عرض توثيق API ↗',
  },
  只有创建者与管理员可以管理密钥: {
    en: 'Only owners and admins can manage keys',
    ar: 'يمكن للمالكين والمسؤولين فقط إدارة المفاتيح',
  },
  '空间 API Key': {
    en: 'Workspace API keys',
    ar: 'مفاتيح API لمساحة العمل',
  },
  完整密钥仅创建时显示一次: {
    en: 'The full key is shown only once, when created',
    ar: 'يظهر المفتاح الكامل مرة واحدة عند إنشائه',
  },
  '名称 / 前缀': {
    en: 'Name / prefix',
    ar: 'الاسم / البادئة',
  },
  权限: {
    en: 'Permissions',
    ar: 'الصلاحيات',
  },
  最近使用: {
    en: 'Last used',
    ar: 'آخر استخدام',
  },
  到期: {
    en: 'Expires',
    ar: 'ينتهي',
  },
  已撤销: {
    en: 'Revoked',
    ar: 'ملغى',
  },
  有效: {
    en: 'Active',
    ar: 'صالح',
  },
  撤销: {
    en: 'Revoke',
    ar: 'إلغاء الصلاحية',
  },
  '创建你的第一个 API Key': {
    en: 'Create your first API key',
    ar: 'إنشاء أول مفتاح API',
  },
  '按需授予最小权限，密钥可以随时撤销。': {
    en: 'Grant only the permissions needed. You can revoke a key at any time.',
    ar: 'امنح الصلاحيات اللازمة فقط. يمكنك إلغاء المفتاح في أي وقت.',
  },
  第一次请求: {
    en: 'Your first request',
    ar: 'طلبك الأول',
  },
  '把 YOUR_API_KEY 替换为刚创建的密钥。': {
    en: 'Replace YOUR_API_KEY with the key you just created.',
    ar: 'استبدل YOUR_API_KEY بالمفتاح الذي أنشأته.',
  },
  示例已复制: {
    en: 'Example copied',
    ar: 'تم نسخ المثال',
  },
  复制示例: {
    en: 'Copy example',
    ar: 'نسخ المثال',
  },
  '不同的密钥，各有用途。': {
    en: 'Different keys serve different purposes.',
    ar: 'لكل نوع من المفاتيح استخدامه.',
  },
  '这里创建的是映造工作空间 API Key，用于访问本系统。': {
    en: 'Keys created here access the Yingzao workspace API.',
    ar: 'تُستخدم المفاتيح المنشأة هنا للوصول إلى API مساحة عمل Yingzao.',
  },
  '模型供应商密钥在“设置 → 生成服务”管理。没有供应商配置时，API 会清楚返回能力未连接，不会生成虚拟结果。':
    {
      en: 'Manage model provider keys in Settings → Generation services. Without a configured provider, the API reports the capability as unavailable and does not create simulated results.',
      ar: 'أدِر مفاتيح مزوّدي النماذج من الإعدادات ← خدمات التوليد. دون مزوّد مُعدّ، تعيد API حالة عدم توفر الإمكانية ولا تنشئ نتائج وهمية.',
    },
  密钥名称: {
    en: 'Key name',
    ar: 'اسم المفتاح',
  },
  '例如：商品内容自动化': {
    en: 'For example: product content automation',
    ar: 'مثال: أتمتة محتوى المنتجات',
  },
  可用权限: {
    en: 'Available permissions',
    ar: 'الصلاحيات المتاحة',
  },
  '到期日期（可选）': {
    en: 'Expiry date (optional)',
    ar: 'تاريخ الانتهاء (اختياري)',
  },
  '额度上限（可选）': {
    en: 'Credit limit (optional)',
    ar: 'حد الأرصدة (اختياري)',
  },
  创建密钥: {
    en: 'Create key',
    ar: 'إنشاء مفتاح',
  },
  保存你的新密钥: {
    en: 'Save your new key',
    ar: 'احفظ مفتاحك الجديد',
  },
  '完整密钥只显示这一次。关闭后无法再次查看。': {
    en: 'The full key is shown only once. You cannot view it again after closing this window.',
    ar: 'يظهر المفتاح الكامل مرة واحدة فقط. لن تتمكن من عرضه مجددًا بعد إغلاق هذه النافذة.',
  },
  '请保存在可信的密钥管理器中，不要放入公开仓库或前端代码。': {
    en: 'Store it in a trusted secret manager. Do not put it in public repositories or frontend code.',
    ar: 'احفظه في مدير أسرار موثوق. لا تضعه في مستودع عام أو كود الواجهة.',
  },
  密钥已复制: {
    en: 'Key copied',
    ar: 'تم نسخ المفتاح',
  },
  复制密钥: {
    en: 'Copy key',
    ar: 'نسخ المفتاح',
  },
  我已妥善保存: {
    en: 'I have saved it securely',
    ar: 'حفظته بأمان',
  },
  '撤销 API Key？': {
    en: 'Revoke this API key?',
    ar: 'إلغاء صلاحية مفتاح API هذا؟',
  },
  '撤销后所有使用此密钥的请求将立即失效，此密钥无法恢复。': {
    en: 'All requests using this key will stop working immediately. The key cannot be restored.',
    ar: 'ستتوقف كل الطلبات التي تستخدم هذا المفتاح فورًا. لا يمكن استعادته.',
  },
  密钥已撤销: {
    en: 'Key revoked',
    ar: 'تم إلغاء صلاحية المفتاح',
  },
  品牌参考已保存: {
    en: 'Brand reference saved',
    ar: 'تم حفظ مرجع العلامة التجارية',
  },
  '把色彩、字体与参考风格放在一起，让每件作品都带着你的辨识度。': {
    en: 'Keep colors, fonts and references together so every creation feels like your brand.',
    ar: 'اجمع الألوان والخطوط والمراجع لتحافظ أعمالك على هوية علامتك.',
  },
  创建品牌: {
    en: 'Create brand',
    ar: 'إنشاء علامة تجارية',
  },
  '搜索品牌…': {
    en: 'Search brands…',
    ar: 'البحث في العلامات التجارية…',
  },
  搜索品牌: {
    en: 'Search brands',
    ar: 'البحث في العلامات التجارية',
  },
  '参考风格配置，不进行模型训练': {
    en: 'Style references only; no model training',
    ar: 'مراجع أسلوبية فقط؛ دون تدريب نموذج',
  },
  仅自己: {
    en: 'Only me',
    ar: 'أنا فقط',
  },
  空间共享: {
    en: 'Shared with workspace',
    ar: 'مشترك مع مساحة العمل',
  },
  '为下一次创作建立一致的视觉参考。': {
    en: 'Create a consistent visual reference for your next project.',
    ar: 'أنشئ مرجعًا بصريًا متناسقًا لمشروعك القادم.',
  },
  张参考: {
    en: ' reference images',
    ar: ' صور مرجعية',
  },
  编辑品牌: {
    en: 'Edit brand',
    ar: 'تعديل العلامة التجارية',
  },
  查看品牌: {
    en: 'View brand',
    ar: 'عرض العلامة التجارية',
  },
  删除: {
    en: 'Delete',
    ar: 'حذف',
  },
  '让品牌风格，始终如一': {
    en: 'Keep your brand consistent',
    ar: 'حافظ على تناسق علامتك',
  },
  '保存品牌色、字体与参考图片，创作时一键引用。': {
    en: 'Save brand colors, fonts and reference images, then reuse them when creating.',
    ar: 'احفظ ألوان العلامة وخطوطها وصورها المرجعية لاستخدامها أثناء الإنشاء.',
  },
  创建第一个品牌: {
    en: 'Create your first brand',
    ar: 'إنشاء أول علامة تجارية',
  },
  品牌参考: {
    en: 'Brand references',
    ar: 'مراجع العلامة التجارية',
  },
  品牌名称: {
    en: 'Brand name',
    ar: 'اسم العلامة التجارية',
  },
  可见范围: {
    en: 'Visibility',
    ar: 'نطاق الظهور',
  },
  工作空间成员: {
    en: 'Workspace members',
    ar: 'أعضاء مساحة العمل',
  },
  品牌描述: {
    en: 'Brand description',
    ar: 'وصف العلامة التجارية',
  },
  品牌颜色: {
    en: 'Brand colors',
    ar: 'ألوان العلامة التجارية',
  },
  '使用HEX色值，以逗号分隔': {
    en: 'Comma-separated HEX colors',
    ar: 'ألوان HEX مفصولة بفواصل',
  },
  偏好字体: {
    en: 'Preferred fonts',
    ar: 'الخطوط المفضّلة',
  },
  '字体名称，以逗号分隔': {
    en: 'Comma-separated font names',
    ar: 'أسماء خطوط مفصولة بفواصل',
  },
  '品牌参考图 · 第一张作为封面': {
    en: 'Brand reference images · First image is the cover',
    ar: 'صور مرجعية للعلامة · الصورة الأولى هي الغلاف',
  },
  '参考图用于为创作提供视觉风格。保存品牌不会训练模型，也不会调用付费生成。': {
    en: 'Reference images guide the visual style. Saving a brand does not train a model or trigger paid generation.',
    ar: 'توجّه الصور المرجعية الأسلوب البصري. لا يؤدي حفظ العلامة إلى تدريب نموذج أو تشغيل توليد مدفوع.',
  },
  保存品牌: {
    en: 'Save brand',
    ar: 'حفظ العلامة التجارية',
  },
  '删除这个品牌？': {
    en: 'Delete this brand?',
    ar: 'حذف هذه العلامة التجارية؟',
  },
  '品牌配置会保留在回收记录中，已经生成的作品不会删除。': {
    en: 'The brand configuration stays in the deletion record. Existing creations will not be deleted.',
    ar: 'تبقى إعدادات العلامة في سجل الحذف. لن تُحذف الأعمال الحالية.',
  },
  品牌已删除: {
    en: 'Brand deleted',
    ar: 'تم حذف العلامة التجارية',
  },
  未认证: {
    en: 'Not verified',
    ar: 'غير موثّق',
  },
  审核中: {
    en: 'Under review',
    ar: 'قيد المراجعة',
  },
  已认证: {
    en: 'Verified',
    ar: 'موثّق',
  },
  未通过: {
    en: 'Not approved',
    ar: 'غير مقبول',
  },
  已过期: {
    en: 'Expired',
    ar: 'منتهي الصلاحية',
  },
  '整理人物参考素材，让不同场景中的角色表达保持连贯。': {
    en: 'Organize character references to keep portrayals consistent across scenes.',
    ar: 'نظّم مراجع الشخصيات للحفاظ على تناسقها عبر المشاهد.',
  },
  创建人物: {
    en: 'Create character',
    ar: 'إنشاء شخصية',
  },
  '人物参考与身份认证分别管理。上传素材不会自动获得认证；需要认证的能力会检查真实的服务状态。': {
    en: 'Character references and identity verification are managed separately. Uploading assets does not verify an identity; capabilities that require verification check the actual service status.',
    ar: 'تُدار مراجع الشخصيات والتحقق من الهوية بشكل منفصل. رفع المواد لا يثبت الهوية؛ وتتحقق الإمكانات التي تتطلب توثيقًا من حالة الخدمة الفعلية.',
  },
  编辑人物: {
    en: 'Edit character',
    ar: 'تعديل الشخصية',
  },
  查看人物: {
    en: 'View character',
    ar: 'عرض الشخصية',
  },
  '故事里的主角，从这里开始': {
    en: "Your story's character starts here",
    ar: 'شخصية قصتك تبدأ هنا',
  },
  '添加人物名称与参考图，建立自己的角色素材库。': {
    en: 'Add a name and reference images to build your character library.',
    ar: 'أضف اسمًا وصورًا مرجعية لبناء مكتبة شخصياتك.',
  },
  人物资料: {
    en: 'Character profile',
    ar: 'ملف الشخصية',
  },
  人物资料已保存: {
    en: 'Character profile saved',
    ar: 'تم حفظ ملف الشخصية',
  },
  人物名称: {
    en: 'Character name',
    ar: 'اسم الشخصية',
  },
  角色说明: {
    en: 'Character description',
    ar: 'وصف الشخصية',
  },
  参考图片: {
    en: 'Reference images',
    ar: 'الصور المرجعية',
  },
  '认证状态：': {
    en: 'Verification status:',
    ar: 'حالة التوثيق:',
  },
  '。身份核验服务未连接时，状态不会被人工标为“已认证”。': {
    en: '. Without a connected identity verification service, the status cannot be manually marked as verified.',
    ar: '. دون خدمة متصلة للتحقق من الهوية، لا يمكن تعيين الحالة يدويًا إلى «موثّق».',
  },
  保存人物: {
    en: 'Save character',
    ar: 'حفظ الشخصية',
  },
  '删除人物资料？': {
    en: 'Delete this character profile?',
    ar: 'حذف ملف هذه الشخصية؟',
  },
  '人物资料将隐藏，已保存的参考素材与作品保留。': {
    en: 'The profile will be hidden. Saved reference assets and creations are kept.',
    ar: 'سيُخفى الملف. تبقى المواد المرجعية والأعمال المحفوظة.',
  },
  人物资料已删除: {
    en: 'Character profile deleted',
    ar: 'تم حذف ملف الشخصية',
  },
  '把清晨，装进一滴精华': {
    en: 'Morning light, in a drop',
    ar: 'ضوء الصباح في قطرة',
  },
  美妆护肤: {
    en: 'Beauty and skincare',
    ar: 'الجمال والعناية بالبشرة',
  },
  '为植物修护精华创作一张清新自然的商业摄影。透明玻璃瓶置于浅色石台，柔和晨光穿过绿色叶片，在瓶身留下精致水珠。清晰展现产品质感，空间简洁，保留适量排版留白。':
    {
      en: 'Create fresh, natural commercial photography for a botanical repair serum. Place a clear glass bottle on a pale stone plinth. Soft morning light passes through green leaves, revealing fine droplets on the bottle. Show the product texture clearly in a clean scene with space for typography.',
      ar: 'أنشئ تصويرًا إعلانيًا طبيعيًا ومنعشًا لمصل نباتي للعناية بالبشرة. ضع زجاجة شفافة على قاعدة حجرية فاتحة. يمر ضوء الصباح الناعم عبر أوراق خضراء ليظهر قطرات دقيقة على الزجاجة. أبرز ملمس المنتج في مشهد بسيط مع مساحة للنص.',
    },
  '自然 · 护肤': {
    en: 'Nature · Skincare',
    ar: 'طبيعة · عناية بالبشرة',
  },
  一抹琥珀色的安静: {
    en: 'A quiet amber moment',
    ar: 'لحظة هادئة بلون الكهرمان',
  },
  '为琥珀香水创作静物广告摄影。温暖斜光穿过透明香水瓶，橙棕色玻璃与细腻石材形成柔和对比，简洁构图突出产品轮廓与液体色泽。':
    {
      en: 'Create a still-life advertisement for an amber perfume. Warm angled light passes through a transparent bottle. Orange-brown glass contrasts softly with fine stone, while a simple composition highlights the silhouette and liquid color.',
      ar: 'أنشئ إعلانًا بطبيعة صامتة لعطر كهرماني. يمر ضوء دافئ مائل عبر زجاجة شفافة. يتباين الزجاج البرتقالي البني بلطف مع حجر ناعم، ويبرز التكوين البسيط هيئة المنتج ولون السائل.',
    },
  '光影 · 香氛': {
    en: 'Light · Fragrance',
    ar: 'ضوء · عطر',
  },
  '听见，另一种可能': {
    en: 'Hear a new possibility',
    ar: 'استمع إلى احتمال جديد',
  },
  数码科技: {
    en: 'Technology',
    ar: 'التقنية',
  },
  '为一副高级头戴耳机设计极简产品广告。冷灰色背景与干净几何台面，柔和侧光表现耳罩的织物与金属细节，构图自信而克制。':
    {
      en: 'Design a minimal product advertisement for premium over-ear headphones. Use a cool gray background and clean geometric plinths. Soft side light reveals fabric and metal details in a confident, restrained composition.',
      ar: 'صمّم إعلانًا بسيطًا لسماعات رأس فاخرة. استخدم خلفية رمادية باردة وقواعد هندسية نقية. يكشف ضوء جانبي ناعم تفاصيل النسيج والمعدن في تكوين واضح وهادئ.',
    },
  '极简 · 数码': {
    en: 'Minimal · Tech',
    ar: 'بساطة · تقنية',
  },
  让夏天多一点气泡: {
    en: 'A little more sparkle for summer',
    ar: 'مزيد من الانتعاش للصيف',
  },
  食品饮料: {
    en: 'Food and drink',
    ar: 'الطعام والشراب',
  },
  '创作一张清爽的柑橘气泡饮料广告。玻璃杯中的细小气泡与冰块晶莹清晰，切开的柑橘和叶片围绕产品，充满午后阳光的明快绿色背景。':
    {
      en: 'Create a refreshing citrus sparkling-drink advertisement. Show fine bubbles and clear ice in a glass, with sliced citrus and leaves around the product against a bright green, sunlit afternoon background.',
      ar: 'أنشئ إعلانًا منعشًا لمشروب حمضيات فوار. أظهر فقاعات دقيقة وثلجًا شفافًا في كأس، مع شرائح حمضيات وأوراق حول المنتج وخلفية خضراء مشرقة بضوء العصر.',
    },
  '鲜活 · 果饮': {
    en: 'Fresh · Fruit drinks',
    ar: 'انتعاش · مشروبات الفاكهة',
  },
  '光，也是一件雕塑': {
    en: 'Light as sculpture',
    ar: 'الضوء كمنحوتة',
  },
  家居生活: {
    en: 'Home and living',
    ar: 'المنزل والحياة اليومية',
  },
  '一盏具有雕塑感的现代台灯，置于温暖极简的家居角落。光晕柔和地洒在墙面，材质细腻，留白宽裕，用建筑感构图呈现生活美学。':
    {
      en: 'Place a sculptural modern table lamp in a warm, minimal interior. A soft glow falls on the wall, with fine materials, generous negative space, and an architectural composition that conveys thoughtful living.',
      ar: 'ضع مصباح طاولة حديثًا ذا طابع نحتي في ركن منزلي دافئ وبسيط. ينتشر ضوء ناعم على الجدار مع خامات دقيقة ومساحات واسعة وتكوين معماري يوحي بجمال الحياة اليومية.',
    },
  '空间 · 家居': {
    en: 'Space · Home',
    ar: 'مساحة · منزل',
  },
  '下一步，走向旷野': {
    en: 'Next step: the wild',
    ar: 'الخطوة القادمة نحو الطبيعة',
  },
  服饰运动: {
    en: 'Fashion and sport',
    ar: 'الأزياء والرياضة',
  },
  '为户外越野鞋创作专业广告摄影。产品放在粗粝岩石表面，以自然侧光突出鞋面织物与鞋底结构，背景融入低饱和荒野色调，体现轻盈与坚实。':
    {
      en: 'Create professional advertising photography for a trail-running shoe on rough rock. Natural side light highlights the upper fabric and sole structure. Muted wilderness colors convey lightness and strength.',
      ar: 'أنشئ تصويرًا إعلانيًا احترافيًا لحذاء جري خارجي على صخرة خشنة. يبرز ضوء جانبي طبيعي نسيج الجزء العلوي وبنية النعل، وتوحي ألوان الطبيعة الهادئة بالخفة والمتانة.',
    },
  '探索 · 运动': {
    en: 'Explore · Sport',
    ar: 'استكشاف · رياضة',
  },
  '给生活，留一刻缓慢': {
    en: 'Make room for a slower moment',
    ar: 'امنح يومك لحظة هادئة',
  },
  '一杯细腻抹茶与竹制茶筅构成安静的日常仪式。自然窗光落在陶瓷和亚麻上，绿色层次真实清晰，画面克制温暖，有手工质感。':
    {
      en: 'A cup of smooth matcha and a bamboo whisk form a quiet daily ritual. Natural window light falls on ceramic and linen. Keep the green tones true and distinct, the composition warm and restrained, with a handmade feel.',
      ar: 'يشكّل كوب ماتشا ناعم وخفاقة خيزران طقسًا يوميًا هادئًا. يسقط ضوء النافذة الطبيعي على الخزف والكتان. حافظ على تدرجات خضراء واضحة وطبيعية وتكوين دافئ وبسيط بلمسة يدوية.',
    },
  '日常 · 茶饮': {
    en: 'Everyday · Tea',
    ar: 'يوميات · شاي',
  },
  '质感，藏在每个细节': {
    en: 'Quality in every detail',
    ar: 'الجودة في كل تفصيل',
  },
  '为一只棕色皮革手袋拍摄精致商品照片。真实皮纹、金属五金与缝线细节清晰，柔和暖光投射在简洁石灰色背景，经典而从容的构图。':
    {
      en: 'Photograph a refined brown leather handbag. Show authentic leather grain, metal hardware and stitching clearly. Soft warm light meets a simple limestone-gray background in a timeless, composed arrangement.',
      ar: 'صوّر حقيبة جلدية بنية أنيقة. أظهر ملمس الجلد الطبيعي والقطع المعدنية والخياطة بوضوح. يلتقي الضوء الدافئ الناعم بخلفية رمادية حجرية بسيطة في تكوين كلاسيكي ومتزن.',
    },
  '细节 · 配饰': {
    en: 'Details · Accessories',
    ar: 'تفاصيل · إكسسوارات',
  },
  全部: {
    en: 'All',
    ar: 'الكل',
  },
  '让好想法，有好作品。': {
    en: 'Great ideas deserve great work.',
    ar: 'الأفكار الجميلة تستحق أعمالًا جميلة.',
  },
  '从一份灵感出发，把脑海里的画面变成你的下一件作品。': {
    en: 'Start with inspiration and turn the image in your mind into your next creation.',
    ar: 'ابدأ بالإلهام وحوّل الصورة في خيالك إلى عملك القادم.',
  },
  为创作者而造: {
    en: 'Made for creators',
    ar: 'صُمّم للمبدعين',
  },
  探索灵感: {
    en: 'Explore inspiration',
    ar: 'استكشف الإلهام',
  },
  '不同风格，同样值得开始。': {
    en: 'Different styles. Every one a place to start.',
    ar: 'أساليب مختلفة، وكل منها بداية جديدة.',
  },
  显示全部灵感: {
    en: 'Show all inspiration',
    ar: 'عرض كل الإلهام',
  },
  仅显示已收藏: {
    en: 'Show favorites only',
    ar: 'عرض المفضّلة فقط',
  },
  搜索灵感: {
    en: 'Search inspiration',
    ar: 'البحث عن الإلهام',
  },
  '寻找灵感…': {
    en: 'Find inspiration…',
    ar: 'ابحث عن الإلهام…',
  },
  以此创作: {
    en: 'Create from this',
    ar: 'الإنشاء انطلاقًا من هذا',
  },
  灵感示例: {
    en: 'Inspiration example',
    ar: 'مثال إلهامي',
  },
  暂时没有匹配的灵感: {
    en: 'No matching inspiration',
    ar: 'لا توجد أمثلة مطابقة',
  },
  '试试其他关键词或分类。': {
    en: 'Try another keyword or category.',
    ar: 'جرّب كلمة أو فئة أخرى.',
  },
  '原创灵感素材 · 仅用于风格参考，非实时生成结果': {
    en: 'Original inspiration assets · Style references, not live generation results',
    ar: 'مواد إلهامية أصلية · مراجع للأسلوب وليست نتائج توليد مباشر',
  },
  灵感详情: {
    en: 'Inspiration details',
    ar: 'تفاصيل الإلهام',
  },
  '以这份灵感为起点，写出属于你的新想法。': {
    en: 'Use this inspiration as a starting point for your own idea.',
    ar: 'اجعل هذا الإلهام نقطة انطلاق لفكرتك الخاصة.',
  },
  '灵感示例 ·': {
    en: 'Inspiration example ·',
    ar: 'مثال إلهامي ·',
  },
  创作提示词: {
    en: 'Creative prompt',
    ar: 'وصف التوليد',
  },
  建议比例: {
    en: 'Suggested aspect ratio',
    ar: 'نسبة الأبعاد المقترحة',
  },
  使用方式: {
    en: 'How to use',
    ar: 'طريقة الاستخدام',
  },
  创建可编辑草稿: {
    en: 'Create an editable draft',
    ar: 'إنشاء مسودة قابلة للتعديل',
  },
  '此操作仅保存草稿。模型生成会在你确认报价后开始。': {
    en: 'This only saves a draft. Model generation starts after you confirm the quote.',
    ar: 'يحفظ هذا الإجراء مسودة فقط. يبدأ التوليد بعد تأكيد السعر.',
  },
  项目已保存: {
    en: 'Project saved',
    ar: 'تم حفظ المشروع',
  },
  '让每个想法都有自己的位置，随时回来继续创作。': {
    en: "Give every idea a home and return whenever you're ready to create.",
    ar: 'امنح كل فكرة مكانًا، وعد إليها متى أردت متابعة العمل.',
  },
  新建项目: {
    en: 'New project',
    ar: 'مشروع جديد',
  },
  项目类型: {
    en: 'Project type',
    ar: 'نوع المشروع',
  },
  全部类型: {
    en: 'All types',
    ar: 'كل الأنواع',
  },
  图片项目: {
    en: 'Image projects',
    ar: 'مشاريع الصور',
  },
  视频项目: {
    en: 'Video projects',
    ar: 'مشاريع الفيديو',
  },
  混合创作: {
    en: 'Mixed media',
    ar: 'وسائط مختلطة',
  },
  收藏: {
    en: 'Favorites',
    ar: 'المفضّلة',
  },
  回收站: {
    en: 'Trash',
    ar: 'سلة المحذوفات',
  },
  网格: {
    en: 'Grid',
    ar: 'شبكة',
  },
  列表: {
    en: 'List',
    ar: 'قائمة',
  },
  回收站是空的: {
    en: 'Trash is empty',
    ar: 'سلة المحذوفات فارغة',
  },
  '给下一个好想法，建一个项目': {
    en: 'Create a project for your next great idea',
    ar: 'أنشئ مشروعًا لفكرتك القادمة',
  },
  '项目会保存你的画布、版本和关联素材。': {
    en: 'Projects save your canvas, versions and linked assets.',
    ar: 'تحفظ المشاريع لوحتك وإصداراتها والمواد المرتبطة بها.',
  },
  创作画布: {
    en: 'Creative canvas',
    ar: 'لوحة التصميم',
  },
  更新: {
    en: 'Updated',
    ar: 'تم التحديث',
  },
  项目已恢复: {
    en: 'Project restored',
    ar: 'تمت استعادة المشروع',
  },
  恢复: {
    en: 'Restore',
    ar: 'استعادة',
  },
  取消收藏: {
    en: 'Remove from favorites',
    ar: 'إزالة من المفضّلة',
  },
  收藏项目: {
    en: 'Favorite project',
    ar: 'إضافة المشروع للمفضّلة',
  },
  编辑项目: {
    en: 'Edit project',
    ar: 'تعديل المشروع',
  },
  删除项目: {
    en: 'Delete project',
    ar: 'حذف المشروع',
  },
  项目名称: {
    en: 'Project name',
    ar: 'اسم المشروع',
  },
  图片: {
    en: 'Image',
    ar: 'صورة',
  },
  项目说明: {
    en: 'Project description',
    ar: 'وصف المشروع',
  },
  标签: {
    en: 'Tags',
    ar: 'الوسوم',
  },
  用逗号分隔: {
    en: 'Separate with commas',
    ar: 'افصل بفواصل',
  },
  保存项目: {
    en: 'Save project',
    ar: 'حفظ المشروع',
  },
  '将项目移入回收站？': {
    en: 'Move this project to trash?',
    ar: 'نقل هذا المشروع إلى سلة المحذوفات؟',
  },
  '项目内容会保留，可从回收站恢复。共用素材不会一同删除。': {
    en: 'Project content is kept and can be restored from trash. Shared assets are not deleted.',
    ar: 'يُحفظ محتوى المشروع ويمكن استعادته من السلة. لا تُحذف المواد المشتركة.',
  },
  项目已移入回收站: {
    en: 'Project moved to trash',
    ar: 'تم نقل المشروع إلى سلة المحذوفات',
  },
  所选素材已移入回收站: {
    en: 'Selected assets moved to trash',
    ar: 'تم نقل المواد المحددة إلى سلة المحذوفات',
  },
  原始文件已下载: {
    en: 'Original file downloaded',
    ar: 'تم تنزيل الملف الأصلي',
  },
  素材库: {
    en: 'Asset library',
    ar: 'مكتبة المواد',
  },
  '收集、整理、复用。让好的素材，成为下一次创作的起点。': {
    en: 'Collect, organize and reuse. Great assets can start your next creation.',
    ar: 'اجمع ونظّم وأعد الاستخدام. قد تبدأ أعمالك القادمة من موادك المفضّلة.',
  },
  新建集合: {
    en: 'New collection',
    ar: 'مجموعة جديدة',
  },
  '搜索素材…': {
    en: 'Search assets…',
    ar: 'البحث في المواد…',
  },
  素材类型: {
    en: 'Asset type',
    ar: 'نوع المادة',
  },
  素材集合: {
    en: 'Asset collections',
    ar: 'مجموعات المواد',
  },
  全部集合: {
    en: 'All collections',
    ar: 'كل المجموعات',
  },
  加入集合: {
    en: 'Add to collection',
    ar: 'إضافة إلى مجموعة',
  },
  取消选择: {
    en: 'Deselect',
    ar: 'إلغاء التحديد',
  },
  回收站暂无素材: {
    en: 'No assets in trash',
    ar: 'لا توجد مواد في سلة المحذوفات',
  },
  '好素材，是好创作的开始': {
    en: 'Great assets start great creations',
    ar: 'المواد الجيدة بداية الأعمال الجيدة',
  },
  '上传图片、视频、音频或参考文档，所有原件均保留。': {
    en: 'Upload images, video, audio or reference documents. Originals are preserved.',
    ar: 'ارفع صورًا أو فيديو أو صوتًا أو مستندات مرجعية. تُحفظ الملفات الأصلية.',
  },
  上传第一份素材: {
    en: 'Upload your first asset',
    ar: 'ارفع أول مادة',
  },
  素材已恢复: {
    en: 'Asset restored',
    ar: 'تمت استعادة المادة',
  },
  收藏素材: {
    en: 'Favorite asset',
    ar: 'إضافة المادة للمفضّلة',
  },
  素材详情: {
    en: 'Asset details',
    ar: 'تفاصيل المادة',
  },
  已提取正文: {
    en: 'Text extracted',
    ar: 'تم استخراج النص',
  },
  提取失败: {
    en: 'Extraction failed',
    ar: 'فشل الاستخراج',
  },
  正在提取: {
    en: 'Extracting',
    ar: 'جارٍ الاستخراج',
  },
  '文档原件已保存。': {
    en: 'The original document is saved.',
    ar: 'تم حفظ المستند الأصلي.',
  },
  '正文较长，当前显示经过截断的内容。': {
    en: 'This document is long. The displayed text is truncated.',
    ar: 'هذا المستند طويل. النص المعروض مختصر.',
  },
  素材信息已保存: {
    en: 'Asset details saved',
    ar: 'تم حفظ تفاصيل المادة',
  },
  名称: {
    en: 'Name',
    ar: 'الاسم',
  },
  文件格式: {
    en: 'File format',
    ar: 'صيغة الملف',
  },
  原件大小: {
    en: 'Original size',
    ar: 'حجم الملف الأصلي',
  },
  来源: {
    en: 'Source',
    ar: 'المصدر',
  },
  AI生成: {
    en: 'AI generated',
    ar: 'مولّد بالذكاء الاصطناعي',
  },
  本机处理: {
    en: 'Local processing',
    ar: 'معالجة محلية',
  },
  导入: {
    en: 'Import',
    ar: 'استيراد',
  },
  创建时间: {
    en: 'Created',
    ar: 'تاريخ الإنشاء',
  },
  下载: {
    en: 'Download',
    ar: 'تنزيل',
  },
  保存信息: {
    en: 'Save details',
    ar: 'حفظ التفاصيل',
  },
  新建素材集合: {
    en: 'New asset collection',
    ar: 'مجموعة مواد جديدة',
  },
  集合已创建: {
    en: 'Collection created',
    ar: 'تم إنشاء المجموعة',
  },
  集合名称: {
    en: 'Collection name',
    ar: 'اسم المجموعة',
  },
  创建集合: {
    en: 'Create collection',
    ar: 'إنشاء مجموعة',
  },
  加入素材集合: {
    en: 'Add to asset collection',
    ar: 'إضافة إلى مجموعة مواد',
  },
  '现有素材会保留，新选择的素材会合并加入。': {
    en: 'Existing assets are kept. Newly selected assets will be added.',
    ar: 'تبقى المواد الحالية وتُضاف إليها المواد المحددة حديثًا.',
  },
  '该集合超过100项，请先在集合管理中整理，避免覆盖已有素材。': {
    en: 'This collection has over 100 items. Organize it in collection management first to avoid replacing existing assets.',
    ar: 'تحتوي المجموعة على أكثر من 100 عنصر. نظّمها أولًا من إدارة المجموعات لتجنب استبدال المواد الموجودة.',
  },
  素材已加入集合: {
    en: 'Assets added to collection',
    ar: 'تمت إضافة المواد إلى المجموعة',
  },
  请先创建一个集合: {
    en: 'Create a collection first',
    ar: 'أنشئ مجموعة أولًا',
  },
  '素材将移入回收站。引用这些素材的画布可能显示缺失，可通过恢复素材重新显示。': {
    en: 'Assets will move to trash. Canvases referencing them may show missing content until the assets are restored.',
    ar: 'ستُنقل المواد إلى السلة. قد تعرض اللوحات المرتبطة بها محتوى مفقودًا إلى أن تُستعاد المواد.',
  },
  '把想象，': {
    en: 'Turn imagination',
    ar: 'حوّل الخيال',
  },
  '变成看得见的作品。': {
    en: 'into something you can see.',
    ar: 'إلى عمل تراه.',
  },
  '图片、视频与品牌资产，在一个安静、专注的创作空间里发生。': {
    en: 'Images, video and brand assets, together in a calm space for focused creation.',
    ar: 'صور وفيديو ومواد للعلامة التجارية في مساحة هادئة للإبداع المركّز.',
  },
  自然风格产品摄影灵感: {
    en: 'Natural product photography inspiration',
    ar: 'إلهام لتصوير المنتجات بطابع طبيعي',
  },
  琥珀香水摄影灵感: {
    en: 'Amber perfume photography inspiration',
    ar: 'إلهام لتصوير عطر كهرماني',
  },
  '原创灵感示例 · 映造 Studio': {
    en: 'Original inspiration example · Yingzao Studio',
    ar: 'مثال إلهامي أصلي · استوديو Yingzao',
  },
  创建你的工作空间: {
    en: 'Create your workspace',
    ar: 'أنشئ مساحة عملك',
  },
  欢迎回到映造: {
    en: 'Welcome back to Yingzao',
    ar: 'مرحبًا بعودتك إلى Yingzao',
  },
  '用一个账户，开始有序而自由的创作。': {
    en: 'One account for organized, open-ended creation.',
    ar: 'حساب واحد لإبداع منظم وحر.',
  },
  '登录后继续你的创作与项目。': {
    en: 'Sign in to continue your creations and projects.',
    ar: 'سجّل الدخول لمتابعة أعمالك ومشاريعك.',
  },
  你的称呼: {
    en: 'Your name',
    ar: 'اسمك',
  },
  邮箱: {
    en: 'Email',
    ar: 'البريد الإلكتروني',
  },
  密码: {
    en: 'Password',
    ar: 'كلمة المرور',
  },
  '至少12位，建议混合字母、数字和符号。': {
    en: 'At least 12 characters. Use a mix of letters, numbers and symbols.',
    ar: '12 حرفًا على الأقل. يُفضّل الجمع بين الحروف والأرقام والرموز.',
  },
  创建并开始创作: {
    en: 'Create account and start',
    ar: 'إنشاء حساب والبدء',
  },
  登录工作空间: {
    en: 'Sign in to workspace',
    ar: 'تسجيل الدخول إلى مساحة العمل',
  },
  '已有账户？返回登录': {
    en: 'Already have an account? Sign in',
    ar: 'لديك حساب؟ سجّل الدخول',
  },
  创建新账户: {
    en: 'Create an account',
    ar: 'إنشاء حساب',
  },
  '你的原始素材与创作记录保存在所属工作空间。': {
    en: 'Your original assets and creative history are stored in their workspace.',
    ar: 'تُحفظ موادك الأصلية وسجل أعمالك في مساحة العمل التابعة لها.',
  },
  '首次启动：创建者将成为此本地实例的管理员。': {
    en: "First launch: the creator becomes this local instance's administrator.",
    ar: 'عند التشغيل الأول: يصبح المنشئ مسؤول هذه النسخة المحلية.',
  },
  '分享链接缺少访问令牌。': {
    en: 'This share link is missing an access token.',
    ar: 'رابط المشاركة يفتقد رمز الوصول.',
  },
  '部分分享素材不可用，可能已撤销或过期。': {
    en: 'Some shared assets are unavailable. Access may have been revoked or expired.',
    ar: 'بعض المواد المشتركة غير متاحة. ربما أُلغي الوصول أو انتهت صلاحيته.',
  },
  分享素材: {
    en: 'Shared asset',
    ar: 'مادة مشتركة',
  },
  只读分享: {
    en: 'Read-only share',
    ar: 'مشاركة للقراءة فقط',
  },
  '正在加载分享内容…': {
    en: 'Loading shared content…',
    ar: 'جارٍ تحميل المحتوى المشترك…',
  },
  加入一个新的创作团队: {
    en: 'Join a new creative team',
    ar: 'انضم إلى فريق إبداعي جديد',
  },
  '当前账户：': {
    en: 'Current account:',
    ar: 'الحساب الحالي:',
  },
  '邀请只能由指定邮箱使用。成功加入后，团队资料会独立于你的个人空间。': {
    en: 'Only the invited email can use this invitation. Team content stays separate from your personal workspace.',
    ar: 'لا يستخدم الدعوة إلا البريد المحدد. يبقى محتوى الفريق منفصلًا عن مساحة عملك الشخصية.',
  },
  已加入团队: {
    en: 'Joined the team',
    ar: 'تم الانضمام إلى الفريق',
  },
  接受邀请并进入团队: {
    en: 'Accept invitation and join',
    ar: 'قبول الدعوة والانضمام',
  },
  返回工作空间: {
    en: 'Back to workspace',
    ar: 'العودة إلى مساحة العمل',
  },
  '管理个人偏好与工作空间的生成服务。': {
    en: 'Manage personal preferences and workspace generation services.',
    ar: 'أدِر تفضيلاتك الشخصية وخدمات التوليد في مساحة العمل.',
  },
  个人偏好: {
    en: 'Preferences',
    ar: 'التفضيلات',
  },
  生成服务: {
    en: 'Generation services',
    ar: 'خدمات التوليد',
  },
  个人资料: {
    en: 'Profile',
    ar: 'الملف الشخصي',
  },
  '这些信息只在你的账户与授权的工作空间中显示。': {
    en: 'These details appear only in your account and authorized workspaces.',
    ar: 'تظهر هذه المعلومات في حسابك ومساحات العمل المصرّح بها فقط.',
  },
  个人偏好已保存: {
    en: 'Preferences saved',
    ar: 'تم حفظ التفضيلات',
  },
  显示名称: {
    en: 'Display name',
    ar: 'الاسم المعروض',
  },
  账户邮箱: {
    en: 'Account email',
    ar: 'بريد الحساب',
  },
  界面主题: {
    en: 'Theme',
    ar: 'المظهر',
  },
  跟随系统: {
    en: 'System',
    ar: 'حسب النظام',
  },
  浅色: {
    en: 'Light',
    ar: 'فاتح',
  },
  深色: {
    en: 'Dark',
    ar: 'داكن',
  },
  界面语言: {
    en: 'Interface language',
    ar: 'لغة الواجهة',
  },
  简体中文: {
    en: 'Simplified Chinese',
    ar: 'الصينية المبسطة',
  },
  生成前显示配置与费用确认: {
    en: 'Show settings and cost confirmation before generation',
    ar: 'عرض الإعدادات وتأكيد التكلفة قبل التوليد',
  },
  '涉及额度预留的任务始终显示最终报价，确保执行内容清楚可见。': {
    en: 'Tasks that reserve credits always show a final quote so you can review what will be executed.',
    ar: 'تعرض المهام التي تحجز أرصدة السعر النهائي دائمًا لتراجع ما سيُنفّذ.',
  },
  保存设置: {
    en: 'Save settings',
    ar: 'حفظ الإعدادات',
  },
  账户安全: {
    en: 'Account security',
    ar: 'أمان الحساب',
  },
  '会话通过受保护的 Cookie 管理。退出其他会话后，它们需要重新登录。': {
    en: 'Sessions use protected cookies. Other sessions must sign in again after you sign them out.',
    ar: 'تستخدم الجلسات ملفات تعريف ارتباط محمية. بعد إنهاء الجلسات الأخرى، ستحتاج إلى تسجيل الدخول مجددًا.',
  },
  其他会话已退出: {
    en: 'Other sessions signed out',
    ar: 'تم إنهاء الجلسات الأخرى',
  },
  退出其他会话: {
    en: 'Sign out other sessions',
    ar: 'إنهاء الجلسات الأخرى',
  },
  外部账户登录: {
    en: 'External account sign-in',
    ar: 'تسجيل الدخول بحساب خارجي',
  },
  '当前使用本地邮箱与密码。短信与第三方登录需要实际身份服务配置，不会发送演示验证码。': {
    en: 'This instance uses local email and password. SMS and third-party sign-in require an identity service; no demo verification codes are sent.',
    ar: 'تستخدم هذه النسخة البريد وكلمة المرور محليًا. تتطلب الرسائل النصية والحسابات الخارجية خدمة هوية فعلية؛ لا تُرسل رموز تجريبية.',
  },
  服务配置由空间管理员管理: {
    en: 'Workspace admins manage service settings',
    ar: 'يدير مسؤولو مساحة العمل إعدادات الخدمات',
  },
  '你可以继续编辑草稿；需要新增服务时，请联系当前空间的创建者或管理员。': {
    en: 'You can keep editing drafts. Contact the workspace owner or an admin to add a service.',
    ar: 'يمكنك متابعة تعديل المسودات. تواصل مع المالك أو المسؤول لإضافة خدمة.',
  },
  '密钥仅在服务端使用。配置与真实调用验证分别显示；连接状态不代表已进行过付费生成。': {
    en: 'Keys are used only on the server. Configuration and live verification are shown separately; a connected status does not mean paid generation has been tested.',
    ar: 'تُستخدم المفاتيح على الخادم فقط. يُعرض الإعداد والتحقق الفعلي منفصلين؛ الاتصال لا يعني اختبار توليد مدفوع.',
  },
  已连接: {
    en: 'Connected',
    ar: 'متصل',
  },
  未连接: {
    en: 'Not connected',
    ar: 'غير متصل',
  },
  图片生成与文案辅助: {
    en: 'Image generation and writing assistance',
    ar: 'توليد الصور والمساعدة في الكتابة',
  },
  视频生成与素材参考: {
    en: 'Video generation and references',
    ar: 'توليد الفيديو والمراجع',
  },
  电商图片创作与处理工具: {
    en: 'Ecommerce image creation and editing tools',
    ar: 'إنشاء صور التجارة الإلكترونية وأدوات تعديلها',
  },
  密钥状态: {
    en: 'Key status',
    ar: 'حالة المفتاح',
  },
  尚未配置: {
    en: 'Not yet configured',
    ar: 'لم يتم الإعداد بعد',
  },
  真实调用: {
    en: 'Live requests',
    ar: 'الاستدعاءات الفعلية',
  },
  已经验证: {
    en: 'Verified',
    ar: 'تم التحقق',
  },
  尚未验证: {
    en: 'Not yet verified',
    ar: 'لم يتم التحقق بعد',
  },
  配置来源: {
    en: 'Configuration source',
    ar: 'مصدر الإعداد',
  },
  当前空间: {
    en: 'This workspace',
    ar: 'مساحة العمل الحالية',
  },
  实例环境: {
    en: 'Instance environment',
    ar: 'بيئة النسخة',
  },
  未配置: {
    en: 'Not configured',
    ar: 'غير مُعدّ',
  },
  管理连接: {
    en: 'Manage connection',
    ar: 'إدارة الاتصال',
  },
  能力与服务状态: {
    en: 'Capabilities and service status',
    ar: 'الإمكانات وحالة الخدمات',
  },
  实时能力清单: {
    en: 'Current capabilities',
    ar: 'الإمكانات الحالية',
  },
  能力: {
    en: 'Capability',
    ar: 'الإمكانية',
  },
  服务: {
    en: 'Service',
    ar: 'الخدمة',
  },
  说明: {
    en: 'Description',
    ar: 'الوصف',
  },
  可用: {
    en: 'Available',
    ar: 'متاح',
  },
  按提交前报价执行: {
    en: 'Uses the quote confirmed before submission',
    ar: 'يُنفّذ وفق السعر المؤكد قبل الإرسال',
  },
  '密钥不会在保存后回显，也不会写入浏览器存储。': {
    en: 'Saved keys are never displayed again or stored in the browser.',
    ar: 'لا تُعرض المفاتيح المحفوظة مجددًا ولا تُخزّن في المتصفح.',
  },
  服务配置已保存: {
    en: 'Service settings saved',
    ar: 'تم حفظ إعدادات الخدمة',
  },
  服务密钥: {
    en: 'Service key',
    ar: 'مفتاح الخدمة',
  },
  '留空保留已有密钥；填写新密钥则替换。': {
    en: 'Leave blank to keep the current key, or enter a new key to replace it.',
    ar: 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي، أو أدخل مفتاحًا جديدًا لاستبداله.',
  },
  '填写供应商提供的真实服务密钥。': {
    en: 'Enter the actual key supplied by your provider.',
    ar: 'أدخل المفتاح الفعلي الذي يقدمه المزوّد.',
  },
  启用此连接: {
    en: 'Enable this connection',
    ar: 'تفعيل هذا الاتصال',
  },
  移除当前空间保存的密钥: {
    en: "Remove this workspace's saved key",
    ar: 'إزالة المفتاح المحفوظ لمساحة العمل',
  },
  '保存配置不会提交生成任务。外部服务费用以供应商账单为准。': {
    en: "Saving settings does not start generation. External service charges follow the provider's billing.",
    ar: 'حفظ الإعدادات لا يبدأ التوليد. تعتمد رسوم الخدمات الخارجية على فاتورة المزوّد.',
  },
  保存连接: {
    en: 'Save connection',
    ar: 'حفظ الاتصال',
  },
  '如何开始第一次创作？': {
    en: 'How do I start my first creation?',
    ar: 'كيف أبدأ أول عمل؟',
  },
  '在灵感广场输入需求，或打开一张灵感卡片创建草稿。选择图片或视频、模型与参考素材，连接服务后查看报价并确认执行。未连接服务时仍可保存草稿、管理素材和编辑画布。':
    {
      en: 'Enter a brief in Inspiration or open a card to create a draft. Choose image or video, a model and references. Connect a service, review the quote and confirm. You can save drafts, manage assets and edit canvases without a connected service.',
      ar: 'اكتب طلبك في صفحة الإلهام أو افتح بطاقة لإنشاء مسودة. اختر صورة أو فيديو ونموذجًا ومراجع، ثم صِل خدمة وراجع السعر وأكّد. يمكنك حفظ المسودات وإدارة المواد وتعديل اللوحات دون خدمة متصلة.',
    },
  '额度与供应商费用有什么区别？': {
    en: 'How do credits differ from provider charges?',
    ar: 'ما الفرق بين الأرصدة ورسوم المزوّد؟',
  },
  '工作空间额度用于控制任务预算和记录使用情况。接入的模型服务可能另行收费，以供应商账单为准。开发演示空间的额度明确标为本机测试额度，不表示真实付款或赠款。':
    {
      en: "Workspace credits control task budgets and track usage. Connected model services may charge separately. Check the provider's bill. Demo credits are labeled local test credits and do not represent payments or grants.",
      ar: 'تضبط أرصدة مساحة العمل ميزانيات المهام وتسجل الاستخدام. قد تفرض خدمات النماذج رسومًا منفصلة حسب فواتيرها. تُسمّى أرصدة العرض أرصدة اختبار محلية ولا تمثل مدفوعات أو منحًا حقيقية.',
    },
  '部分成功或等待核对是什么意思？': {
    en: 'What do partial completion and awaiting reconciliation mean?',
    ar: 'ماذا يعني الاكتمال الجزئي وانتظار التحقق؟',
  },
  '批量任务逐项保存结果。部分成功时，已经完成的素材仍然可用。等待核对表示远端请求结果尚不明确，系统会保留预留额度以避免重复执行，需要确认远端结果后结算。':
    {
      en: 'Batch results are saved individually, so completed assets remain available. Awaiting reconciliation means the remote result is unclear. Credits stay reserved to avoid duplicate execution until the result is confirmed.',
      ar: 'تُحفظ نتائج الدفعة بشكل منفصل فتبقى المواد المكتملة متاحة. انتظار التحقق يعني أن نتيجة الخدمة الخارجية غير مؤكدة؛ تبقى الأرصدة محجوزة لتجنب تكرار التنفيذ حتى تتأكد النتيجة.',
    },
  '我的图片与文档会保存在哪里？': {
    en: 'Where are my images and documents stored?',
    ar: 'أين تُحفظ صوري ومستنداتي؟',
  },
  '素材原件保存在你部署的映造实例中，访问受工作空间权限限制。预览与缩略图独立于原件。上传的文本、PDF、DOCX会尝试提取参考正文，解析失败会明确显示原因。':
    {
      en: 'Originals are stored in your deployed Yingzao instance and protected by workspace permissions. Previews and thumbnails are separate. Text, PDF and DOCX uploads are processed for reference text; extraction failures show a reason.',
      ar: 'تُحفظ الملفات الأصلية في نسخة Yingzao التي نشرتها، وتحميها صلاحيات مساحة العمل. المعاينات والمصغرات منفصلة. تُعالج ملفات النص وPDF وDOCX لاستخراج نص مرجعي، ويظهر سبب أي فشل.',
    },
  '如何恢复误删的项目或素材？': {
    en: 'How do I restore deleted projects or assets?',
    ar: 'كيف أستعيد المشاريع أو المواد المحذوفة؟',
  },
  '打开项目或素材页的回收站，找到对应条目并恢复。删除不会立即清理原始文件；恢复素材后，引用它的画布可重新显示。':
    {
      en: 'Open trash on the project or asset page and restore the item. Deletion does not immediately remove original files. Restoring an asset makes it visible again on canvases that reference it.',
      ar: 'افتح سلة المحذوفات في صفحة المشاريع أو المواد واستعد العنصر. لا يزيل الحذف الملفات الأصلية فورًا. عند استعادة المادة تظهر مجددًا في اللوحات المرتبطة بها.',
    },
  '品牌与人物会训练模型吗？': {
    en: 'Do brands and characters train models?',
    ar: 'هل تدرّب العلامات والشخصيات نماذج؟',
  },
  '品牌保存色板、字体和风格参考图，人物保存角色参考素材。它们是创作输入，不代表模型训练或身份认证。依赖真实认证的能力会单独检查状态。':
    {
      en: 'Brands store colors, fonts and visual references; characters store reference assets. These are creative inputs, not model training or identity verification. Capabilities requiring verification check it separately.',
      ar: 'تحفظ العلامات الألوان والخطوط والمراجع، وتحفظ الشخصيات موادها المرجعية. هي مدخلات إبداعية وليست تدريبًا للنماذج أو توثيقًا للهوية. تتحقق الإمكانات التي تتطلب توثيقًا من حالته منفصلًا.',
    },
  '让每一次创作都走得更顺畅。': {
    en: 'Make every creative step easier.',
    ar: 'اجعل كل خطوة إبداعية أسهل.',
  },
  提交工单: {
    en: 'Submit a ticket',
    ar: 'إرسال تذكرة',
  },
  使用帮助: {
    en: 'Help',
    ar: 'المساعدة',
  },
  我的工单: {
    en: 'My tickets',
    ar: 'تذاكري',
  },
  邀请与奖励: {
    en: 'Invitations and rewards',
    ar: 'الدعوات والمكافآت',
  },
  连接创作服务: {
    en: 'Connect a creative service',
    ar: 'توصيل خدمة إبداعية',
  },
  '从配置真实模型服务开始。': {
    en: 'Start by configuring a real model service.',
    ar: 'ابدأ بإعداد خدمة نموذج فعلية.',
  },
  '管理服务 ↗': {
    en: 'Manage services ↗',
    ar: 'إدارة الخدمات ↗',
  },
  开发者文档: {
    en: 'Developer documentation',
    ar: 'توثيق المطوّرين',
  },
  '让你的应用接入创作工作空间。': {
    en: 'Connect your app to the creative workspace.',
    ar: 'صِل تطبيقك بمساحة العمل الإبداعية.',
  },
  '查看开发者入口 ↗': {
    en: 'Open developer portal ↗',
    ar: 'فتح بوابة المطوّرين ↗',
  },
  分享你的建议: {
    en: 'Share your suggestions',
    ar: 'شارك اقتراحاتك',
  },
  '把遇到的问题或新的想法告诉我们。': {
    en: 'Tell us about an issue or a new idea.',
    ar: 'أخبرنا بمشكلة أو فكرة جديدة.',
  },
  '提交反馈 ↗': {
    en: 'Send feedback ↗',
    ar: 'إرسال ملاحظات ↗',
  },
  常见问题: {
    en: 'Frequently asked questions',
    ar: 'الأسئلة الشائعة',
  },
  主题: {
    en: 'Subject',
    ar: 'الموضوع',
  },
  类型: {
    en: 'Type',
    ar: 'النوع',
  },
  反馈: {
    en: 'Feedback',
    ar: 'ملاحظات',
  },
  申诉: {
    en: 'Appeal',
    ar: 'اعتراض',
  },
  支持: {
    en: 'Support',
    ar: 'دعم',
  },
  查看记录: {
    en: 'View history',
    ar: 'عرض السجل',
  },
  暂时没有工单: {
    en: 'No tickets yet',
    ar: 'لا توجد تذاكر بعد',
  },
  '可以提交反馈、支持请求，或关联任务发起申诉。': {
    en: 'Submit feedback or a support request, or link a task to an appeal.',
    ar: 'أرسل ملاحظات أو طلب دعم، أو اربط مهمة باعتراض.',
  },
  有效邀请: {
    en: 'Valid invitations',
    ar: 'الدعوات الصالحة',
  },
  已获得奖励额度: {
    en: 'Reward credits earned',
    ar: 'أرصدة المكافآت المكتسبة',
  },
  你的邀请链接: {
    en: 'Your invitation link',
    ar: 'رابط دعوتك',
  },
  邀请链接已复制: {
    en: 'Invitation link copied',
    ar: 'تم نسخ رابط الدعوة',
  },
  复制邀请链接: {
    en: 'Copy invitation link',
    ar: 'نسخ رابط الدعوة',
  },
  '邀请奖励规则尚未启用。当前没有现金或额度奖励承诺，真实奖励启用后会在这里列出条件与记录。': {
    en: 'Referral rewards are not enabled. No cash or credit rewards are promised. Conditions and records will appear here when real rewards are enabled.',
    ar: 'مكافآت الدعوات غير مفعّلة. لا يوجد وعد بمكافآت نقدية أو أرصدة. ستظهر الشروط والسجلات هنا عند تفعيل مكافآت فعلية.',
  },
  '记录保存在当前工作空间。未接入客服渠道时，提交不代表已发送给外部客服。': {
    en: 'Records stay in this workspace. Without a connected support channel, submitting does not send them to an external support team.',
    ar: 'تبقى السجلات في مساحة العمل. دون قناة دعم متصلة، لا يعني الإرسال وصولها إلى فريق دعم خارجي.',
  },
  '工单已保存，状态为待处理': {
    en: 'Ticket saved as pending',
    ar: 'تم حفظ التذكرة بانتظار المعالجة',
  },
  问题类型: {
    en: 'Issue type',
    ar: 'نوع المشكلة',
  },
  使用支持: {
    en: 'Usage support',
    ar: 'دعم الاستخدام',
  },
  产品反馈: {
    en: 'Product feedback',
    ar: 'ملاحظات المنتج',
  },
  任务申诉: {
    en: 'Task appeal',
    ar: 'اعتراض على مهمة',
  },
  详细说明: {
    en: 'Detailed description',
    ar: 'وصف تفصيلي',
  },
  '关联任务 ID（可选）': {
    en: 'Related task ID (optional)',
    ar: 'معرّف المهمة المرتبطة (اختياري)',
  },
  可从任务详情复制: {
    en: 'Copy it from task details',
    ar: 'انسخه من تفاصيل المهمة',
  },
  工单详情: {
    en: 'Ticket details',
    ar: 'تفاصيل التذكرة',
  },
  补充说明已保存: {
    en: 'Additional information saved',
    ar: 'تم حفظ المعلومات الإضافية',
  },
  补充说明: {
    en: 'Additional information',
    ar: 'معلومات إضافية',
  },
  工单已撤回: {
    en: 'Ticket withdrawn',
    ar: 'تم سحب التذكرة',
  },
  撤回工单: {
    en: 'Withdraw ticket',
    ar: 'سحب التذكرة',
  },
  保存补充: {
    en: 'Save additional information',
    ar: 'حفظ المعلومات الإضافية',
  },
  创建者: {
    en: 'Owner',
    ar: 'المالك',
  },
  管理员: {
    en: 'Administrator',
    ar: 'المسؤول',
  },
  所有权已转让: {
    en: 'Ownership transferred',
    ar: 'تم نقل الملكية',
  },
  空间状态已更新: {
    en: 'Workspace status updated',
    ar: 'تم تحديث حالة مساحة العمل',
  },
  '共享创作空间，让成员、素材和用量井然有序。': {
    en: 'A shared creative space for organized members, assets and usage.',
    ar: 'مساحة إبداعية مشتركة لتنظيم الأعضاء والمواد والاستخدام.',
  },
  导入成员: {
    en: 'Import members',
    ar: 'استيراد أعضاء',
  },
  邀请成员: {
    en: 'Invite members',
    ar: 'دعوة أعضاء',
  },
  '好作品，和好伙伴一起完成。': {
    en: 'Create great work with great people.',
    ar: 'أنجز أعمالًا جميلة مع شركاء مبدعين.',
  },
  '创建独立的团队空间，共享项目与素材，为不同成员设置角色和额度上限。': {
    en: 'Create a separate team workspace, share projects and assets, and set member roles and credit limits.',
    ar: 'أنشئ مساحة مستقلة للفريق وشارك المشاريع والمواد وحدد أدوار الأعضاء وحدود أرصدتهم.',
  },
  角色与权限: {
    en: 'Roles and permissions',
    ar: 'الأدوار والصلاحيات',
  },
  共享资产: {
    en: 'Shared assets',
    ar: 'المواد المشتركة',
  },
  成员预算: {
    en: 'Member budgets',
    ar: 'ميزانيات الأعضاء',
  },
  '位成员 ·': {
    en: ' members ·',
    ar: ' أعضاء ·',
  },
  成员表已导出: {
    en: 'Member list exported',
    ar: 'تم تصدير قائمة الأعضاء',
  },
  导出成员: {
    en: 'Export members',
    ar: 'تصدير الأعضاء',
  },
  团队成员: {
    en: 'Team members',
    ar: 'أعضاء الفريق',
  },
  邀请记录: {
    en: 'Invitation history',
    ar: 'سجل الدعوات',
  },
  活动日志: {
    en: 'Activity log',
    ar: 'سجل النشاط',
  },
  团队设置: {
    en: 'Team settings',
    ar: 'إعدادات الفريق',
  },
  '搜索成员名称…': {
    en: 'Search member names…',
    ar: 'البحث بأسماء الأعضاء…',
  },
  搜索成员: {
    en: 'Search members',
    ar: 'البحث في الأعضاء',
  },
  成员预算包含已用与预留额度: {
    en: 'Member budgets include used and reserved credits',
    ar: 'تشمل ميزانيات الأعضاء الأرصدة المستخدمة والمحجوزة',
  },
  角色: {
    en: 'Role',
    ar: 'الدور',
  },
  备注: {
    en: 'Note',
    ar: 'ملاحظة',
  },
  加入时间: {
    en: 'Joined',
    ar: 'تاريخ الانضمام',
  },
  邮箱受权限保护: {
    en: 'Email is protected by permissions',
    ar: 'البريد محمي بالصلاحيات',
  },
  有效期: {
    en: 'Validity',
    ar: 'مدة الصلاحية',
  },
  已加入: {
    en: 'Joined',
    ar: 'تم الانضمام',
  },
  待加入: {
    en: 'Pending',
    ar: 'بانتظار الانضمام',
  },
  邀请已撤销: {
    en: 'Invitation revoked',
    ar: 'تم إلغاء الدعوة',
  },
  还没有邀请记录: {
    en: 'No invitations yet',
    ar: 'لا توجد دعوات بعد',
  },
  '邀请链接仅创建时显示，可复制后自行发送。': {
    en: 'Invitation links are shown only when created. Copy and send them yourself.',
    ar: 'تظهر روابط الدعوات عند إنشائها فقط. انسخها وأرسلها بنفسك.',
  },
  操作: {
    en: 'Action',
    ar: 'الإجراء',
  },
  资源类型: {
    en: 'Resource type',
    ar: 'نوع المورد',
  },
  时间: {
    en: 'Time',
    ar: 'الوقت',
  },
  暂时没有活动记录: {
    en: 'No activity yet',
    ar: 'لا يوجد نشاط بعد',
  },
  空间资料: {
    en: 'Workspace details',
    ar: 'تفاصيل مساحة العمل',
  },
  团队名称已保存: {
    en: 'Team name saved',
    ar: 'تم حفظ اسم الفريق',
  },
  保存: {
    en: 'Save',
    ar: 'حفظ',
  },
  成员额度: {
    en: 'Member credits',
    ar: 'أرصدة الأعضاء',
  },
  '可以在成员管理中设置预算上限，在用量页面查看预留与结算记录。': {
    en: 'Set budget limits in member management. View reservations and settlements on the usage page.',
    ar: 'حدد الميزانيات من إدارة الأعضاء، واعرض الحجوزات والتسويات في صفحة الاستخدام.',
  },
  查看用量: {
    en: 'View usage',
    ar: 'عرض الاستخدام',
  },
  团队生命周期: {
    en: 'Team lifecycle',
    ar: 'إدارة دورة حياة الفريق',
  },
  转让给另一位成员: {
    en: 'Transfer to another member',
    ar: 'النقل إلى عضو آخر',
  },
  选择接任创建者: {
    en: 'Choose the new owner',
    ar: 'اختيار المالك الجديد',
  },
  转让所有权: {
    en: 'Transfer ownership',
    ar: 'نقل الملكية',
  },
  解散团队: {
    en: 'Dissolve team',
    ar: 'حل الفريق',
  },
  '仅创建者可解散。系统会检查在途任务与待处理订单，内容会归档保留。': {
    en: 'Only the owner can dissolve the team. Active tasks and pending orders are checked, and content is archived.',
    ar: 'يمكن للمالك وحده حل الفريق. تُفحص المهام الجارية والطلبات المعلّقة ويُؤرشف المحتوى.',
  },
  解散并归档: {
    en: 'Dissolve and archive',
    ar: 'حل وأرشفة',
  },
  '退出后将无法访问此团队的项目与素材，团队原件不会复制到个人空间。': {
    en: "You will lose access to this team's projects and assets. Team originals are not copied to your personal workspace.",
    ar: 'ستفقد الوصول إلى مشاريع الفريق ومواده. لن تُنسخ ملفاته الأصلية إلى مساحة عملك الشخصية.',
  },
  退出团队: {
    en: 'Leave team',
    ar: 'مغادرة الفريق',
  },
  团队已创建: {
    en: 'Team created',
    ar: 'تم إنشاء الفريق',
  },
  邀请团队成员: {
    en: 'Invite team members',
    ar: 'دعوة أعضاء للفريق',
  },
  '生成专属链接，不会自动发送邮件。仅指定邮箱的账户可以加入。': {
    en: 'Create a unique link without sending email automatically. Only the specified email can join.',
    ar: 'أنشئ رابطًا خاصًا دون إرسال بريد تلقائي. لا يمكن الانضمام إلا بالبريد المحدد.',
  },
  成员邮箱: {
    en: 'Member email',
    ar: 'بريد العضو',
  },
  加入角色: {
    en: 'Joining role',
    ar: 'الدور عند الانضمام',
  },
  天: {
    en: 'days',
    ar: 'أيام',
  },
  创建邀请链接: {
    en: 'Create invitation link',
    ar: 'إنشاء رابط دعوة',
  },
  邀请链接已创建: {
    en: 'Invitation link created',
    ar: 'تم إنشاء رابط الدعوة',
  },
  '复制链接后自行发送给成员。关闭后不会再次显示完整令牌。': {
    en: 'Copy and send the link to the member yourself. The full token will not be shown again after closing.',
    ar: 'انسخ الرابط وأرسله إلى العضو بنفسك. لن يظهر الرمز الكامل مجددًا بعد الإغلاق.',
  },
  专属邀请链接: {
    en: 'Unique invitation link',
    ar: 'رابط الدعوة الخاص',
  },
  复制链接: {
    en: 'Copy link',
    ar: 'نسخ الرابط',
  },
  管理成员: {
    en: 'Manage member',
    ar: 'إدارة العضو',
  },
  成员设置已保存: {
    en: 'Member settings saved',
    ar: 'تم حفظ إعدادات العضو',
  },
  成员角色: {
    en: 'Member role',
    ar: 'دور العضو',
  },
  备注名称: {
    en: 'Display note',
    ar: 'اسم ملاحظات',
  },
  额度上限: {
    en: 'Credit limit',
    ar: 'حد الأرصدة',
  },
  '留空使用共享额度；不能低于已使用与预留的额度。': {
    en: 'Leave blank for shared credits. The limit cannot be lower than credits already used and reserved.',
    ar: 'اتركه فارغًا لاستخدام الأرصدة المشتركة. لا يمكن أن يقل الحد عن الأرصدة المستخدمة والمحجوزة.',
  },
  保存成员设置: {
    en: 'Save member settings',
    ar: 'حفظ إعدادات العضو',
  },
  '移除团队成员？': {
    en: 'Remove this team member?',
    ar: 'إزالة هذا العضو من الفريق؟',
  },
  '此成员将立即失去空间访问权限，其团队素材会保留。': {
    en: 'This member will immediately lose workspace access. Their team assets are kept.',
    ar: 'سيفقد هذا العضو الوصول فورًا. تبقى مواده التابعة للفريق محفوظة.',
  },
  成员已移除: {
    en: 'Member removed',
    ar: 'تمت إزالة العضو',
  },
  '确认转让所有权？': {
    en: 'Confirm ownership transfer?',
    ar: 'تأكيد نقل الملكية؟',
  },
  '确认解散并归档团队？': {
    en: 'Dissolve and archive this team?',
    ar: 'حل هذا الفريق وأرشفته؟',
  },
  '确认退出团队？': {
    en: 'Leave this team?',
    ar: 'مغادرة هذا الفريق؟',
  },
  '你将变为管理员。新的创建者将有权解散团队与转让所有权。': {
    en: 'You will become an administrator. The new owner can dissolve the team and transfer ownership.',
    ar: 'ستصبح مسؤولًا. سيتمكن المالك الجديد من حل الفريق ونقل الملكية.',
  },
  '此操作会改变团队访问权限。尚有在途任务或未结账业务时，系统将阻止操作。': {
    en: 'This changes team access. Active tasks or unsettled business will block the operation.',
    ar: 'يغيّر هذا صلاحيات الوصول للفريق. ستمنع المهام الجارية أو المعاملات غير المسوّاة تنفيذ العملية.',
  },
  成员批量导入: {
    en: 'Bulk member import',
    ar: 'استيراد أعضاء دفعة واحدة',
  },
  '行有效，': {
    en: ' valid rows, ',
    ar: ' صفوف صالحة، ',
  },
  '行需要修正。导入不会自动发送邀请。已有成员仅更新备注与预算。': {
    en: ' rows need corrections. Invitations are not sent automatically. Existing members only receive note and budget updates.',
    ar: ' صفوف تحتاج إلى تصحيح. لا تُرسل الدعوات تلقائيًا. يُحدّث للأعضاء الحاليين الملاحظات والميزانيات فقط.',
  },
  行: {
    en: 'Row',
    ar: 'الصف',
  },
  校验: {
    en: 'Validation',
    ar: 'التحقق',
  },
  可导入: {
    en: 'Ready to import',
    ar: 'جاهز للاستيراد',
  },
  模板已下载: {
    en: 'Template downloaded',
    ar: 'تم تنزيل القالب',
  },
  下载模板: {
    en: 'Download template',
    ar: 'تنزيل القالب',
  },
  '导入完成，请检查逐行结果': {
    en: 'Import complete. Review the result for each row.',
    ar: 'اكتمل الاستيراد. راجع نتيجة كل صف.',
  },
  确认导入: {
    en: 'Confirm import',
    ar: 'تأكيد الاستيراد',
  },
  结果: {
    en: 'Result',
    ar: 'النتيجة',
  },
  复制邀请: {
    en: 'Copy invitation',
    ar: 'نسخ الدعوة',
  },
  '好工具，让创作更从容。': {
    en: 'Good tools make room for creativity.',
    ar: 'الأدوات الجيدة تمنح الإبداع مساحة.',
  },
  '从一个小细节，到一整幅新画面。14 种工具，各尽其用。': {
    en: 'From a small detail to an entirely new scene. Fourteen tools, each with a purpose.',
    ar: 'من تفصيل صغير إلى مشهد جديد كامل. أربع عشرة أداة، لكل منها دور.',
  },
  '让每张图片，': {
    en: 'Give every image',
    ar: 'امنح كل صورة',
  },
  '拥有更多可能。': {
    en: 'more possibilities.',
    ar: 'احتمالات أكثر.',
  },
  '编辑、增强、复刻，从你的原始素材出发。': {
    en: 'Edit, enhance and reinterpret, starting with your original assets.',
    ar: 'عدّل وحسّن وأعد التصوّر انطلاقًا من موادك الأصلية.',
  },
  试试局部重绘: {
    en: 'Try inpainting',
    ar: 'جرّب إعادة الرسم الموضعي',
  },
  商品图片编辑灵感: {
    en: 'Product image editing inspiration',
    ar: 'إلهام لتعديل صور المنتجات',
  },
  为细节注入新想法: {
    en: 'Bring new ideas to the details',
    ar: 'أضف أفكارًا جديدة إلى التفاصيل',
  },
  编辑: {
    en: 'Edit',
    ar: 'تعديل',
  },
  增强: {
    en: 'Enhance',
    ar: 'تحسين',
  },
  复刻: {
    en: 'Recreate',
    ar: 'إعادة التصوّر',
  },
  '搜索工具…': {
    en: 'Search tools…',
    ar: 'البحث في الأدوات…',
  },
  搜索工具: {
    en: 'Search tools',
    ar: 'البحث في الأدوات',
  },
  可配置服务: {
    en: 'Configurable service',
    ar: 'خدمة قابلة للإعداد',
  },
  '无需模型，也能完成基础处理。': {
    en: 'Basic processing without a model.',
    ar: 'معالجة أساسية دون نموذج.',
  },
  '图片缩放、格式转换、长图拼接与视频裁剪。': {
    en: 'Resize images, convert formats, stitch images and trim video.',
    ar: 'غيّر حجم الصور وحوّل الصيغ وادمج الصور واقتطع الفيديو.',
  },
  打开本机工具: {
    en: 'Open local tools',
    ar: 'فتح الأدوات المحلية',
  },
  没有找到这个工具: {
    en: 'Tool not found',
    ar: 'لم يتم العثور على الأداة',
  },
  图片缩放: {
    en: 'Resize image',
    ar: 'تغيير حجم الصورة',
  },
  格式转换: {
    en: 'Convert format',
    ar: 'تحويل الصيغة',
  },
  长图拼接: {
    en: 'Stitch images',
    ar: 'دمج الصور طوليًا',
  },
  视频裁剪: {
    en: 'Trim video',
    ar: 'اقتطاع الفيديو',
  },
  本机工具: {
    en: 'Local tools',
    ar: 'الأدوات المحلية',
  },
  工具草稿已保存: {
    en: 'Tool draft saved',
    ar: 'تم حفظ مسودة الأداة',
  },
  '在本机处理你的原始素材，结果保存到当前空间。': {
    en: 'Process your originals locally and save results in this workspace.',
    ar: 'عالج ملفاتك الأصلية محليًا واحفظ النتائج في مساحة العمل.',
  },
  保存为项目: {
    en: 'Save as project',
    ar: 'حفظ كمشروع',
  },
  缩放: {
    en: 'Resize',
    ar: 'تغيير الحجم',
  },
  转换: {
    en: 'Convert',
    ar: 'تحويل',
  },
  拼接: {
    en: 'Stitch',
    ar: 'دمج',
  },
  裁剪: {
    en: 'Trim',
    ar: 'اقتطاع',
  },
  创意复刻: {
    en: 'Creative reinterpretation',
    ar: 'إعادة تصوّر إبداعية',
  },
  '1:1 复刻': {
    en: '1:1 recreation',
    ar: 'إعادة إنشاء 1:1',
  },
  'AI 融合': {
    en: 'AI fusion',
    ar: 'دمج بالذكاء الاصطناعي',
  },
  普通拼接: {
    en: 'Standard stitching',
    ar: 'دمج عادي',
  },
  参考构图图片: {
    en: 'Composition reference image',
    ar: 'صورة مرجعية للتكوين',
  },
  参考视频: {
    en: 'Reference video',
    ar: 'فيديو مرجعي',
  },
  打标样式参考图: {
    en: 'Label style reference',
    ar: 'مرجع أسلوب الملصق',
  },
  商品素材: {
    en: 'Product assets',
    ar: 'مواد المنتج',
  },
  '场景参考图（可选）': {
    en: 'Scene reference (optional)',
    ar: 'مرجع المشهد (اختياري)',
  },
  '替换素材（可选）': {
    en: 'Replacement assets (optional)',
    ar: 'مواد الاستبدال (اختياري)',
  },
  '参考商品 / 主体素材': {
    en: 'Product / subject reference assets',
    ar: 'مواد مرجعية للمنتج / العنصر',
  },
  创作说明: {
    en: 'Creative instructions',
    ar: 'تعليمات إبداعية',
  },
  '输出保留透明背景。': {
    en: 'The output keeps a transparent background.',
    ar: 'تحافظ النتيجة على خلفية شفافة.',
  },
  '描述要保留的细节和希望进行的调整。': {
    en: 'Describe the details to preserve and the changes you want.',
    ar: 'صِف التفاصيل التي تريد الحفاظ عليها والتغييرات المطلوبة.',
  },
  '写下你的想法…': {
    en: 'Write down your idea…',
    ar: 'اكتب فكرتك…',
  },
  画幅比例: {
    en: 'Canvas aspect ratio',
    ar: 'نسبة أبعاد اللوحة',
  },
  增强程度: {
    en: 'Enhancement strength',
    ar: 'قوة التحسين',
  },
  轻度: {
    en: 'Light',
    ar: 'خفيف',
  },
  标准: {
    en: 'Standard',
    ar: 'قياسي',
  },
  强力: {
    en: 'Strong',
    ar: 'قوي',
  },
  目标颜色: {
    en: 'Target colors',
    ar: 'الألوان المستهدفة',
  },
  '多个 HEX 色值用逗号分隔': {
    en: 'Separate HEX colors with commas',
    ar: 'افصل ألوان HEX بفواصل',
  },
  '输出宽度（像素）': {
    en: 'Output width (pixels)',
    ar: 'عرض النتيجة (بكسل)',
  },
  '输出高度（像素）': {
    en: 'Output height (pixels)',
    ar: 'ارتفاع النتيجة (بكسل)',
  },
  输出格式: {
    en: 'Output format',
    ar: 'صيغة النتيجة',
  },
  'PNG（保留透明）': {
    en: 'PNG (transparent)',
    ar: 'PNG (مع الشفافية)',
  },
  输出清晰度: {
    en: 'Output resolution',
    ar: 'دقة النتيجة',
  },
  '时长（秒）': {
    en: 'Duration (seconds)',
    ar: 'المدة (ثوانٍ)',
  },
  替换对象: {
    en: 'Replacement target',
    ar: 'العنصر المراد استبداله',
  },
  模特: {
    en: 'Person',
    ar: 'شخص',
  },
  服饰: {
    en: 'Clothing',
    ar: 'ملابس',
  },
  人脸: {
    en: 'Face',
    ar: 'وجه',
  },
  商品: {
    en: 'Product',
    ar: 'منتج',
  },
  '开始时间（秒）': {
    en: 'Start time (seconds)',
    ar: 'وقت البداية (ثوانٍ)',
  },
  '结束时间（秒）': {
    en: 'End time (seconds)',
    ar: 'وقت النهاية (ثوانٍ)',
  },
  商品卖点: {
    en: 'Product selling points',
    ar: 'مزايا المنتج',
  },
  展示价格: {
    en: 'Display price',
    ar: 'السعر المعروض',
  },
  '例如 ¥129': {
    en: 'For example, ¥129',
    ar: 'مثلًا ¥129',
  },
  文字语言: {
    en: 'Text language',
    ar: 'لغة النص',
  },
  生成通道: {
    en: 'Generation channel',
    ar: 'مسار التوليد',
  },
  精品: {
    en: 'Premium',
    ar: 'ممتاز',
  },
  推广: {
    en: 'Promotion',
    ar: 'ترويجي',
  },
  '目标语言（可多选）': {
    en: 'Target languages (multiple allowed)',
    ar: 'اللغات المستهدفة (يمكن اختيار عدة لغات)',
  },
  '包含文字 / 字幕': {
    en: 'Include text / captions',
    ar: 'تضمين نص / ترجمة',
  },
  保留原视频音乐与节奏: {
    en: 'Keep original music and rhythm',
    ar: 'الحفاظ على الموسيقى والإيقاع الأصليين',
  },
  '上传原始图片后，在画面上标记需要重绘的区域。': {
    en: 'Upload the original image, then mark the region you want to edit.',
    ar: 'ارفع الصورة الأصلية ثم حدد المنطقة التي تريد تعديلها.',
  },
  '分享链接解析与人物认证需要相应外部服务。目前请上传有权使用的本地视频与素材。': {
    en: 'Share-link parsing and identity verification require external services. For now, upload local videos and assets you have permission to use.',
    ar: 'يتطلب تحليل روابط المشاركة والتحقق من الهوية خدمات خارجية. ارفع حاليًا فيديوهات ومواد محلية لديك حق استخدامها.',
  },
  记录状态: {
    en: 'History status',
    ar: 'حالة السجل',
  },
  全部状态: {
    en: 'All statuses',
    ar: 'كل الحالات',
  },
  处理风格参考: {
    en: 'Processing style reference',
    ar: 'مرجع أسلوب المعالجة',
  },
  '你的好作品，值得再进一步。': {
    en: 'Take your good work a step further.',
    ar: 'ارتقِ بعملك خطوة أخرى.',
  },
  '添加素材并设置参数，处理进度和真实结果会出现在这里。': {
    en: 'Add assets and settings. Processing progress and actual results will appear here.',
    ar: 'أضف المواد واضبط الإعدادات. سيظهر تقدم المعالجة والنتائج الفعلية هنا.',
  },
  图片仅为原创风格参考: {
    en: 'Images are original style references only',
    ar: 'الصور مراجع أصلية للأسلوب فقط',
  },
  草稿: {
    en: 'Draft',
    ar: 'مسودة',
  },
  待支付: {
    en: 'Awaiting payment',
    ar: 'بانتظار الدفع',
  },
  已支付: {
    en: 'Paid',
    ar: 'مدفوع',
  },
  失败: {
    en: 'Failed',
    ar: 'فشل',
  },
  已关闭: {
    en: 'Closed',
    ar: 'مغلق',
  },
  已申请: {
    en: 'Requested',
    ar: 'تم الطلب',
  },
  已开具: {
    en: 'Issued',
    ar: 'تم الإصدار',
  },
  '清楚了解每一次创作的预留、结算与记录。': {
    en: 'Understand reservations, settlements and records for every creation.',
    ar: 'اطّلع بوضوح على حجوزات كل عمل وتسوياته وسجلاته.',
  },
  兑换额度: {
    en: 'Redeem credits',
    ar: 'استرداد أرصدة برمز',
  },
  '当前空间使用本机测试额度，没有现金价值，也不代表真实付款。供应商实际费用以其账单为准。': {
    en: "This workspace uses local test credits with no cash value and no real payment. Actual provider charges follow the provider's bill.",
    ar: 'تستخدم هذه المساحة أرصدة اختبار محلية بلا قيمة نقدية ولا تمثل دفعًا فعليًا. تُحتسب رسوم المزوّد وفق فاتورته.',
  },
  创作额度: {
    en: 'Creative credits',
    ar: 'أرصدة الإبداع',
  },
  账户余额: {
    en: 'Account balance',
    ar: 'رصيد الحساب',
  },
  包含尚未结算的预留: {
    en: 'Includes unsettled reservations',
    ar: 'يشمل الحجوزات غير المسوّاة',
  },
  任务预留: {
    en: 'Task reservations',
    ar: 'حجوزات المهام',
  },
  处理中与待核对任务: {
    en: 'Processing and reconciliation tasks',
    ar: 'مهام قيد المعالجة والتحقق',
  },
  已完成任务的实际结算: {
    en: 'Actual settlement for completed tasks',
    ar: 'التسوية الفعلية للمهام المكتملة',
  },
  额度明细: {
    en: 'Credit details',
    ar: 'تفاصيل الأرصدة',
  },
  成员统计: {
    en: 'Member statistics',
    ar: 'إحصاءات الأعضاء',
  },
  套餐与权益: {
    en: 'Plans and benefits',
    ar: 'الخطط والمزايا',
  },
  订单: {
    en: 'Orders',
    ar: 'الطلبات',
  },
  发票与抬头: {
    en: 'Invoices and billing details',
    ar: 'الفواتير وبيانات الفوترة',
  },
  额度账本: {
    en: 'Credit ledger',
    ar: 'سجل الأرصدة',
  },
  账本筛选: {
    en: 'Ledger filter',
    ar: 'تصفية السجل',
  },
  全部记录: {
    en: 'All records',
    ar: 'كل السجلات',
  },
  获得额度: {
    en: 'Credits received',
    ar: 'أرصدة مستلمة',
  },
  预留: {
    en: 'Reserve',
    ar: 'حجز',
  },
  消费: {
    en: 'Spend',
    ar: 'إنفاق',
  },
  释放: {
    en: 'Release',
    ar: 'تحرير',
  },
  结余: {
    en: 'Balance',
    ar: 'الرصيد',
  },
  任务: {
    en: 'Task',
    ar: 'المهمة',
  },
  获得: {
    en: 'Received',
    ar: 'مستلم',
  },
  退款: {
    en: 'Refund',
    ar: 'استرداد',
  },
  这里还没有额度变动: {
    en: 'No credit changes yet',
    ar: 'لا توجد تغييرات في الأرصدة بعد',
  },
  '真实的任务提交与结算会逐笔记录。': {
    en: 'Actual task submissions and settlements are recorded individually.',
    ar: 'تُسجل عمليات إرسال المهام وتسوياتها الفعلية كلٌّ على حدة.',
  },
  额度包: {
    en: 'Credit packs',
    ar: 'حزم الأرصدة',
  },
  订阅方案: {
    en: 'Subscriptions',
    ar: 'الاشتراكات',
  },
  选择方案: {
    en: 'Choose plan',
    ar: 'اختيار خطة',
  },
  查看并保存订单草稿: {
    en: 'Review and save an order draft',
    ar: 'مراجعة مسودة طلب وحفظها',
  },
  '支付服务未配置，不会发放购买额度。': {
    en: 'Payment is not configured. Purchased credits will not be issued.',
    ar: 'خدمة الدفع غير مُعدّة. لن تُضاف أرصدة شراء.',
  },
  暂无已发布套餐: {
    en: 'No published plans',
    ar: 'لا توجد خطط منشورة',
  },
  '管理员配置真实商业方案后，将在这里展示。': {
    en: 'Plans will appear when an administrator configures actual commercial offers.',
    ar: 'ستظهر الخطط عندما يُعدّ المسؤول عروضًا تجارية فعلية.',
  },
  当前订阅: {
    en: 'Current subscription',
    ar: 'الاشتراك الحالي',
  },
  '· 到期': {
    en: '· Expires',
    ar: '· ينتهي',
  },
  已提交取消续订请求: {
    en: 'Renewal cancellation requested',
    ar: 'تم طلب إلغاء التجديد',
  },
  取消续订: {
    en: 'Cancel renewal',
    ar: 'إلغاء التجديد',
  },
  订单编号: {
    en: 'Order number',
    ar: 'رقم الطلب',
  },
  金额: {
    en: 'Amount',
    ar: 'المبلغ',
  },
  前往支付: {
    en: 'Proceed to payment',
    ar: 'المتابعة للدفع',
  },
  还没有订单: {
    en: 'No orders yet',
    ar: 'لا توجد طلبات بعد',
  },
  '真实方案的订单与支付状态会保存在这里。': {
    en: 'Orders for actual plans and their payment status are saved here.',
    ar: 'تُحفظ هنا طلبات الخطط الفعلية وحالات دفعها.',
  },
  查看套餐: {
    en: 'View plans',
    ar: 'عرض الخطط',
  },
  发票记录: {
    en: 'Invoice history',
    ar: 'سجل الفواتير',
  },
  新增抬头: {
    en: 'Add billing details',
    ar: 'إضافة بيانات فوترة',
  },
  申请发票: {
    en: 'Request invoice',
    ar: 'طلب فاتورة',
  },
  申请时间: {
    en: 'Requested on',
    ar: 'تاريخ الطلب',
  },
  申请已提交: {
    en: 'Request submitted',
    ar: 'تم إرسال الطلب',
  },
  提交开票: {
    en: 'Submit invoice request',
    ar: 'إرسال طلب الفاتورة',
  },
  暂无发票申请: {
    en: 'No invoice requests',
    ar: 'لا توجد طلبات فواتير',
  },
  '仅已支付且未申请过的订单可以开票。没有开票服务时，申请会保留为草稿。': {
    en: 'Only paid orders without a previous invoice request are eligible. Without an invoicing service, requests remain drafts.',
    ar: 'تتأهل فقط الطلبات المدفوعة التي لم تُطلب لها فاتورة. دون خدمة إصدار فواتير، تبقى الطلبات مسودات.',
  },
  已保存抬头: {
    en: 'Saved billing details',
    ar: 'بيانات الفوترة المحفوظة',
  },
  企业: {
    en: 'Company',
    ar: 'شركة',
  },
  个人: {
    en: 'Individual',
    ar: 'فرد',
  },
  个人抬头: {
    en: 'Individual billing details',
    ar: 'بيانات فوترة فردية',
  },
  未设置邮箱: {
    en: 'No email set',
    ar: 'لم يُحدد بريد إلكتروني',
  },
  抬头已删除: {
    en: 'Billing details deleted',
    ar: 'تم حذف بيانات الفوترة',
  },
  删除抬头: {
    en: 'Delete billing details',
    ar: 'حذف بيانات الفوترة',
  },
  '仅有效且符合当前空间规则的兑换码可以入账。': {
    en: "Only valid codes that meet this workspace's rules can add credits.",
    ar: 'يمكن فقط للرموز الصالحة والمتوافقة مع قواعد المساحة إضافة أرصدة.',
  },
  '兑换成功，额度已入账': {
    en: 'Code redeemed. Credits added.',
    ar: 'تم استخدام الرمز وإضافة الأرصدة.',
  },
  兑换码: {
    en: 'Redemption code',
    ar: 'رمز الاسترداد',
  },
  确认兑换: {
    en: 'Confirm redemption',
    ar: 'تأكيد استخدام الرمز',
  },
  确认方案: {
    en: 'Confirm plan',
    ar: 'تأكيد الخطة',
  },
  '订单价格以服务端快照为准。创建草稿不会自动充值。': {
    en: 'The order price follows the server snapshot. Creating a draft does not add credits.',
    ar: 'يتبع سعر الطلب النسخة المحفوظة على الخادم. إنشاء مسودة لا يضيف أرصدة.',
  },
  方案: {
    en: 'Plan',
    ar: 'الخطة',
  },
  价格: {
    en: 'Price',
    ar: 'السعر',
  },
  '支付服务尚未连接。可以保存订单草稿，连接真实商户服务后再支付。': {
    en: 'Payment is not connected yet. Save an order draft and pay after a real merchant service is connected.',
    ar: 'خدمة الدفع غير متصلة بعد. احفظ مسودة الطلب وادفع بعد توصيل خدمة تاجر فعلية.',
  },
  订单已创建: {
    en: 'Order created',
    ar: 'تم إنشاء الطلب',
  },
  创建订单: {
    en: 'Create order',
    ar: 'إنشاء طلب',
  },
  新增发票抬头: {
    en: 'Add invoice billing details',
    ar: 'إضافة بيانات فاتورة',
  },
  发票抬头已保存: {
    en: 'Invoice billing details saved',
    ar: 'تم حفظ بيانات الفاتورة',
  },
  抬头类型: {
    en: 'Billing type',
    ar: 'نوع الفوترة',
  },
  抬头名称: {
    en: 'Billing name',
    ar: 'اسم الفوترة',
  },
  纳税人识别号: {
    en: 'Taxpayer identification number',
    ar: 'الرقم الضريبي',
  },
  '接收邮箱（可选）': {
    en: 'Recipient email (optional)',
    ar: 'بريد الاستلام (اختياري)',
  },
  保存抬头: {
    en: 'Save billing details',
    ar: 'حفظ بيانات الفوترة',
  },
  发票申请已保存: {
    en: 'Invoice request saved',
    ar: 'تم حفظ طلب الفاتورة',
  },
  发票抬头: {
    en: 'Invoice billing details',
    ar: 'بيانات الفاتورة',
  },
  选择已保存的抬头: {
    en: 'Choose saved billing details',
    ar: 'اختيار بيانات فوترة محفوظة',
  },
  选择已支付订单: {
    en: 'Choose paid orders',
    ar: 'اختيار طلبات مدفوعة',
  },
  暂无可开票的已支付订单: {
    en: 'No paid orders eligible for invoicing',
    ar: 'لا توجد طلبات مدفوعة مؤهلة للفوترة',
  },
  保存发票申请: {
    en: 'Save invoice request',
    ar: 'حفظ طلب الفاتورة',
  },
  '关闭这笔订单？': {
    en: 'Close this order?',
    ar: 'إغلاق هذا الطلب؟',
  },
  '只有尚未支付的订单可以关闭。': {
    en: 'Only unpaid orders can be closed.',
    ar: 'يمكن إغلاق الطلبات غير المدفوعة فقط.',
  },
  订单已关闭: {
    en: 'Order closed',
    ar: 'تم إغلاق الطلب',
  },
  '从一个新想法开始，或继续上一次未完成的作品。': {
    en: 'Start with a new idea or continue where you left off.',
    ar: 'ابدأ بفكرة جديدة أو تابع من حيث توقفت.',
  },
  最近的项目: {
    en: 'Recent projects',
    ar: 'المشاريع الأخيرة',
  },
  '全部项目 ↗': {
    en: 'All projects ↗',
    ar: 'كل المشاريع ↗',
  },
  从一个想法开始: {
    en: 'Start with an idea',
    ar: 'ابدأ بفكرة',
  },
  '写下创作需求并保存草稿，或在项目页创建空白画布。': {
    en: 'Write a brief and save a draft, or create a blank canvas from Projects.',
    ar: 'اكتب وصفًا واحفظ مسودة، أو أنشئ لوحة فارغة من صفحة المشاريع.',
  },
  '部分画布素材无法访问。请在素材库恢复原件，或检查工作空间权限。': {
    en: 'Some canvas assets cannot be accessed. Restore originals in the library or check workspace permissions.',
    ar: 'يتعذّر الوصول إلى بعض مواد اللوحة. استعد الملفات الأصلية من المكتبة أو تحقق من الصلاحيات.',
  },
  '保存失败，请重试。': {
    en: 'Save failed. Please try again.',
    ar: 'فشل الحفظ. يُرجى المحاولة مجددًا.',
  },
  画布还未准备好: {
    en: 'The canvas is not ready yet',
    ar: 'اللوحة ليست جاهزة بعد',
  },
  草稿已另存: {
    en: 'Draft saved as a copy',
    ar: 'تم حفظ المسودة كنسخة',
  },
  '正在打开画布…': {
    en: 'Opening canvas…',
    ar: 'جارٍ فتح اللوحة…',
  },
  返回项目: {
    en: 'Back to project',
    ar: 'العودة إلى المشروع',
  },
  '正在保存…': {
    en: 'Saving…',
    ar: 'جارٍ الحفظ…',
  },
  有未保存的修改: {
    en: 'Unsaved changes',
    ar: 'تغييرات غير محفوظة',
  },
  版本: {
    en: 'Version',
    ar: 'الإصدار',
  },
  分享: {
    en: 'Share',
    ar: 'مشاركة',
  },
  '画布已有新版本。当前草稿完整保留，请另存副本，或确认放弃当前修改后重新加载。': {
    en: 'A newer canvas version exists. Your draft is preserved. Save a copy, or discard your changes and reload.',
    ar: 'يوجد إصدار أحدث من اللوحة. مسودتك محفوظة. احفظ نسخة أو تجاهل تغييراتك وأعد التحميل.',
  },
  另存草稿: {
    en: 'Save draft as copy',
    ar: 'حفظ نسخة من المسودة',
  },
  '重新加载…': {
    en: 'Reloading…',
    ar: 'جارٍ إعادة التحميل…',
  },
  会话与任务: {
    en: 'Conversation and tasks',
    ar: 'المحادثة والمهام',
  },
  你: {
    en: 'You',
    ar: 'أنت',
  },
  创作助手: {
    en: 'Creative assistant',
    ar: 'مساعد الإبداع',
  },
  开始第一轮创作: {
    en: 'Start your first creative round',
    ar: 'ابدأ جولتك الإبداعية الأولى',
  },
  '你的创作需求和结果将保存在会话中。': {
    en: 'Your briefs and results will be saved in this conversation.',
    ar: 'ستُحفظ أوصافك ونتائجك في هذه المحادثة.',
  },
  有一个新结果等待应用: {
    en: 'A new result is waiting to be applied',
    ar: 'نتيجة جديدة بانتظار التطبيق',
  },
  预览并应用: {
    en: 'Preview and apply',
    ar: 'معاينة وتطبيق',
  },
  '已放弃应用，结果仍保留在素材库': {
    en: 'Application dismissed. The result is still in your library.',
    ar: 'تم تجاهل التطبيق. لا تزال النتيجة في المكتبة.',
  },
  放弃: {
    en: 'Discard',
    ar: 'تجاهل',
  },
  版本历史: {
    en: 'Version history',
    ar: 'سجل الإصدارات',
  },
  '恢复会创建一个新版本，不会覆盖旧记录。': {
    en: 'Restoring creates a new version and preserves previous records.',
    ar: 'تنشئ الاستعادة إصدارًا جديدًا وتحافظ على السجلات السابقة.',
  },
  创建: {
    en: 'Create',
    ar: 'إنشاء',
  },
  应用结果: {
    en: 'Apply result',
    ar: 'تطبيق النتيجة',
  },
  '恢复这个版本？': {
    en: 'Restore this version?',
    ar: 'استعادة هذا الإصدار؟',
  },
  '当前未保存的修改将被替换。建议先保存或另存草稿。': {
    en: 'Current unsaved changes will be replaced. Save them or make a copy first.',
    ar: 'ستُستبدل التغييرات غير المحفوظة. احفظها أو أنشئ نسخة أولًا.',
  },
  版本已恢复: {
    en: 'Version restored',
    ar: 'تمت استعادة الإصدار',
  },
  确认恢复: {
    en: 'Confirm restore',
    ar: 'تأكيد الاستعادة',
  },
  '放弃当前修改并重新加载？': {
    en: 'Discard current changes and reload?',
    ar: 'تجاهل التغييرات الحالية وإعادة التحميل؟',
  },
  '未保存的本地修改将丢失。可取消并先另存草稿。': {
    en: 'Unsaved local changes will be lost. Cancel to save a copy first.',
    ar: 'ستفقد التغييرات المحلية غير المحفوظة. يمكنك الإلغاء لحفظ نسخة أولًا.',
  },
  保留草稿: {
    en: 'Keep draft',
    ar: 'الاحتفاظ بالمسودة',
  },
  放弃并重新加载: {
    en: 'Discard and reload',
    ar: 'تجاهل وإعادة التحميل',
  },
  分享项目: {
    en: 'Share project',
    ar: 'مشاركة المشروع',
  },
  '仅分享明确授权的画布与引用素材。': {
    en: 'Only share authorized canvases and referenced assets.',
    ar: 'شارك اللوحات والمواد المرجعية المصرّح بها فقط.',
  },
  分享链接: {
    en: 'Share link',
    ar: 'رابط المشاركة',
  },
  链接已复制: {
    en: 'Link copied',
    ar: 'تم نسخ الرابط',
  },
  '生成可撤销的只读链接。分享前，请确认项目中引用的素材适合对外展示。': {
    en: "Create a revocable read-only link. Before sharing, make sure the project's referenced assets can be shown publicly.",
    ar: 'أنشئ رابطًا للقراءة فقط يمكن إلغاؤه. تأكد قبل المشاركة من صلاحية عرض المواد المرجعية خارجيًا.',
  },
  分享链接已创建: {
    en: 'Share link created',
    ar: 'تم إنشاء رابط المشاركة',
  },
  '创建 7 天分享链接': {
    en: 'Create a 7-day share link',
    ar: 'إنشاء رابط مشاركة لمدة 7 أيام',
  },
  应用创作结果: {
    en: 'Apply creative result',
    ar: 'تطبيق النتيجة الإبداعية',
  },
  '结果不会自动覆盖画布中的新修改。': {
    en: 'Results never automatically overwrite new canvas changes.',
    ar: 'لا تستبدل النتائج تلقائيًا التغييرات الجديدة على اللوحة.',
  },
  待应用结果: {
    en: 'Pending result',
    ar: 'نتيجة بانتظار التطبيق',
  },
  应用方式: {
    en: 'Apply mode',
    ar: 'طريقة التطبيق',
  },
  插入为新图层: {
    en: 'Insert as a new layer',
    ar: 'إدراج كطبقة جديدة',
  },
  替换原目标图层: {
    en: 'Replace the original target layer',
    ar: 'استبدال الطبقة المستهدفة الأصلية',
  },
  '将替换图层「': {
    en: 'This will replace layer “',
    ar: 'سيستبدل هذا الطبقة «',
  },
  '」。当前画布的其他修改会保留。': {
    en: '”. Other canvas changes will be kept.',
    ar: '». ستُحفظ تغييرات اللوحة الأخرى.',
  },
  结果已应用到画布: {
    en: 'Result applied to canvas',
    ar: 'تم تطبيق النتيجة على اللوحة',
  },
  确认应用: {
    en: 'Confirm application',
    ar: 'تأكيد التطبيق',
  },
  '请先保存当前画布，再应用新结果。': {
    en: 'Save the canvas before applying a new result.',
    ar: 'احفظ اللوحة قبل تطبيق نتيجة جديدة.',
  },
  商品详情页: {
    en: 'Product detail page',
    ar: 'صفحة تفاصيل المنتج',
  },
  商品套图: {
    en: 'Product image set',
    ar: 'مجموعة صور المنتج',
  },
  主副图: {
    en: 'Main and secondary images',
    ar: 'صور رئيسية وثانوية',
  },
  白底图: {
    en: 'White-background image',
    ar: 'صورة بخلفية بيضاء',
  },
  电商单图: {
    en: 'Ecommerce image',
    ar: 'صورة للتجارة الإلكترونية',
  },
  营销海报: {
    en: 'Marketing poster',
    ar: 'ملصق تسويقي',
  },
  自由创作: {
    en: 'Free creation',
    ar: 'إنشاء حر',
  },
  商品主图视频: {
    en: 'Product hero video',
    ar: 'فيديو رئيسي للمنتج',
  },
  种草短视频: {
    en: 'Product recommendation clip',
    ar: 'مقطع توصية بالمنتج',
  },
  品牌广告: {
    en: 'Brand advertisement',
    ar: 'إعلان العلامة التجارية',
  },
  英语: {
    en: 'English',
    ar: 'الإنجليزية',
  },
  日语: {
    en: 'Japanese',
    ar: 'اليابانية',
  },
  韩语: {
    en: 'Korean',
    ar: 'الكورية',
  },
  德语: {
    en: 'German',
    ar: 'الألمانية',
  },
  法语: {
    en: 'French',
    ar: 'الفرنسية',
  },
  西班牙语: {
    en: 'Spanish',
    ar: 'الإسبانية',
  },
  意大利语: {
    en: 'Italian',
    ar: 'الإيطالية',
  },
  葡萄牙语: {
    en: 'Portuguese',
    ar: 'البرتغالية',
  },
  俄语: {
    en: 'Russian',
    ar: 'الروسية',
  },
  阿拉伯语: {
    en: 'Arabic',
    ar: 'العربية',
  },
  泰语: {
    en: 'Thai',
    ar: 'التايلاندية',
  },
  越南语: {
    en: 'Vietnamese',
    ar: 'الفيتنامية',
  },
  印尼语: {
    en: 'Indonesian',
    ar: 'الإندونيسية',
  },
  马来语: {
    en: 'Malay',
    ar: 'الملايوية',
  },
  土耳其语: {
    en: 'Turkish',
    ar: 'التركية',
  },
  波兰语: {
    en: 'Polish',
    ar: 'البولندية',
  },
  荷兰语: {
    en: 'Dutch',
    ar: 'الهولندية',
  },
  淘宝: {
    en: 'Taobao',
    ar: 'Taobao',
  },
  京东: {
    en: 'JD.com',
    ar: 'JD.com',
  },
  小红书: {
    en: 'Xiaohongshu',
    ar: 'Xiaohongshu',
  },
  抖音: {
    en: 'Douyin',
    ar: 'Douyin',
  },
  拼多多: {
    en: 'Pinduoduo',
    ar: 'Pinduoduo',
  },
  爆款图片复刻: {
    en: 'Image recreation',
    ar: 'إعادة تصوّر الصور',
  },
  '提取构图与风格，为你的商品重新创作': {
    en: 'Use composition and style references to create new product visuals',
    ar: 'استلهم التكوين والأسلوب لإنشاء صور جديدة لمنتجك',
  },
  爆款视频复刻: {
    en: 'Video recreation',
    ar: 'إعادة تصوّر الفيديو',
  },
  '借鉴创意节奏，重新演绎商品故事': {
    en: "Reinterpret a product story using a reference's creative rhythm",
    ar: 'أعد تقديم قصة المنتج مستلهمًا إيقاع المرجع الإبداعي',
  },
  多图融合: {
    en: 'Multi-image fusion',
    ar: 'دمج صور متعددة',
  },
  '衔接多张产品图片，形成完整视觉叙事': {
    en: 'Connect product images into a complete visual story',
    ar: 'اربط صور المنتجات في قصة بصرية متكاملة',
  },
  'AI 洗图': {
    en: 'AI image restyling',
    ar: 'إعادة تنسيق الصورة بالذكاء الاصطناعي',
  },
  '重塑画面质感，让商品表达更自然': {
    en: 'Rework image texture for a more natural product presentation',
    ar: 'أعد تشكيل ملمس الصورة لعرض المنتج بشكل طبيعي',
  },
  主图打标: {
    en: 'Product image labels',
    ar: 'ملصقات صور المنتجات',
  },
  将价格与商品卖点融入清晰的营销画面: {
    en: 'Combine pricing and selling points in a clear marketing visual',
    ar: 'اجمع السعر ومزايا المنتج في صورة تسويقية واضحة',
  },
  局部重绘: {
    en: 'Inpainting',
    ar: 'إعادة الرسم الموضعي',
  },
  '画出调整区域，精确描述希望发生的变化': {
    en: 'Mark a region and describe exactly what you want to change',
    ar: 'حدد منطقة وصِف بدقة ما تريد تغييره',
  },
  商品替换: {
    en: 'Replace product',
    ar: 'استبدال المنتج',
  },
  '保留场景构图，替换画面中的商品': {
    en: 'Replace the product while preserving the scene composition',
    ar: 'استبدل المنتج مع الحفاظ على تكوين المشهد',
  },
  'AI 抠图': {
    en: 'AI background removal',
    ar: 'إزالة الخلفية بالذكاء الاصطناعي',
  },
  '分离商品主体，获得透明背景素材': {
    en: 'Isolate the product on a transparent background',
    ar: 'اعزل المنتج على خلفية شفافة',
  },
  场景替换: {
    en: 'Replace scene',
    ar: 'استبدال المشهد',
  },
  为同一件商品探索新的展示环境: {
    en: 'Explore new settings for the same product',
    ar: 'استكشف بيئات عرض جديدة للمنتج نفسه',
  },
  图片翻译: {
    en: 'Translate image',
    ar: 'ترجمة الصورة',
  },
  将图片文案转换成不同市场的语言: {
    en: 'Adapt image copy for different languages and markets',
    ar: 'كيّف نص الصورة للغات وأسواق مختلفة',
  },
  'AI 超清': {
    en: 'AI image enhancement',
    ar: 'تحسين الصور بالذكاء الاصطناعي',
  },
  '增强纹理和细节，改善图片清晰度': {
    en: 'Enhance texture, detail and clarity',
    ar: 'حسّن الملمس والتفاصيل والوضوح',
  },
  无损放大: {
    en: 'Image upscaling',
    ar: 'رفع دقة الصورة',
  },
  用图像模型提升分辨率与细节表现: {
    en: 'Use an image model to increase resolution and improve detail',
    ar: 'استخدم نموذج صور لزيادة الدقة وتحسين التفاصيل',
  },
  智能延展: {
    en: 'Intelligent outpainting',
    ar: 'توسيع الصورة بذكاء',
  },
  '拓展图片边界，适配更多画幅': {
    en: 'Extend image borders to fit more aspect ratios',
    ar: 'وسّع حدود الصورة لتناسب نسب أبعاد أكثر',
  },
  商品换色: {
    en: 'Recolor product',
    ar: 'تغيير لون المنتج',
  },
  '探索不同配色，制作多色 SKU 展示': {
    en: 'Explore colorways and create multiple SKU visuals',
    ar: 'استكشف ألوانًا مختلفة وأنشئ صورًا لخيارات المنتج',
  },
  'OpenAI 图片与文案': {
    en: 'OpenAI images and writing',
    ar: 'صور وكتابة OpenAI',
  },
  'fal · Wan 视频': {
    en: 'fal · Wan video',
    ar: 'فيديو fal · Wan',
  },
  'Flyelep 官方 API': {
    en: 'Flyelep official API',
    ar: 'واجهة Flyelep الرسمية',
  },
  本机图像与视频处理: {
    en: 'Local image and video processing',
    ar: 'معالجة محلية للصور والفيديو',
  },
  '尾帧参考（可选）': {
    en: 'Ending frame reference (optional)',
    ar: 'مرجع الإطار الأخير (اختياري)',
  },
  '模型输出 4 个独立图层，一次请求统一结算；应用到画布时将作为可展开的组合插入。': {
    en: 'The model outputs four independent layers in one billed request. They are inserted into the canvas as an expandable group.',
    ar: 'ينتج النموذج أربع طبقات مستقلة ضمن طلب واحد. تُدرج في اللوحة كمجموعة يمكن توسيعها.',
  },
  未命名模块: {
    en: 'Untitled module',
    ar: 'وحدة بلا عنوان',
  },
  商品主视觉: {
    en: 'Product hero visual',
    ar: 'الصورة الرئيسية للمنتج',
  },
  核心卖点: {
    en: 'Key selling points',
    ar: 'المزايا الرئيسية',
  },
  材质与细节: {
    en: 'Materials and details',
    ar: 'المواد والتفاصيل',
  },
  使用场景: {
    en: 'Usage scene',
    ar: 'مشهد الاستخدام',
  },
  规格参数: {
    en: 'Specifications',
    ar: 'المواصفات',
  },
  产品对比: {
    en: 'Product comparison',
    ar: 'مقارنة المنتجات',
  },
  活动海报: {
    en: 'Campaign poster',
    ar: 'ملصق الحملة',
  },
  自定义模块: {
    en: 'Custom module',
    ar: 'وحدة مخصصة',
  },
  物料参考素材读取失败: {
    en: 'Could not load module reference assets',
    ar: 'تعذّر تحميل المواد المرجعية للوحدة',
  },
  物料规划: {
    en: 'Content plan',
    ar: 'خطة المحتوى',
  },
  '个模块 ·': {
    en: ' modules ·',
    ar: ' وحدات ·',
  },
  '按顺序生成独立物料。每个模块继承总体需求，并使用自己的构图、比例与参考图片。': {
    en: 'Generate separate assets in order. Each module inherits the overall brief and uses its own composition, ratio and reference images.',
    ar: 'ولّد مواد منفصلة بالترتيب. ترث كل وحدة الوصف العام وتستخدم تكوينها ونسبة أبعادها وصورها المرجعية.',
  },
  上移模块: {
    en: 'Move module up',
    ar: 'نقل الوحدة للأعلى',
  },
  下移模块: {
    en: 'Move module down',
    ar: 'نقل الوحدة للأسفل',
  },
  删除模块: {
    en: 'Delete module',
    ar: 'حذف الوحدة',
  },
  模块名称: {
    en: 'Module name',
    ar: 'اسم الوحدة',
  },
  模块类型: {
    en: 'Module type',
    ar: 'نوع الوحدة',
  },
  模块比例: {
    en: 'Module aspect ratio',
    ar: 'نسبة أبعاد الوحدة',
  },
  模块构图与文案: {
    en: 'Module composition and copy',
    ar: 'تكوين الوحدة ونصها',
  },
  '描述这个模块的构图、产品细节和需要呈现的文字…': {
    en: "Describe this module's composition, product details and on-screen text…",
    ar: 'صِف تكوين هذه الوحدة وتفاصيل المنتج والنص المطلوب…',
  },
  模块专属参考: {
    en: 'Module-specific references',
    ar: 'مراجع خاصة بالوحدة',
  },
  添加物料模块: {
    en: 'Add content module',
    ar: 'إضافة وحدة محتوى',
  },
  欢迎来到映造: {
    en: 'Welcome to Yingzao',
    ar: 'مرحبًا بك في Yingzao',
  },
  '为下一件作品，准备一个顺手的工作空间。': {
    en: 'Set up a comfortable workspace for your next creation.',
    ar: 'جهّز مساحة عمل مريحة لعملك القادم.',
  },
  从灵感开始: {
    en: 'Start with inspiration',
    ar: 'ابدأ بالإلهام',
  },
  '写下需求，选择参考素材，为图片或视频保存创作草稿。': {
    en: 'Write a brief, choose references and save a draft for an image or video.',
    ar: 'اكتب وصفًا واختر مراجع واحفظ مسودة لصورة أو فيديو.',
  },
  在画布里完善: {
    en: 'Refine on the canvas',
    ar: 'حسّن العمل على اللوحة',
  },
  '把素材、文字与生成结果自由组合。每一次保存都有版本。': {
    en: 'Combine assets, text and generated results freely. Every save has a version.',
    ar: 'اجمع المواد والنصوص والنتائج المولّدة بحرية. لكل عملية حفظ إصدار.',
  },
  把作品整理好: {
    en: 'Organize your work',
    ar: 'نظّم أعمالك',
  },
  '项目、品牌和素材统一管理，也能邀请伙伴进入团队。': {
    en: 'Manage projects, brands and assets together, and invite collaborators to your team.',
    ar: 'أدِر المشاريع والعلامات والمواد معًا وادعُ شركاءك إلى الفريق.',
  },
  默认发布平台: {
    en: 'Default publishing platform',
    ar: 'منصة النشر الافتراضية',
  },
  '仅用于新建草稿，已有项目保持原有设置。': {
    en: 'Applies to new drafts only. Existing projects keep their settings.',
    ar: 'ينطبق على المسودات الجديدة فقط. تحتفظ المشاريع الحالية بإعداداتها.',
  },
  默认创作语言: {
    en: 'Default creative language',
    ar: 'لغة الإنشاء الافتراضية',
  },
  '用于画面文案，与界面语言分别设置。': {
    en: 'Used for on-screen copy, separately from the interface language.',
    ar: 'تُستخدم للنص داخل الصور والفيديو، بشكل مستقل عن لغة الواجهة.',
  },
  稍后设置: {
    en: 'Set up later',
    ar: 'الإعداد لاحقًا',
  },
  开始我的创作: {
    en: 'Start creating',
    ar: 'بدء الإنشاء',
  },
  核对服务商结果: {
    en: 'Reconcile provider results',
    ar: 'التحقق من نتائج المزوّد',
  },
  '仅在实际检查供应商记录后操作。不能根据等待时间猜测成功或失败。': {
    en: 'Only proceed after checking actual provider records. Do not infer success or failure from elapsed time.',
    ar: 'تابع فقط بعد فحص سجلات المزوّد الفعلية. لا تستنتج النجاح أو الفشل من مدة الانتظار.',
  },
  核对结果已保存: {
    en: 'Reconciliation saved',
    ar: 'تم حفظ نتيجة التحقق',
  },
  '确认成功会结算对应额度；确认失败会释放预留。证据与管理员操作会保留为审计记录。': {
    en: 'Confirming success settles credits; confirming failure releases the reservation. Evidence and admin actions are retained in the audit log.',
    ar: 'يُسوّي تأكيد النجاح الأرصدة، ويحرر تأكيد الفشل الحجز. تُحفظ الأدلة وإجراءات المسؤول في سجل التدقيق.',
  },
  待核对条目: {
    en: 'Items awaiting reconciliation',
    ar: 'عناصر بانتظار التحقق',
  },
  '项 ·': {
    en: ' items ·',
    ar: ' عناصر ·',
  },
  无远端编号: {
    en: 'No remote ID',
    ar: 'لا يوجد معرّف خارجي',
  },
  已核实的结果: {
    en: 'Verified outcome',
    ar: 'النتيجة المتحقق منها',
  },
  '供应商已确认失败 / 未执行': {
    en: 'Provider confirmed failure / not executed',
    ar: 'أكد المزوّد الفشل / عدم التنفيذ',
  },
  供应商已确认成功: {
    en: 'Provider confirmed success',
    ar: 'أكد المزوّد النجاح',
  },
  实际结果素材: {
    en: 'Actual result assets',
    ar: 'مواد النتيجة الفعلية',
  },
  '真实文字结果（文字任务）': {
    en: 'Actual text result (text tasks)',
    ar: 'النتيجة النصية الفعلية (المهام النصية)',
  },
  核对证据: {
    en: 'Reconciliation evidence',
    ar: 'أدلة التحقق',
  },
  '至少10个字，记录供应商任务编号、查询结果与核对依据。': {
    en: 'At least 10 characters. Include the provider task ID, query result and supporting evidence.',
    ar: '10 أحرف على الأقل. أدرج معرّف مهمة المزوّد ونتيجة الاستعلام وأدلة التحقق.',
  },
  保存核对结果: {
    en: 'Save reconciliation',
    ar: 'حفظ نتيجة التحقق',
  },
  草稿素材读取失败: {
    en: 'Could not read draft assets',
    ar: 'تعذّرت قراءة مواد المسودة',
  },
  保留原视频音轨: {
    en: 'Keep original audio',
    ar: 'الاحتفاظ بالصوت الأصلي',
  },
  '参考视频编辑：1段3–10秒源视频，宽高720–2160像素、24–60fps；最多4张参考图，至少300像素、比例0.4–2.5。输出跟随源片，不承诺逐镜头精确1:1。':
    {
      en: 'Reference video editing: one 3–10 second video, 720–2160 px on each side, 24–60 fps; up to 4 reference images, at least 300 px, aspect ratio 0.4–2.5. Output follows the source; exact shot-by-shot reproduction is not guaranteed.',
      ar: 'تعديل فيديو مرجعي: مقطع واحد من 3–10 ثوانٍ، بعرض وارتفاع 720–2160 بكسل و24–60 إطارًا/ثانية؛ حتى 4 صور مرجعية، لا تقل عن 300 بكسل وبنسبة 0.4–2.5. تتبع النتيجة المصدر دون ضمان تطابق كل لقطة.',
    },
  '此项目包含已保存的工具参数与素材。': {
    en: 'This project includes saved tool settings and assets.',
    ar: 'يتضمن هذا المشروع إعدادات أداة ومواد محفوظة.',
  },
  '继续编辑工具草稿 ↗': {
    en: 'Continue editing tool draft ↗',
    ar: 'متابعة تعديل مسودة الأداة ↗',
  },
  已创建的分享: {
    en: 'Created shares',
    ar: 'المشاركات المنشأة',
  },
  '到期：': {
    en: 'Expires:',
    ar: 'ينتهي:',
  },
  分享已撤销: {
    en: 'Share revoked',
    ar: 'تم إلغاء المشاركة',
  },
  撤销链接: {
    en: 'Revoke link',
    ar: 'إلغاء الرابط',
  },
  暂无分享链接: {
    en: 'No share links yet',
    ar: 'لا توجد روابط مشاركة بعد',
  },
  '画布内容不符合保存规范。': {
    en: 'Canvas content does not meet the save requirements.',
    ar: 'محتوى اللوحة لا يستوفي متطلبات الحفظ.',
  },
  '画布加载失败。': {
    en: 'Could not load the canvas.',
    ar: 'تعذّر تحميل اللوحة.',
  },
  '素材无法加入画布。': {
    en: 'Could not add the asset to the canvas.',
    ar: 'تعذّرت إضافة المادة إلى اللوحة.',
  },
  '上传失败，请重试。': {
    en: 'Upload failed. Please try again.',
    ar: 'فشل الرفع. يُرجى المحاولة مجددًا.',
  },
  '图片已生成，浏览器已开始下载。': {
    en: 'Image created. Your browser has started the download.',
    ar: 'تم إنشاء الصورة وبدأ المتصفح تنزيلها.',
  },
  '导出失败，请检查素材。': {
    en: 'Export failed. Please check the assets.',
    ar: 'فشل التصدير. يُرجى التحقق من المواد.',
  },
  作品画布编辑器: {
    en: 'Canvas editor',
    ar: 'محرر اللوحة',
  },
  画布工具: {
    en: 'Canvas tools',
    ar: 'أدوات اللوحة',
  },
  选择图层: {
    en: 'Select layers',
    ar: 'تحديد الطبقات',
  },
  平移画布: {
    en: 'Pan canvas',
    ar: 'تحريك عرض اللوحة',
  },
  文字: {
    en: 'Text',
    ar: 'نص',
  },
  写下你的好想法: {
    en: 'Write your next great idea',
    ar: 'اكتب فكرتك القادمة',
  },
  矩形: {
    en: 'Rectangle',
    ar: 'مستطيل',
  },
  添加矩形: {
    en: 'Add rectangle',
    ar: 'إضافة مستطيل',
  },
  椭圆: {
    en: 'Ellipse',
    ar: 'شكل بيضاوي',
  },
  添加椭圆: {
    en: 'Add ellipse',
    ar: 'إضافة شكل بيضاوي',
  },
  '撤销 · ⌘Z': {
    en: 'Undo · ⌘Z',
    ar: 'تراجع · ⌘Z',
  },
  '重做 · ⌘⇧Z': {
    en: 'Redo · ⌘⇧Z',
    ar: 'إعادة · ⌘⇧Z',
  },
  重做: {
    en: 'Redo',
    ar: 'إعادة',
  },
  将选中图层分组: {
    en: 'Group selected layers',
    ar: 'تجميع الطبقات المحددة',
  },
  取消分组: {
    en: 'Ungroup',
    ar: 'فك التجميع',
  },
  导出: {
    en: 'Export',
    ar: 'تصدير',
  },
  编辑面板: {
    en: 'Editing panel',
    ar: 'لوحة التعديل',
  },
  画布: {
    en: 'Canvas',
    ar: 'اللوحة',
  },
  图层: {
    en: 'Layers',
    ar: 'الطبقات',
  },
  属性: {
    en: 'Properties',
    ar: 'الخصائص',
  },
  '个素材无法读取。红色虚线为缺失位置；导出前请恢复素材。': {
    en: ' assets could not be loaded. Red dashed outlines mark missing content. Restore the assets before exporting.',
    ar: ' مواد تعذّر تحميلها. تحدد الخطوط الحمراء المتقطعة المحتوى المفقود. استعد المواد قبل التصدير.',
  },
  '作品画布，编辑操作也可通过图层与属性面板完成': {
    en: 'Creative canvas. You can also edit through the Layers and Properties panels.',
    ar: 'لوحة التصميم. يمكنك التعديل أيضًا من لوحتي الطبقات والخصائص.',
  },
  正在读取素材: {
    en: 'Loading assets',
    ar: 'جارٍ تحميل المواد',
  },
  '好作品，从这里开始': {
    en: 'Great work starts here',
    ar: 'الأعمال الجميلة تبدأ هنا',
  },
  此画布尚未添加内容: {
    en: 'This canvas is empty',
    ar: 'هذه اللوحة فارغة',
  },
  '添加素材、文字，或把生成结果放进画布': {
    en: 'Add assets, text or generated results to the canvas',
    ar: 'أضف مواد أو نصوصًا أو نتائج مولّدة إلى اللوحة',
  },
  添加第一张图片: {
    en: 'Add your first image',
    ar: 'إضافة أول صورة',
  },
  缩小画布: {
    en: 'Zoom out',
    ar: 'تصغير العرض',
  },
  放大画布: {
    en: 'Zoom in',
    ar: 'تكبير العرض',
  },
  适应窗口: {
    en: 'Fit to window',
    ar: 'ملاءمة النافذة',
  },
  把灵感放进画布: {
    en: 'Bring inspiration to the canvas',
    ar: 'أضف الإلهام إلى اللوحة',
  },
  导出作品: {
    en: 'Export creation',
    ar: 'تصدير العمل',
  },
  关闭窗口: {
    en: 'Close window',
    ar: 'إغلاق النافذة',
  },
  '选择已有素材，或上传新的图片与视频。': {
    en: 'Choose existing assets or upload new images and videos.',
    ar: 'اختر مواد موجودة أو ارفع صورًا وفيديوهات جديدة.',
  },
  '导出画布中的可见内容。视频图层会导出为静态图片。': {
    en: 'Export visible canvas content. Video layers are exported as still images.',
    ar: 'صدّر المحتوى الظاهر على اللوحة. تُصدّر طبقات الفيديو كصور ثابتة.',
  },
  搜索画布素材: {
    en: 'Search canvas assets',
    ar: 'البحث في مواد اللوحة',
  },
  搜索素材名称: {
    en: 'Search asset names',
    ar: 'البحث بأسماء المواد',
  },
  没有匹配的素材: {
    en: 'No matching assets',
    ar: 'لا توجد مواد مطابقة',
  },
  还没有可用的图片或视频: {
    en: 'No images or videos available yet',
    ar: 'لا توجد صور أو فيديوهات متاحة بعد',
  },
  上传素材后即可开始排版: {
    en: 'Upload assets to start arranging your canvas',
    ar: 'ارفع مواد للبدء في ترتيب اللوحة',
  },
  请先到素材库上传作品: {
    en: 'Upload your work in the asset library first',
    ar: 'ارفع عملك إلى مكتبة المواد أولًا',
  },
  '个可见图层 ·': {
    en: ' visible layers ·',
    ar: ' طبقات ظاهرة ·',
  },
  'PNG 无损图片': {
    en: 'PNG lossless image',
    ar: 'صورة PNG دون فقدان',
  },
  'JPG 图片': {
    en: 'JPG image',
    ar: 'صورة JPG',
  },
  格式: {
    en: 'Format',
    ar: 'الصيغة',
  },
  导出倍率: {
    en: 'Export scale',
    ar: 'مقياس التصدير',
  },
  '1× 原始尺寸': {
    en: '1× Original size',
    ar: '1× الحجم الأصلي',
  },
  '2× 双倍尺寸': {
    en: '2× Double size',
    ar: '2× ضعف الحجم',
  },
  '3× 三倍尺寸': {
    en: '3× Triple size',
    ar: '3× ثلاثة أضعاف',
  },
  '透明背景（PNG）': {
    en: 'Transparent background (PNG)',
    ar: 'خلفية شفافة (PNG)',
  },
  '原始素材以完整分辨率参与绘制。导出使用同一画布渲染器，最高6400万像素。': {
    en: 'Original assets are rendered at full resolution. Export uses the same canvas renderer, up to 64 million pixels.',
    ar: 'تُرسم المواد الأصلية بدقتها الكاملة. يستخدم التصدير محرّك اللوحة نفسه بحد أقصى 64 مليون بكسل.',
  },
  '正在生成图片…': {
    en: 'Creating image…',
    ar: 'جارٍ إنشاء الصورة…',
  },
  生成并下载: {
    en: 'Generate and download',
    ar: 'إنشاء وتنزيل',
  },
  '当前倍率超过导出上限，请降低倍率。': {
    en: 'This scale exceeds the export limit. Choose a smaller scale.',
    ar: 'يتجاوز هذا المقياس حد التصدير. اختر مقياسًا أصغر.',
  },
  图层列表: {
    en: 'Layer list',
    ar: 'قائمة الطبقات',
  },
  '从一段文字或一张图片开始。': {
    en: 'Start with text or an image.',
    ar: 'ابدأ بنص أو صورة.',
  },
  添加的内容会出现在这里: {
    en: 'Added content will appear here',
    ar: 'سيظهر المحتوى المضاف هنا',
  },
  未命名图层: {
    en: 'Untitled layer',
    ar: 'طبقة بلا عنوان',
  },
  隐藏: {
    en: 'Hide',
    ar: 'إخفاء',
  },
  显示: {
    en: 'Show',
    ar: 'إظهار',
  },
  隐藏图层: {
    en: 'Hide layer',
    ar: 'إخفاء الطبقة',
  },
  显示图层: {
    en: 'Show layer',
    ar: 'إظهار الطبقة',
  },
  解锁: {
    en: 'Unlock',
    ar: 'إلغاء القفل',
  },
  锁定: {
    en: 'Lock',
    ar: 'قفل',
  },
  解锁图层: {
    en: 'Unlock layer',
    ar: 'إلغاء قفل الطبقة',
  },
  锁定图层: {
    en: 'Lock layer',
    ar: 'قفل الطبقة',
  },
  上移一层: {
    en: 'Move layer up',
    ar: 'نقل الطبقة للأعلى',
  },
  下移一层: {
    en: 'Move layer down',
    ar: 'نقل الطبقة للأسفل',
  },
  复制图层: {
    en: 'Duplicate layer',
    ar: 'تكرار الطبقة',
  },
  删除图层: {
    en: 'Delete layer',
    ar: 'حذف الطبقة',
  },
  '按住 Shift 点击可多选。列表顶端位于画面最前方。': {
    en: 'Hold Shift while clicking to select multiple layers. The top of the list is the front of the canvas.',
    ar: 'اضغط Shift أثناء النقر لتحديد عدة طبقات. يظهر أعلى القائمة في مقدمة اللوحة.',
  },
  '请输入范围内的有效数值。': {
    en: 'Enter a valid value within the allowed range.',
    ar: 'أدخل قيمة صحيحة ضمن النطاق المسموح.',
  },
  透明: {
    en: 'Transparent',
    ar: 'شفاف',
  },
  属性设置: {
    en: 'Property settings',
    ar: 'إعدادات الخصائص',
  },
  图层属性: {
    en: 'Layer properties',
    ar: 'خصائص الطبقة',
  },
  画布设置: {
    en: 'Canvas settings',
    ar: 'إعدادات اللوحة',
  },
  '宽度 · px': {
    en: 'Width · px',
    ar: 'العرض · بكسل',
  },
  '高度 · px': {
    en: 'Height · px',
    ar: 'الارتفاع · بكسل',
  },
  画布背景: {
    en: 'Canvas background',
    ar: 'خلفية اللوحة',
  },
  透明背景: {
    en: 'Transparent background',
    ar: 'خلفية شفافة',
  },
  '选中图层可调整位置、样式和媒体属性。画布设置以像素为单位。': {
    en: 'Select a layer to adjust position, style and media properties. Canvas dimensions use pixels.',
    ar: 'حدد طبقة لضبط موضعها وأسلوبها وخصائص الوسائط. تُقاس أبعاد اللوحة بالبكسل.',
  },
  '此图层已锁定，可在图层面板解锁。': {
    en: 'This layer is locked. Unlock it in the Layers panel.',
    ar: 'هذه الطبقة مقفلة. ألغِ قفلها من لوحة الطبقات.',
  },
  水平缩放: {
    en: 'Horizontal scale',
    ar: 'المقياس الأفقي',
  },
  垂直缩放: {
    en: 'Vertical scale',
    ar: 'المقياس العمودي',
  },
  '旋转 · °': {
    en: 'Rotation · °',
    ar: 'الدوران · °',
  },
  '不透明度 · %': {
    en: 'Opacity · %',
    ar: 'العتامة · %',
  },
  水平翻转: {
    en: 'Flip horizontally',
    ar: 'قلب أفقي',
  },
  垂直翻转: {
    en: 'Flip vertically',
    ar: 'قلب عمودي',
  },
  左对齐画布: {
    en: 'Align left to canvas',
    ar: 'محاذاة إلى يسار اللوحة',
  },
  水平居中: {
    en: 'Center horizontally',
    ar: 'توسيط أفقي',
  },
  右对齐画布: {
    en: 'Align right to canvas',
    ar: 'محاذاة إلى يمين اللوحة',
  },
  垂直居中: {
    en: 'Center vertically',
    ar: 'توسيط عمودي',
  },
  内容: {
    en: 'Content',
    ar: 'المحتوى',
  },
  字体: {
    en: 'Font',
    ar: 'الخط',
  },
  系统黑体: {
    en: 'System sans serif',
    ar: 'خط النظام بلا زوائد',
  },
  系统宋体: {
    en: 'System serif',
    ar: 'خط النظام ذو زوائد',
  },
  等宽字体: {
    en: 'Monospace',
    ar: 'خط أحادي المسافة',
  },
  苹方: {
    en: 'PingFang',
    ar: 'PingFang',
  },
  微软雅黑: {
    en: 'Microsoft YaHei',
    ar: 'Microsoft YaHei',
  },
  字号: {
    en: 'Font size',
    ar: 'حجم الخط',
  },
  行距: {
    en: 'Line height',
    ar: 'تباعد الأسطر',
  },
  粗体: {
    en: 'Bold',
    ar: 'عريض',
  },
  斜体: {
    en: 'Italic',
    ar: 'مائل',
  },
  下划线: {
    en: 'Underline',
    ar: 'تسطير',
  },
  段落对齐: {
    en: 'Paragraph alignment',
    ar: 'محاذاة الفقرة',
  },
  左对齐: {
    en: 'Align left',
    ar: 'محاذاة لليسار',
  },
  居中: {
    en: 'Center',
    ar: 'توسيط',
  },
  右对齐: {
    en: 'Align right',
    ar: 'محاذاة لليمين',
  },
  文字颜色: {
    en: 'Text color',
    ar: 'لون النص',
  },
  图形: {
    en: 'Shape',
    ar: 'الشكل',
  },
  填充: {
    en: 'Fill',
    ar: 'التعبئة',
  },
  描边: {
    en: 'Stroke',
    ar: 'الحدود',
  },
  描边宽度: {
    en: 'Stroke width',
    ar: 'عرض الحدود',
  },
  圆角: {
    en: 'Corner radius',
    ar: 'نصف قطر الزوايا',
  },
  图片裁剪: {
    en: 'Crop image',
    ar: 'اقتصاص الصورة',
  },
  '按原图像素设置裁剪区域，不会修改原始素材。': {
    en: 'Set the crop region in original-image pixels. The original asset remains unchanged.',
    ar: 'حدد منطقة الاقتصاص ببكسلات الصورة الأصلية. تبقى المادة الأصلية دون تغيير.',
  },
  收起裁剪: {
    en: 'Collapse crop settings',
    ar: 'طي إعدادات الاقتصاص',
  },
  设置裁剪: {
    en: 'Set crop',
    ar: 'ضبط الاقتصاص',
  },
  左边距: {
    en: 'Left offset',
    ar: 'الإزاحة من اليسار',
  },
  上边距: {
    en: 'Top offset',
    ar: 'الإزاحة من الأعلى',
  },
  区域宽度: {
    en: 'Region width',
    ar: 'عرض المنطقة',
  },
  区域高度: {
    en: 'Region height',
    ar: 'ارتفاع المنطقة',
  },
  恢复完整图片: {
    en: 'Restore full image',
    ar: 'استعادة الصورة الكاملة',
  },
  '视频 ·': {
    en: 'Video ·',
    ar: 'فيديو ·',
  },
  '开始 · 秒': {
    en: 'Start · seconds',
    ar: 'البداية · ثوانٍ',
  },
  '结束 · 秒': {
    en: 'End · seconds',
    ar: 'النهاية · ثوانٍ',
  },
  静音预览: {
    en: 'Mute preview',
    ar: 'كتم المعاينة',
  },
  循环预览: {
    en: 'Loop preview',
    ar: 'تكرار المعاينة',
  },
  下载视频原件: {
    en: 'Download original video',
    ar: 'تنزيل الفيديو الأصلي',
  },
  '画布显示视频静帧，PNG/JPG导出也是静态图片。以上区间用于预览；要得到裁剪后的MP4，请使用视频裁剪工具。':
    {
      en: 'The canvas shows a still video frame, and PNG/JPG exports are also still images. The range above is for preview only. Use Trim video to create a trimmed MP4.',
      ar: 'تعرض اللوحة إطارًا ثابتًا من الفيديو، وتكون ملفات PNG/JPG ثابتة أيضًا. النطاق أعلاه للمعاينة فقط. استخدم أداة اقتطاع الفيديو لإنشاء MP4 مقصوص.',
    },
  组内有: {
    en: 'This group contains ',
    ar: 'تحتوي هذه المجموعة على ',
  },
  '个图层。取消分组后可以编辑各个内容。': {
    en: ' layers. Ungroup to edit each element.',
    ar: ' طبقات. فك التجميع لتعديل كل عنصر.',
  },
  '画布加载已取消。': {
    en: 'Canvas loading cancelled.',
    ar: 'أُلغي تحميل اللوحة.',
  },
  '视频读取超时，请重新加载素材。': {
    en: 'Video loading timed out. Reload the asset.',
    ar: 'انتهت مهلة تحميل الفيديو. أعد تحميل المادة.',
  },
  '视频不能读取，请检查原件和访问权限。': {
    en: 'Could not read the video. Check the original file and access permissions.',
    ar: 'تعذّرت قراءة الفيديو. تحقق من الملف الأصلي وصلاحيات الوصول.',
  },
  '视频未包含可读取的画面尺寸。': {
    en: 'The video has no readable frame dimensions.',
    ar: 'لا يتضمن الفيديو أبعاد إطار قابلة للقراءة.',
  },
  '媒体读取失败。': {
    en: 'Could not read the media.',
    ar: 'تعذّرت قراءة الوسائط.',
  },
  '导出超过6400万像素，请降低倍率。': {
    en: 'Export exceeds 64 million pixels. Reduce the scale.',
    ar: 'يتجاوز التصدير 64 مليون بكسل. قلّل المقياس.',
  },
  '浏览器无法导出此画布。': {
    en: 'The browser cannot export this canvas.',
    ar: 'لا يستطيع المتصفح تصدير هذه اللوحة.',
  },
  '画布支持图片或视频素材。': {
    en: 'The canvas supports image and video assets.',
    ar: 'تدعم اللوحة مواد الصور والفيديو.',
  },
  '视频尚未读取真实时长，请等待素材处理完成。': {
    en: "The video's actual duration is not available yet. Wait for asset processing to finish.",
    ar: 'مدة الفيديو الفعلية غير متاحة بعد. انتظر اكتمال معالجة المادة.',
  },
  图层组: {
    en: 'Layer group',
    ar: 'مجموعة طبقات',
  },
  上移: {
    en: 'Move up',
    ar: 'نقل للأعلى',
  },
  下移: {
    en: 'Move down',
    ar: 'نقل للأسفل',
  },
  副本: {
    en: 'Copy',
    ar: 'نسخة',
  },
  映造作品: {
    en: 'Yingzao creation',
    ar: 'عمل Yingzao',
  },
  '素材不在当前素材列表中。': {
    en: 'The asset is not in the current asset list.',
    ar: 'المادة غير موجودة في القائمة الحالية.',
  },
  '裁剪超出了原图范围。': {
    en: 'The crop extends beyond the original image.',
    ar: 'يتجاوز الاقتصاص حدود الصورة الأصلية.',
  },
  '请检查必填参数与数值范围。': {
    en: 'Check required fields and numeric ranges.',
    ar: 'تحقق من الحقول المطلوبة ونطاقات الأرقام.',
  },
  '已关闭二次确认。点击创作后将按服务端报价预留空间额度；供应商可能另行收费，预算限制仍然生效。': {
    en: 'Extra confirmation is disabled. Creating will reserve workspace credits using the server quote. Provider charges may apply separately; budget limits still apply.',
    ar: 'التأكيد الإضافي معطّل. سيحجز الإنشاء أرصدة المساحة وفق سعر الخادم. قد تُفرض رسوم منفصلة من المزوّد وتبقى حدود الميزانية سارية.',
  },
  按报价直接提交并预留额度: {
    en: 'Submit directly and reserve quoted credits',
    ar: 'الإرسال مباشرة وحجز الأرصدة المقدّرة',
  },
  '集合内容发生变化，请刷新后重试': {
    en: 'Collection content has changed. Refresh and try again.',
    ar: 'تغيّر محتوى المجموعة. حدّث الصفحة وحاول مجددًا.',
  },
  管理集合: {
    en: 'Manage collections',
    ar: 'إدارة المجموعات',
  },
  已移出集合: {
    en: 'Removed from collection',
    ar: 'تمت الإزالة من المجموعة',
  },
  移出当前集合: {
    en: 'Remove from current collection',
    ar: 'إزالة من المجموعة الحالية',
  },
  管理素材集合: {
    en: 'Manage asset collections',
    ar: 'إدارة مجموعات المواد',
  },
  删除集合: {
    en: 'Delete collection',
    ar: 'حذف المجموعة',
  },
  集合已更新: {
    en: 'Collection updated',
    ar: 'تم تحديث المجموعة',
  },
  保存名称: {
    en: 'Save name',
    ar: 'حفظ الاسم',
  },
  删除素材集合: {
    en: 'Delete asset collection',
    ar: 'حذف مجموعة المواد',
  },
  '集合会删除，其中的原始素材仍保留在素材库。': {
    en: 'The collection will be deleted. Its original assets remain in the library.',
    ar: 'ستُحذف المجموعة، وستبقى موادها الأصلية في المكتبة.',
  },
  集合已删除: {
    en: 'Collection deleted',
    ar: 'تم حذف المجموعة',
  },
  '关闭后，点击创作会按服务端报价直接预留额度并提交；服务商可能另行收取费用，空间预算限制始终生效。':
    {
      en: 'When disabled, Create submits directly and reserves credits using the server quote. Providers may charge separately. Workspace budget limits always apply.',
      ar: 'عند التعطيل، يرسل الإنشاء مباشرة ويحجز الأرصدة وفق سعر الخادم. قد يفرض المزوّد رسومًا منفصلة وتظل حدود ميزانية المساحة سارية دائمًا.',
    },
  重新打开入门引导: {
    en: 'Reopen the getting-started guide',
    ar: 'إعادة فتح دليل البدء',
  },
  请先登录: {
    en: 'Please sign in first',
    ar: 'يُرجى تسجيل الدخول أولًا',
  },
  请重新登录: {
    en: 'Please sign in again',
    ar: 'يُرجى تسجيل الدخول مجددًا',
  },
  邀请已失效或邮箱不匹配: {
    en: 'The invitation has expired or the email does not match',
    ar: 'انتهت الدعوة أو لا يتطابق البريد الإلكتروني',
  },
  '公开注册已关闭，请使用有效团队邀请': {
    en: 'Public registration is closed. Use a valid team invitation.',
    ar: 'التسجيل العام مغلق. استخدم دعوة فريق صالحة.',
  },
  '此邮箱已注册，请登录接受邀请': {
    en: 'This email is registered. Sign in to accept the invitation.',
    ar: 'هذا البريد مسجل. سجّل الدخول لقبول الدعوة.',
  },
  邮箱或密码错误: {
    en: 'Incorrect email or password',
    ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  },
  需要账户会话: {
    en: 'An account session is required',
    ar: 'يلزم تسجيل الدخول إلى الحساب',
  },
  头像必须是可访问的图片: {
    en: 'The avatar must be an accessible image',
    ar: 'يجب أن تكون الصورة الشخصية قابلة للوصول',
  },
  API密钥没有此空间或管理权限: {
    en: 'This API key lacks workspace or management access',
    ar: 'يفتقد مفتاح API صلاحية المساحة أو الإدارة',
  },
  无权访问此工作空间: {
    en: 'You do not have access to this workspace',
    ar: 'ليس لديك صلاحية الوصول إلى مساحة العمل',
  },
  当前角色无权执行此操作: {
    en: 'Your role cannot perform this action',
    ar: 'لا يسمح دورك بتنفيذ هذا الإجراء',
  },
  内容不存在或已删除: {
    en: 'This content does not exist or has been deleted',
    ar: 'هذا المحتوى غير موجود أو تم حذفه',
  },
  输入信息不符合要求: {
    en: 'Please check the input requirements',
    ar: 'يُرجى التحقق من متطلبات الإدخال',
  },
  '服务器暂时无法完成请求，请稍后再试': {
    en: 'The server cannot complete this request right now. Try again later.',
    ar: 'يتعذّر على الخادم إكمال الطلب حاليًا. حاول لاحقًا.',
  },
  '请求过于频繁，请稍后重试': {
    en: 'Too many requests. Please try again later.',
    ar: 'الطلبات كثيرة جدًا. يُرجى المحاولة لاحقًا.',
  },
  '请求无法处理，请检查输入': {
    en: 'Could not process the request. Check your input.',
    ar: 'تعذّرت معالجة الطلب. تحقق من المدخلات.',
  },
  接口不存在: {
    en: 'API endpoint not found',
    ar: 'نقطة API غير موجودة',
  },
  此请求来源不受信任: {
    en: 'This request origin is not trusted',
    ar: 'مصدر هذا الطلب غير موثوق',
  },
  '会话写入请求必须提供同源 Origin': {
    en: 'Session writes require a same-origin request',
    ar: 'تتطلب عمليات كتابة الجلسة طلبًا من المصدر نفسه',
  },
  '空间仍有在途任务或待核对额度，请处理后再归档': {
    en: 'Resolve active tasks and pending credit reconciliation before archiving this workspace',
    ar: 'عالج المهام الجارية والأرصدة بانتظار التحقق قبل أرشفة المساحة',
  },
  文件大小须为1字节至100MiB: {
    en: 'File size must be between 1 byte and 100 MiB',
    ar: 'يجب أن يكون حجم الملف بين بايت واحد و100 MiB',
  },
  文档最大20MiB: {
    en: 'Documents must not exceed 20 MiB',
    ar: 'يجب ألا يتجاوز المستند 20 MiB',
  },
  原件不存在: {
    en: 'Original file not found',
    ar: 'الملف الأصلي غير موجود',
  },
  此素材没有所选预览: {
    en: 'This asset has no preview of the selected type',
    ar: 'لا تتوفر لهذه المادة معاينة من النوع المحدد',
  },
  素材不存在: {
    en: 'Asset not found',
    ar: 'المادة غير موجودة',
  },
  此素材不是文档: {
    en: 'This asset is not a document',
    ar: 'هذه المادة ليست مستندًا',
  },
  '文档无法解析，请检查文件是否损坏、加密或格式不受支持': {
    en: 'Could not parse the document. It may be damaged, encrypted or unsupported.',
    ar: 'تعذّر تحليل المستند. قد يكون تالفًا أو مشفّرًا أو بصيغة غير مدعومة.',
  },
  图层类型与引用素材不符: {
    en: 'The layer type does not match its referenced asset',
    ar: 'نوع الطبقة لا يطابق المادة المرجعية',
  },
  视频封面必须是图片: {
    en: 'A video cover must be an image',
    ar: 'يجب أن يكون غلاف الفيديو صورة',
  },
  裁剪超出媒体时长: {
    en: 'The trim range exceeds the media duration',
    ar: 'يتجاوز نطاق الاقتطاع مدة الوسائط',
  },
  裁切区域超出原图尺寸: {
    en: 'The crop region exceeds the original image bounds',
    ar: 'تتجاوز منطقة الاقتصاص أبعاد الصورة الأصلية',
  },
  '文档已更新，请保留当前草稿并重新加载。': {
    en: 'The document has changed. Keep your current draft and reload.',
    ar: 'تغيّر المستند. احتفظ بالمسودة الحالية وأعد التحميل.',
  },
  历史版本不存在或已超出保留期: {
    en: 'This version does not exist or is past its retention period',
    ar: 'هذا الإصدار غير موجود أو انتهت مدة الاحتفاظ به',
  },
  可用额度不足: {
    en: 'Insufficient available credits',
    ar: 'الأرصدة المتاحة غير كافية',
  },
  请管理员先分配成员额度: {
    en: 'Ask an administrator to allocate your member budget first',
    ar: 'اطلب من المسؤول تخصيص ميزانية لك أولًا',
  },
  本次任务超出成员额度上限: {
    en: 'This task exceeds your member credit limit',
    ar: 'تتجاوز هذه المهمة حد أرصدتك',
  },
  新额度不能低于已使用和已预留额度: {
    en: 'The new limit cannot be below used and reserved credits',
    ar: 'لا يمكن أن يقل الحد الجديد عن الأرصدة المستخدمة والمحجوزة',
  },
  成员分配总额超过团队未消耗额度: {
    en: "Total member budgets exceed the team's remaining credits",
    ar: 'يتجاوز مجموع ميزانيات الأعضاء أرصدة الفريق المتبقية',
  },
  创意视频编辑: { en: 'Creative video editing', ar: 'تحرير فيديو إبداعي' },
  人物动作复刻: { en: 'Character motion transfer', ar: 'نقل حركة الشخصية' },
  人物主体图片: { en: 'Character image', ar: 'صورة الشخصية' },
  动作参考视频: { en: 'Motion reference video', ar: 'فيديو مرجعي للحركة' },
  画面方向: { en: 'Character orientation', ar: 'اتجاه الشخصية' },
  '跟随动作视频（最长30秒）': {
    en: 'Follow the video (up to 30 seconds)',
    ar: 'اتباع الفيديو (حتى 30 ثانية)',
  },
  '跟随主体图片（最长10秒）': {
    en: 'Follow the image (up to 10 seconds)',
    ar: 'اتباع الصورة (حتى 10 ثوانٍ)',
  },
  我有权使用人物图片与动作参考视频: {
    en: 'I am authorized to use the character image and motion video',
    ar: 'أنا مخول باستخدام صورة الشخصية وفيديو الحركة',
  },
  '人物图片+动作视频选段，按片段秒数报价；先在本机真实裁剪再发送。画幅与清晰度由模型决定，不提供独立字幕控制。服装、人脸、商品的精准替换尚未支持；不承诺原视频背景或逐像素1:1。':
    {
      en: 'Use a character image and a selected video segment. Credits use the segment duration; the video is clipped locally before submission. The model controls framing and resolution, with no separate subtitle control. Precise clothing, face, and product replacement is not supported. Original backgrounds and pixel-exact copying are not guaranteed.',
      ar: 'استخدم صورة شخصية ومقطعاً محدداً من الفيديو. تُحسب الأرصدة حسب مدة المقطع، ويُقص محلياً قبل الإرسال. يحدد النموذج الإطار والدقة، دون تحكم مستقل بالترجمة. الاستبدال الدقيق للملابس والوجه والمنتج غير مدعوم، ولا نضمن الخلفية الأصلية أو النسخ المطابق لكل بكسل.',
    },
  'Kling 2.6 · 标准人物动作复刻': {
    en: 'Kling 2.6 · Standard character motion',
    ar: 'Kling 2.6 · حركة الشخصية القياسية',
  },
  'Kling 2.6 · 专业人物动作复刻': {
    en: 'Kling 2.6 · Pro character motion',
    ar: 'Kling 2.6 · حركة الشخصية الاحترافية',
  },
  ...ACCOUNT_TRANSLATIONS,
  ...CREATION_TRANSLATIONS,
  ...CREDIT_TRANSLATIONS,
  ...WORKFLOW_TRANSLATIONS,
  ...SUPPORT_TRANSLATIONS,
  ...TEAM_CREATION_TRANSLATIONS,
};
let activeLocale: Locale = 'zh-CN';
/** The application calls this before rendering a new account or preference state. */
export function setLocale(locale: Locale): void {
  activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'zh-CN';
}
export function getLocale(): Locale {
  return activeLocale;
}
/** Exact normalized-key lookup keeps unknown/dynamic content intact. */
export function t(text: string, locale: Locale = activeLocale): string {
  if (locale === 'zh-CN') return text;
  const key = text.replace(/\s+/g, ' ').trim();
  const entry = Object.hasOwn(TRANSLATIONS, key) ? TRANSLATIONS[key] : undefined;
  return entry?.[locale] ?? text;
}
