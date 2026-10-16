/** Static account and recovery copy. User identifiers and content never enter this table. */
export const ACCOUNT_TRANSLATIONS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>> =
  {
    前往本地密码设置: {
      en: 'Go to local password settings',
      ar: 'الانتقال إلى إعدادات كلمة المرور المحلية',
    },
    '微信授权地址不正确，请联系实例管理员': {
      en: 'The WeChat authorization address is invalid. Contact your instance administrator.',
      ar: 'عنوان تفويض WeChat غير صالح. تواصل مع مسؤول النسخة.',
    },
    '微信验证未完成，未创建新的登录会话。请重新发起。': {
      en: 'WeChat verification did not complete. No new session was created. Please start again.',
      ar: 'لم يكتمل تحقق WeChat، ولم تُنشأ جلسة دخول جديدة. ابدأ مجددًا.',
    },
    手机验证码登录: { en: 'Sign in with a phone code', ar: 'الدخول برمز الهاتف' },
    微信扫码登录: { en: 'Sign in with WeChat', ar: 'الدخول عبر WeChat' },
    '仅支持中国大陆手机号。首次验证后仍需补全账户，并遵守注册或邀请规则。': {
      en: 'Mainland China mobile numbers only. First-time verification still requires account registration and the registration or invitation rules.',
      ar: 'تُدعم أرقام الجوال في البر الرئيسي للصين فقط. يتطلب التحقق الأول إكمال الحساب والالتزام بقواعد التسجيل أو الدعوة.',
    },
    中国大陆手机号: { en: 'Mainland China mobile number', ar: 'رقم جوال في البر الرئيسي للصين' },
    '申请已受理。请填写实际收到的六位验证码，5分钟内有效，最多尝试5次。受理不代表运营商已送达。': {
      en: 'Request accepted. Enter the six-digit code you actually receive. It expires in 5 minutes, with up to 5 attempts. Acceptance does not confirm delivery.',
      ar: 'قُبل الطلب. أدخل الرمز المكوّن من ستة أرقام الذي وصلك فعلًا. تنتهي صلاحيته خلال 5 دقائق، مع 5 محاولات كحد أقصى. القبول لا يؤكد التسليم.',
    },
    短信验证码: { en: 'SMS verification code', ar: 'رمز التحقق النصي' },
    更换号码或重新申请: { en: 'Change number or request again', ar: 'تغيير الرقم أو إعادة الطلب' },
    验证并继续: { en: 'Verify and continue', ar: 'تحقق ومتابعة' },
    申请短信验证码: { en: 'Request an SMS code', ar: 'طلب رمز نصي' },
    绑定手机号: { en: 'Link phone number', ar: 'ربط رقم الهاتف' },
    换绑手机号: { en: 'Change linked phone number', ar: 'تغيير رقم الهاتف المرتبط' },
    解除手机号: { en: 'Unlink phone number', ar: 'إلغاء ربط رقم الهاتف' },
    关联微信: { en: 'Link WeChat', ar: 'ربط WeChat' },
    解除微信关联: { en: 'Unlink WeChat', ar: 'إلغاء ربط WeChat' },
    手机与微信登录: { en: 'Phone and WeChat sign-in', ar: 'تسجيل الدخول بالهاتف وWeChat' },
    '本系统尚未记录邮箱验证。短信或微信关联不会把自填邮箱标记为已验证。': {
      en: 'This instance has no email verification record. Linking SMS or WeChat does not verify the email address you entered.',
      ar: 'لا تسجّل هذه النسخة تحققًا من البريد الإلكتروني. ربط الرسائل النصية أو WeChat لا يتحقق من عنوان البريد الذي أدخلته.',
    },
    请先: { en: 'First, ', ar: 'أولًا، ' },
    安全设置本地密码: { en: 'securely set a local password', ar: 'عيّن كلمة مرور محلية بأمان' },
    '，再绑定或解除其他登录方式。': {
      en: ', then link or unlink other sign-in methods.',
      ar: '، ثم اربط طرق الدخول الأخرى أو ألغِ ربطها.',
    },
    手机号: { en: 'Phone number', ar: 'رقم الهاتف' },
    '已验证：': { en: 'Verified: ', ar: 'تم التحقق: ' },
    尚未绑定手机号: { en: 'No phone number linked', ar: 'لا يوجد رقم هاتف مرتبط' },
    微信: { en: 'WeChat', ar: 'WeChat' },
    已关联微信身份: { en: 'WeChat identity linked', ar: 'هوية WeChat مرتبطة' },
    尚未关联微信身份: { en: 'No WeChat identity linked', ar: 'لا توجد هوية WeChat مرتبطة' },
    账户登录方式: { en: 'Account sign-in methods', ar: 'طرق الدخول إلى الحساب' },
    '请重新确认本地密码。成功变更后，其他网页会话会退出。': {
      en: 'Confirm your local password again. Other browser sessions will be signed out after a successful change.',
      ar: 'أكّد كلمة المرور المحلية مجددًا. ستُنهى جلسات المتصفح الأخرى بعد نجاح التغيير.',
    },
    '先验证当前号码 {phone}。旧号不能使用时，请勿继续换绑。': {
      en: 'Verify your current number {phone} first. Do not continue if you cannot use it.',
      ar: 'تحقق أولًا من رقمك الحالي {phone}. لا تتابع إذا تعذّر استخدامه.',
    },
    '原号码已验证，请填写并验证新号码。完整成功前原号码继续保留。': {
      en: 'Your current number is verified. Enter and verify the new number. The old number remains linked until the change completes.',
      ar: 'تم التحقق من الرقم الحالي. أدخل الرقم الجديد وتحقق منه. يبقى الرقم القديم مرتبطًا حتى اكتمال التغيير.',
    },
    新的中国大陆手机号: {
      en: 'New Mainland China mobile number',
      ar: 'رقم جوال جديد في البر الرئيسي للصين',
    },
    '短信申请已受理，5分钟内有效。请填写实际收到的验证码。': {
      en: 'SMS request accepted. Enter the code you actually receive within 5 minutes.',
      ar: 'قُبل طلب الرسالة. أدخل الرمز الذي يصلك فعلًا خلال 5 دقائق.',
    },
    确认验证码: { en: 'Confirm verification code', ar: 'تأكيد رمز التحقق' },
    确认解除: { en: 'Confirm unlinking', ar: 'تأكيد إلغاء الربط' },
    验证并前往微信: { en: 'Verify and continue to WeChat', ar: 'تحقق وتابع إلى WeChat' },
    申请验证短信: { en: 'Request verification SMS', ar: 'طلب رسالة التحقق' },
    补全账户注册: { en: 'Complete account registration', ar: 'إكمال تسجيل الحساب' },
    '手机或微信已完成本次身份验证。请补全真实邮箱和本地密码；自填邮箱尚未验证。现有邮箱需要先登录，再在账户设置显式绑定，不会自动合并账户。':
      {
        en: 'Your phone or WeChat verification is complete. Add a real email address and local password. The email you enter is not verified. If an account already uses that email, sign in to it and explicitly link this identity in settings. Accounts are never merged automatically.',
        ar: 'اكتمل تحقق الهاتف أو WeChat. أضف بريدًا إلكترونيًا حقيقيًا وكلمة مرور محلية. البريد الذي تدخله غير متحقق منه. إذا كان البريد لحساب قائم، فسجّل دخوله واربط هذه الهوية صراحةً من الإعدادات. لا تُدمج الحسابات تلقائيًا.',
      },
    '注册验证已失效，请从登录页重新开始。': {
      en: 'Registration verification expired. Start again from the sign-in page.',
      ar: 'انتهت صلاحية تحقق التسجيل. ابدأ مجددًا من صفحة الدخول.',
    },
    两次输入的密码不一致: { en: 'The passwords do not match', ar: 'كلمتا المرور غير متطابقتين' },
    '已保留发起页面的团队邀请；注册邮箱必须与邀请目标一致。': {
      en: 'The team invitation from the original page is retained. Your registration email must match the invitation.',
      ar: 'حُفظت دعوة الفريق من الصفحة الأصلية. يجب أن يطابق بريد التسجيل عنوان الدعوة.',
    },
    账户称呼: { en: 'Display name', ar: 'اسم العرض' },
    真实账户邮箱: { en: 'Real account email', ar: 'البريد الحقيقي للحساب' },
    本地登录密码: { en: 'Local sign-in password', ar: 'كلمة مرور الدخول المحلية' },
    '12至128个字符。': { en: '12 to 128 characters.', ar: 'من 12 إلى 128 حرفًا.' },
    确认本地密码: { en: 'Confirm local password', ar: 'تأكيد كلمة المرور المحلية' },
    完成注册并登录: { en: 'Complete registration and sign in', ar: 'إكمال التسجيل وتسجيل الدخول' },
    返回已有账户登录: { en: 'Back to existing account sign-in', ar: 'العودة للدخول إلى حساب قائم' },
    本地密码: { en: 'Local password', ar: 'كلمة مرور محلية' },
    '已设置本地密码。忘记密码时可通过已启用的邮件恢复流程重新设置。': {
      en: 'A local password is set. If you forget it, use email recovery when this instance has enabled it.',
      ar: 'عُيّنت كلمة مرور محلية. إذا نسيتها، فاستخدم استرداد البريد عندما تفعّله هذه النسخة.',
    },
    '尚未设置本地密码。验证账户邮箱后可添加密码登录，已有谷歌关联会保留。': {
      en: 'No local password is set. Verify your account email to add password sign-in. Your Google link will remain.',
      ar: 'لم تُعيّن كلمة مرور محلية. تحقق من بريد الحساب لإضافة الدخول بكلمة مرور. سيبقى ربط Google محفوظًا.',
    },
    '此实例尚未启用邮件密码恢复，请继续使用已有登录方式。': {
      en: 'Email password recovery is disabled on this instance. Continue using an existing sign-in method.',
      ar: 'استرداد كلمة المرور بالبريد معطّل في هذه النسخة. تابع باستخدام طريقة دخول قائمة.',
    },
    通过邮件重新设置密码: { en: 'Reset password by email', ar: 'إعادة تعيين كلمة المرور بالبريد' },
    验证邮件将发送至: {
      en: 'The verification email will be sent to ',
      ar: 'ستُرسل رسالة التحقق إلى ',
    },
    '。请在发起操作的同一浏览器会话中打开邮件链接。': {
      en: '. Open the email link in the same browser session that made this request.',
      ar: '. افتح رابط البريد في جلسة المتصفح نفسها التي بدأت الطلب.',
    },
    '设置请求已受理，请检查账户邮箱。若未收到，请等待一分钟后重试；邮件是否实际收到取决于投递服务。':
      {
        en: 'Setup requested. Check your account email. If nothing arrives, wait one minute before requesting again. Actual receipt depends on the mail delivery service.',
        ar: 'قُبل طلب الإعداد. تحقق من بريد الحساب. إذا لم تصل الرسالة، فانتظر دقيقة قبل إعادة الطلب. يعتمد الاستلام الفعلي على خدمة تسليم البريد.',
      },
    重新申请设置邮件: { en: 'Request setup email again', ar: 'إعادة طلب رسالة الإعداد' },
    发送设置本地密码邮件: {
      en: 'Send local password setup email',
      ar: 'إرسال رسالة إعداد كلمة مرور محلية',
    },
    设置新的本地密码: { en: 'Set a new local password', ar: 'تعيين كلمة مرور محلية جديدة' },
    忘记密码: { en: 'Forgot password', ar: 'نسيت كلمة المرور' },
    '此实例尚未启用邮件密码恢复。请使用已有登录方式，或联系实例管理员启用邮件服务。': {
      en: 'Email password recovery is disabled on this instance. Use an existing sign-in method or ask your instance administrator to enable email.',
      ar: 'استرداد كلمة المرور بالبريد معطّل في هذه النسخة. استخدم طريقة دخول قائمة أو اطلب من المسؤول تفعيل البريد.',
    },
    '链接已失效或缺少令牌，请重新申请。': {
      en: 'This link is expired or missing its token. Request a new one.',
      ar: 'انتهت صلاحية الرابط أو رمز التحقق مفقود. اطلب رابطًا جديدًا.',
    },
    '如果此邮箱可通过密码恢复，你将收到恢复邮件。请检查邮箱和垃圾邮件文件夹，也可继续使用已有登录方式。':
      {
        en: 'If this email is eligible for password recovery, you will receive an email. Check your inbox and spam folder, or continue using an existing sign-in method.',
        ar: 'إذا كان هذا البريد مؤهلًا لاسترداد كلمة المرور، فستصلك رسالة. تحقق من الوارد والبريد العشوائي، أو تابع بطريقة دخول قائمة.',
      },
    '成功后所有网页会话都会退出。请重新登录，并在接口密钥管理页检查独立凭据。': {
      en: 'All browser sessions will be signed out after success. Sign in again and review independent credentials on the API key management page.',
      ar: 'ستُنهى جميع جلسات المتصفح بعد النجاح. سجّل الدخول مجددًا وراجع بيانات الاعتماد المستقلة في صفحة إدارة مفاتيح الواجهة.',
    },
    新密码: { en: 'New password', ar: 'كلمة المرور الجديدة' },
    确认新密码: { en: 'Confirm new password', ar: 'تأكيد كلمة المرور الجديدة' },
    '输入现有账户邮箱。仅通过谷歌登录的账户，请先使用谷歌登录，再到设置添加本地密码。': {
      en: 'Enter your existing account email. For Google-only accounts, sign in with Google first and add a local password in settings.',
      ar: 'أدخل بريد حسابك القائم. للحسابات التي تستخدم Google فقط، سجّل الدخول عبر Google أولًا ثم أضف كلمة مرور محلية من الإعدادات.',
    },
    保存密码并退出会话: {
      en: 'Save password and sign out sessions',
      ar: 'حفظ كلمة المرور وإنهاء الجلسات',
    },
    申请密码恢复邮件: {
      en: 'Request password recovery email',
      ar: 'طلب رسالة استرداد كلمة المرور',
    },
    返回登录: { en: 'Back to sign-in', ar: 'العودة لتسجيل الدخول' },
    重新申请恢复邮件: { en: 'Request another recovery email', ar: 'طلب رسالة استرداد أخرى' },
    '验证已失效或未通过，请重新申请': {
      en: 'Verification expired or failed. Request it again.',
      ar: 'انتهت صلاحية التحقق أو فشل. اطلبه مجددًا.',
    },
    请在发起操作的原登录会话中继续: {
      en: 'Continue in the original signed-in session that started this operation',
      ar: 'تابع في جلسة الدخول الأصلية التي بدأت هذا الإجراء',
    },
    '请先通过账户邮箱安全设置本地密码，再管理其他登录方式': {
      en: 'Securely set a local password through your account email before managing other sign-in methods',
      ar: 'عيّن كلمة مرور محلية بأمان عبر بريد الحساب قبل إدارة طرق الدخول الأخرى',
    },
    短信登录尚未启用或配置不完整: {
      en: 'SMS sign-in is disabled or not fully configured',
      ar: 'الدخول بالرسائل النصية معطّل أو غير مكتمل الإعداد',
    },
    微信登录尚未启用或配置不完整: {
      en: 'WeChat sign-in is disabled or not fully configured',
      ar: 'الدخول عبر WeChat معطّل أو غير مكتمل الإعداد',
    },
    短信配置不完整: { en: 'SMS configuration is incomplete', ar: 'إعداد الرسائل النصية غير مكتمل' },
    短信登录未启用: { en: 'SMS sign-in is disabled', ar: 'الدخول بالرسائل النصية معطّل' },
    微信配置不完整: { en: 'WeChat configuration is incomplete', ar: 'إعداد WeChat غير مكتمل' },
    微信登录未启用: { en: 'WeChat sign-in is disabled', ar: 'الدخول عبر WeChat معطّل' },
    '请求过于频繁，请稍后再试': {
      en: 'Too many requests. Please try again later.',
      ar: 'طلبات كثيرة جدًا. حاول لاحقًا.',
    },
    '已有手机号，请使用换绑流程': {
      en: 'A phone number is already linked. Use the change-number flow.',
      ar: 'يوجد رقم هاتف مرتبط بالفعل. استخدم مسار تغيير الرقم.',
    },
    '此身份已关联其他账户，请使用原账户登录': {
      en: 'This identity belongs to another account. Sign in to the original account.',
      ar: 'هذه الهوية مرتبطة بحساب آخر. سجّل الدخول إلى الحساب الأصلي.',
    },
    '短信尚未受理或已失败，请稍后重新申请': {
      en: 'The SMS request is pending or failed. Request a new one later.',
      ar: 'طلب الرسالة معلّق أو فشل. اطلب رسالة جديدة لاحقًا.',
    },
    '此身份或账户已有其他关联，请先登录原账户处理': {
      en: 'This identity or account has another link. Sign in to the original account to resolve it.',
      ar: 'لهذه الهوية أو الحساب ارتباط آخر. سجّل الدخول إلى الحساب الأصلي لمعالجته.',
    },
    '微信标识发生冲突，请登录原账户处理': {
      en: 'The WeChat identity conflicts with an existing link. Sign in to the original account.',
      ar: 'تتعارض هوية WeChat مع ارتباط قائم. سجّل الدخول إلى الحساب الأصلي.',
    },
    '此邮箱已有账户，请先登录，再在设置中显式绑定': {
      en: 'This email already has an account. Sign in first, then explicitly link this identity in settings.',
      ar: 'يوجد حساب لهذا البريد. سجّل الدخول أولًا، ثم اربط الهوية صراحةً من الإعدادات.',
    },
    请先设置可用的本地密码: {
      en: 'Set a usable local password first',
      ar: 'عيّن كلمة مرور محلية صالحة أولًا',
    },
    账户操作必须从本站发起: {
      en: 'Account operations must start from this site',
      ar: 'يجب بدء إجراءات الحساب من هذا الموقع',
    },
    '验证会话已失效，请重新申请': {
      en: 'The verification session expired. Request it again.',
      ar: 'انتهت صلاحية جلسة التحقق. اطلبها مجددًا.',
    },
    '链接已失效，请重新申请': {
      en: 'The link expired. Request a new one.',
      ar: 'انتهت صلاحية الرابط. اطلب رابطًا جديدًا.',
    },
    '此实例尚未启用邮件密码恢复，请使用已有登录方式': {
      en: 'Email password recovery is disabled on this instance. Use an existing sign-in method.',
      ar: 'استرداد كلمة المرور بالبريد معطّل في هذه النسخة. استخدم طريقة دخول قائمة.',
    },
    '请在发起设置的同一浏览器登录会话中打开链接，或重新登录并申请': {
      en: 'Open the link in the same signed-in browser session that requested setup, or sign in and request again.',
      ar: 'افتح الرابط في جلسة المتصفح نفسها التي طلبت الإعداد، أو سجّل الدخول واطلبه مجددًا.',
    },
    此账户无需设置首个本地密码: {
      en: 'This account does not need first-time local password setup',
      ar: 'هذا الحساب لا يحتاج إلى إعداد كلمة مرور محلية للمرة الأولى',
    },
    密码操作必须从本站发起: {
      en: 'Password operations must start from this site',
      ar: 'يجب بدء إجراءات كلمة المرور من هذا الموقع',
    },
    请先登录账户: { en: 'Sign in to your account first', ar: 'سجّل الدخول إلى حسابك أولًا' },
    展开创作区: { en: 'Expand creation panel', ar: 'توسيع لوحة الإنشاء' },
    收起创作区: { en: 'Collapse creation panel', ar: 'طي لوحة الإنشاء' },
  };
