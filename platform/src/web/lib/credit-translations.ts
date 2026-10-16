/** Static credit and promotion copy; parameters retain real contract values. */
export const CREDIT_TRANSLATIONS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>> = {
  '每笔会员额度分别遵循对应合同的到期、封存和续费规则；请查看对应订单条款。额度包自付款起有效 1 年，再次购买会延长尚未失效的同类额度包。':
    {
      en: 'Each membership credit lot follows its own contract’s expiry, archiving and renewal rules. Check the corresponding order terms. Credit packs are valid for 1 year from payment; a new purchase extends unexpired packs of the same type.',
      ar: 'تتبع كل دفعة من أرصدة العضوية قواعد عقدها الخاصة بالانتهاء والأرشفة والتجديد. راجع شروط الطلب المقابل. تسري حزم الأرصدة لمدة سنة من الدفع، ويمدّد الشراء الجديد الحزم غير المنتهية من النوع نفسه.',
    },
  '一次付款购买 {months} 个月会员，无自动续费。权益付款后生效，同档续购期限按协调世界时的日历月顺延，月底按目标月份最后一天计算。':
    {
      en: 'One payment buys {months} months of membership, with no automatic renewal. Benefits start after payment. Same-plan purchases extend the term by UTC calendar months; month-end dates use the last day of the target month.',
      ar: 'تشتري دفعة واحدة عضوية لمدة {months} أشهر دون تجديد تلقائي. تبدأ المزايا بعد الدفع. تمدّد مشتريات الخطة نفسها المدة وفق الأشهر التقويمية بالتوقيت العالمي، وتُحسب نهاية الشهر بآخر يوم في الشهر المستهدف.',
    },
  '同档续费会延长仍有效的剩余额度，并恢复尚在3个月封存期内的额度；重新计算到期与封存时限，超过封存期清零的额度不恢复。':
    {
      en: 'Same-plan renewal extends unexpired remaining credits and restores credits still within their 3-month archive window. Expiry and archive deadlines are recalculated. Credits cleared after the archive window are not restored.',
      ar: 'يمدّد تجديد الخطة نفسها الأرصدة المتبقية غير المنتهية ويستعيد الأرصدة التي ما زالت ضمن فترة الأرشفة البالغة 3 أشهر. يُعاد حساب مواعيد الانتهاء والأرشفة. لا تُستعاد الأرصدة التي صُفّرت بعد انتهاء فترة الأرشفة.',
    },
  '额度按本次购买对应期限到期，不封存；续购不会统一延长旧额度。': {
    en: 'Credits expire with this purchase’s term, without archiving. A new purchase does not extend older credits.',
    ar: 'تنتهي الأرصدة بانتهاء مدة هذه العملية دون أرشفة. لا يمدّد الشراء الجديد الأرصدة الأقدم.',
  },
  '退款按对应购买金额比例缩短会员期限并撤回对应来源额度，已用或预留部分须核对。当前不支持跨档或与自动续费会员混购。':
    {
      en: 'Refunds shorten the membership term in proportion to the refunded purchase amount and revoke credits from that purchase. Used or reserved credits require reconciliation. Switching plans or combining with auto-renewing membership is currently unsupported.',
      ar: 'تقصّر المبالغ المستردة مدة العضوية بنسبة مبلغ الشراء المسترد وتسحب أرصدته. تتطلب الأرصدة المستخدمة أو المحجوزة تحققًا. لا يُدعم حاليًا الانتقال بين الخطط أو الجمع مع عضوية متجددة تلقائيًا.',
    },
  '同档续费可叠加与恢复封存额度；到期封存3个月。': {
    en: 'Same-plan renewals add to and restore archived credits. Credits are archived for 3 months after expiry.',
    ar: 'تضيف تجديدات الخطة نفسها إلى الأرصدة المؤرشفة وتستعيدها. تُؤرشف الأرصدة لمدة 3 أشهر بعد الانتهاء.',
  },
  '一次付款，同档期限顺延；额度按各次购买对应期限到期，不封存。': {
    en: 'One payment; same-plan purchases extend the membership term. Credits expire with each purchase’s own term, without archiving.',
    ar: 'دفعة واحدة؛ تمدّد مشتريات الخطة نفسها مدة العضوية. تنتهي أرصدة كل عملية بانتهاء مدتها الخاصة دون أرشفة.',
  },
  当前符合活动条件: {
    en: 'Currently eligible for this promotion',
    ar: 'تستوفي شروط العرض حاليًا',
  },
  '时区：{timeZone}（结束时刻不含在活动内）': {
    en: 'Time zone: {timeZone} (the end time is excluded)',
    ar: 'المنطقة الزمنية: {timeZone} (لحظة الانتهاء غير مشمولة)',
  },
  不限首购: {
    en: 'Not limited to first purchases',
    ar: 'غير مقصور على أول عملية شراء',
  },
  账号首次购买个人空间会员: {
    en: 'The account’s first personal workspace membership purchase',
    ar: 'أول شراء لعضوية مساحة شخصية لهذا الحساب',
  },
  账号首次网页购买: {
    en: 'The account’s first web purchase',
    ar: 'أول عملية شراء عبر الويب لهذا الحساب',
  },
  首购范围待配置: {
    en: 'First-purchase eligibility is not configured',
    ar: 'لم يُضبط نطاق أهلية أول عملية شراء',
  },
  退款历史仍计为曾购买: {
    en: 'Refunded purchases still count as prior purchases',
    ar: 'تظل المشتريات المستردة محسوبة كمشتريات سابقة',
  },
  全额退款后可重新判断首购: {
    en: 'First-purchase eligibility can be reassessed after a full refund',
    ar: 'يمكن إعادة تقييم أهلية أول شراء بعد استرداد كامل',
  },
  '以活动期内发起的原支付会话确认资格；异步付款完成可晚于活动结束。剩余不足 31 分钟时不新建优惠支付会话。':
    {
      en: 'Eligibility is determined by the original checkout session started during the promotion. Asynchronous payment may complete after the promotion ends. No new promotional checkout sessions are created with fewer than 31 minutes remaining.',
      ar: 'تُحدد الأهلية وفق جلسة الدفع الأصلية التي بدأت خلال العرض. قد يكتمل الدفع غير المتزامن بعد انتهاء العرض. لا تُنشأ جلسات دفع ترويجية جديدة عندما يتبقى أقل من 31 دقيقة.',
    },
  '此时按页面所示普通价格购买；不会自动加入优惠。': {
    en: 'The regular price shown on this page applies; the promotion is not added automatically.',
    ar: 'يسري السعر العادي المعروض في هذه الصفحة؛ ولا يُضاف العرض تلقائيًا.',
  },
  只有创建者与管理员可以查看接口额度账户: {
    en: 'Only owners and administrators can view the API credit account',
    ar: 'يمكن للمالك والمسؤولين فقط عرض حساب أرصدة الواجهة البرمجية',
  },
  接口额度与订单: {
    en: 'API credits and orders',
    ar: 'أرصدة الواجهة البرمجية والطلبات',
  },
  '接口任务使用独立平台额度，与网页账户分别充值、预留和结算。': {
    en: 'API tasks use separate platform credits. Funding, reservations and settlement are separate from the web account.',
    ar: 'تستخدم مهام الواجهة البرمجية أرصدة منصة مستقلة، وتُفصل عمليات الشحن والحجز والتسوية عن حساب الويب.',
  },
  网页创作账户: {
    en: 'Web creation account',
    ar: 'حساب الإنشاء عبر الويب',
  },
  接口额度账户: {
    en: 'API credit account',
    ar: 'حساب أرصدة الواجهة البرمجية',
  },
  '此处是平台创作额度，不是现金余额。接口充值不购买网页会员权益。': {
    en: 'These are platform creation credits, not a cash balance. API funding does not purchase web membership benefits.',
    ar: 'هذه أرصدة إنشاء على المنصة وليست رصيدًا نقديًا. شحن الواجهة البرمجية لا يشتري مزايا عضوية الويب.',
  },
  接口额度包: {
    en: 'API credit packs',
    ar: 'حزم أرصدة الواجهة البرمجية',
  },
  固定期会员: {
    en: 'Fixed-term membership',
    ar: 'عضوية محددة المدة',
  },
  '{months}个月（一次付款）': {
    en: '{months} months (one payment)',
    ar: '{months} أشهر (دفعة واحدة)',
  },
  '固定期 {months} 个月 · 无自动续费': {
    en: 'Fixed term: {months} months · No automatic renewal',
    ar: 'مدة محددة: {months} أشهر · دون تجديد تلقائي',
  },
  '原价 {amount} · 活动内发起原支付会话': {
    en: 'Original price {amount} · Original checkout started during the promotion',
    ar: 'السعر الأصلي {amount} · بدأت جلسة الدفع الأصلية خلال العرض',
  },
  会员资格要求未配置: {
    en: 'Membership requirements are not configured',
    ar: 'لم تُضبط متطلبات العضوية',
  },
  到期时间: {
    en: 'Expires at',
    ar: 'وقت الانتهاء',
  },
  首购活动仅适用于个人空间会员: {
    en: 'This first-purchase promotion applies only to personal workspace memberships',
    ar: 'يسري عرض أول شراء على عضويات المساحات الشخصية فقط',
  },
  '此账号已有符合范围的付款记录，不再符合首购优惠': {
    en: 'This account has a qualifying payment history and is no longer eligible for the first-purchase offer',
    ar: 'لهذا الحساب سجل دفع ضمن النطاق المحدد، ولم يعد مؤهلًا لعرض أول شراء',
  },
  活动未启用: {
    en: 'The promotion is disabled',
    ar: 'العرض غير مفعّل',
  },
  活动尚未开始: {
    en: 'The promotion has not started',
    ar: 'لم يبدأ العرض بعد',
  },
  活动已结束: {
    en: 'The promotion has ended',
    ar: 'انتهى العرض',
  },
  '活动剩余不足31分钟，已停止新建优惠支付会话': {
    en: 'Fewer than 31 minutes remain; new promotional checkout sessions are closed',
    ar: 'يتبقى أقل من 31 دقيقة؛ توقف إنشاء جلسات دفع ترويجية جديدة',
  },
  首购资格范围未配置: {
    en: 'First-purchase eligibility scope is not configured',
    ar: 'لم يُضبط نطاق أهلية أول عملية شراء',
  },
  退款历史是否计入首购未配置: {
    en: 'Whether refunded purchases count toward first-purchase eligibility is not configured',
    ar: 'لم يُحدد ما إذا كانت المشتريات المستردة تُحسب ضمن أهلية أول شراء',
  },
  活动规则确认依据未配置: {
    en: 'The evidence confirming the promotion rules is not configured',
    ar: 'لم يُضبط مرجع تأكيد قواعد العرض',
  },
  '接口额度包自付款起有效 1 年，再次购买会延长本账户尚未失效的额度包。网页会员额度不计入此账户。': {
    en: 'API credit packs are valid for 1 year from payment. A new purchase extends this account’s unexpired packs. Web membership credits are not included.',
    ar: 'تسري حزم أرصدة الواجهة لمدة سنة من الدفع. يمدّد الشراء الجديد الحزم غير المنتهية لهذا الحساب. لا تشمل أرصدة عضوية الويب.',
  },
};
