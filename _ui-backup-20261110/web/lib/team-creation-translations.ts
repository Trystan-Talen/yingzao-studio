/** Static team provisioning copy. Team names, plan names and payment values stay unchanged. */
export const TEAM_CREATION_TRANSLATIONS: Readonly<
  Record<string, Readonly<{ en: string; ar: string }>>
> = {
  前往团队开通: { en: 'Set up team membership', ar: 'إعداد عضوية الفريق' },
  '每个账号限一个团队；付款核验后开放项目、素材与成员。': {
    en: 'One team per account. Projects, assets and members become available after payment is verified.',
    ar: 'فريق واحد لكل حساب. تتاح المشاريع والمواد والأعضاء بعد التحقق من الدفع.',
  },
  进入已有团队: { en: 'Open existing team', ar: 'فتح الفريق الحالي' },
  '原团队已解散，账号名额仍保留。': {
    en: 'The original team was dissolved. This account’s team slot remains used.',
    ar: 'حُلّ الفريق الأصلي، وتظل خانة الفريق لهذا الحساب مستخدمة.',
  },
  '原团队已转让且当前没有访问权限，请联系团队管理员。': {
    en: 'The original team was transferred and you no longer have access. Contact its administrator.',
    ar: 'نُقلت ملكية الفريق الأصلي ولم تعد لديك صلاحية الوصول. تواصل مع مسؤول الفريق.',
  },
  创建本机演示团队: { en: 'Create local demo team', ar: 'إنشاء فريق تجريبي محلي' },
  '订单草稿已保存，尚未付款或开通团队。': {
    en: 'The order draft is saved. No payment has been made and the team is not active.',
    ar: 'حُفظت مسودة الطلب. لم يتم الدفع ولم يُفعّل الفريق.',
  },
  '付款结果待核对；继续使用原订单，不会创建第二个团队。': {
    en: 'Payment is awaiting verification. Continue with the original order; no second team will be created.',
    ar: 'الدفع بانتظار التحقق. تابع بالطلب الأصلي؛ لن يُنشأ فريق ثانٍ.',
  },
  '原付款已全额退款，尚未开通团队；可重新选择套餐。': {
    en: 'The original payment was fully refunded and the team is not active. You can select a plan again.',
    ar: 'استُرد مبلغ الدفع الأصلي بالكامل ولم يُفعّل الفريق. يمكنك اختيار باقة من جديد.',
  },
  '付款已核验，团队开通状态需要核对，请刷新或联系实例管理员。': {
    en: 'Payment is verified, but team activation needs checking. Refresh or contact the instance administrator.',
    ar: 'تم التحقق من الدفع، لكن حالة تفعيل الفريق تحتاج إلى مراجعة. حدّث الصفحة أو تواصل مع مسؤول النسخة.',
  },
  '原订单已关闭，尚未开通团队；可重新选择套餐。': {
    en: 'The original order is closed and the team is not active. You can select a plan again.',
    ar: 'أُغلق الطلب الأصلي ولم يُفعّل الفريق. يمكنك اختيار باقة من جديد.',
  },
  刷新开通状态: { en: 'Refresh activation status', ar: 'تحديث حالة التفعيل' },
  关闭未付款草稿: { en: 'Close unpaid draft', ar: 'إغلاق المسودة غير المدفوعة' },
  前往原订单付款: { en: 'Pay the original order', ar: 'دفع الطلب الأصلي' },
  团队会员套餐: { en: 'Team membership plan', ar: 'باقة عضوية الفريق' },
  请选择团队会员: { en: 'Select a team membership', ar: 'اختر عضوية الفريق' },
  '固定期（月）': { en: 'Fixed term (months)', ar: 'المدة الثابتة (بالأشهر)' },
  '一次付款，无自动续费；同档续购叠加会员时间。跨档叠加尚未支持。': {
    en: 'One payment, with no automatic renewal. Renewing the same plan adds membership time. Combining different tiers is not yet supported.',
    ar: 'دفعة واحدة دون تجديد تلقائي. يضيف تجديد الباقة نفسها وقتًا للعضوية. جمع مستويات مختلفة غير مدعوم بعد.',
  },
  '算力到期封存3个月，同档有效续费恢复；封存逾期清零。': {
    en: 'Expired credits are archived for 3 months and can be restored by an eligible renewal of the same plan. Credits are cleared when the archive period ends.',
    ar: 'تُحفظ الأرصدة المنتهية في الأرشيف لمدة 3 أشهر، ويمكن استعادتها بتجديد مؤهل للباقة نفسها. تُصفّر الأرصدة بعد انتهاء مدة الأرشفة.',
  },
  '此套餐采用历史无封存合同，额度随对应购买期限到期。': {
    en: 'This plan uses a historical contract without archiving. Credits expire with the corresponding purchase term.',
    ar: 'تستخدم هذه الباقة عقدًا سابقًا دون أرشفة. تنتهي الأرصدة بانتهاء مدة الشراء المقابلة.',
  },
  '活动内发起原支付会话；异步付款可在截止后完成。': {
    en: 'Start the original payment session during the promotion. Asynchronous payment may complete after the deadline.',
    ar: 'ابدأ جلسة الدفع الأصلية خلال العرض. قد يكتمل الدفع غير المتزامن بعد الموعد النهائي.',
  },
  刷新套餐: { en: 'Refresh plans', ar: 'تحديث الباقات' },
  保存团队开通订单: { en: 'Save team activation order', ar: 'حفظ طلب تفعيل الفريق' },
  '此账号已占用一个团队名额，转让或解散不会恢复名额': {
    en: 'This account has used its team slot. Transferring or dissolving the team does not restore it.',
    ar: 'استخدم هذا الحساب خانة الفريق الخاصة به. لا تُستعاد الخانة بنقل الفريق أو حلّه.',
  },
  '团队开通需要已批准且明确适用于团队的固定期会员套餐，个人会员或席位数不能替代': {
    en: 'Team activation requires an approved fixed-term membership plan explicitly intended for teams. Personal membership or a seat count cannot replace it.',
    ar: 'يتطلب تفعيل الفريق باقة عضوية محددة المدة ومعتمدة ومخصصة صراحةً للفرق. لا تحل العضوية الشخصية أو عدد المقاعد محلها.',
  },
  仅预留创建者可处理此团队会员付款: {
    en: 'Only the account that reserved this team can manage its membership payment.',
    ar: 'يمكن فقط للحساب الذي حجز هذا الفريق إدارة دفع عضويته.',
  },
  团队开通需要账户会话: {
    en: 'Team activation requires an account session.',
    ar: 'يتطلب تفعيل الفريق جلسة حساب.',
  },
  团队套餐尚未正式批准: {
    en: 'The team plan has not been officially approved.',
    ar: 'لم تُعتمد باقة الفريق رسميًا بعد.',
  },
  '支付服务未配置，暂不可开通团队': {
    en: 'Payment is not configured. Team activation is unavailable.',
    ar: 'لم تُضبط خدمة الدفع. تفعيل الفريق غير متاح.',
  },
  '此账号已占用一个团队名额，已有团队保持可用；转让或解散不会恢复名额。': {
    en: 'This account has used its team slot. The existing team remains available; transferring or dissolving it does not restore the slot.',
    ar: 'استخدم هذا الحساب خانة الفريق الخاصة به. يظل الفريق الحالي متاحًا؛ ولا تُستعاد الخانة بنقله أو حلّه.',
  },
  '本机演示可体验一个团队，不代表已购买团队会员。': {
    en: 'The local demo lets you try one team. It does not represent a purchased team membership.',
    ar: 'تتيح النسخة التجريبية المحلية تجربة فريق واحد. لا يمثل ذلك شراء عضوية فريق.',
  },
  '尚未配置明确适用于团队的固定期会员套餐，暂不可开通团队。': {
    en: 'No fixed-term membership plan explicitly intended for teams is configured. Team activation is unavailable.',
    ar: 'لم تُضبط باقة عضوية محددة المدة ومخصصة صراحةً للفرق. تفعيل الفريق غير متاح.',
  },
  '每个账号限开通一个团队；付款核验完成后才开放团队。': {
    en: 'Each account can activate one team. Access opens only after payment is verified.',
    ar: 'يمكن لكل حساب تفعيل فريق واحد. يُفتح الوصول بعد التحقق من الدفع فقط.',
  },
  '此账号已占用团队名额或正在使用演示模式，请返回团队入口': {
    en: 'This account has used its team slot or is using demo mode. Return to the team entry.',
    ar: 'استخدم هذا الحساب خانة الفريق أو يعمل في الوضع التجريبي. عُد إلى مدخل الفريق.',
  },
  套餐不存在: { en: 'The plan does not exist.', ar: 'الباقة غير موجودة.' },
  '已有团队付款草稿或待核对付款，请先处理原订单': {
    en: 'A team payment draft or payment awaiting verification already exists. Handle the original order first.',
    ar: 'توجد مسودة دفع للفريق أو دفعة بانتظار التحقق. عالج الطلب الأصلي أولًا.',
  },
};
