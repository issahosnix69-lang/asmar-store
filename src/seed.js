/* Starting content for a brand-new shop.
 *
 * Everything here is editable in the admin and stops being used the moment the
 * owner saves their own. It exists so a fresh install is a working store rather
 * than an empty page, and so the demo screenshots have something in them.
 */

export const SEED_CATEGORIES = ["Streaming", "Music", "Gaming", "Productivity", "Learning"];

export const SEED_CATALOG = [
  { id: "p1", name: "Netflix", category: "Streaming", note: "Private profile, 4K", noteAr: "بروفايل خاص، جودة 4K", active: true, featured: true,
    warrantyDays: 30,
    description:
      "A private Netflix profile on a premium plan — your own profile, your own watch history, nobody else touching it.\n\n" +
      "- Full 4K Ultra HD where the title supports it\n- Your own profile and PIN\n- Works on TV, phone, tablet and laptop\n- Replaced free if it stops working during the period",
    variants: [{ label: "1 month", price: 4.5 }, { label: "3 months", price: 12 }, { label: "6 months", price: 22 }] },
  { id: "p2", name: "Shahid VIP", category: "Streaming", note: "Arabic library, full access", noteAr: "المكتبة العربية كاملة", active: true, featured: true,
    warrantyDays: 30,
    description:
      "The full Shahid VIP library — Arabic series, films and live MBC channels, with no ads.\n\n" +
      "- Complete Arabic catalogue\n- Live MBC channels\n- Download and watch offline\n- Works everywhere in Lebanon",
    variants: [{ label: "1 month", price: 3.5 }, { label: "3 months", price: 9 }, { label: "12 months", price: 30 }] },
  { id: "p3", name: "Disney+", category: "Streaming", note: "Includes Star", noteAr: "يشمل قسم Star", active: true, warrantyDays: 30,
    description: "Disney+ with the Star hub included — Disney, Pixar, Marvel, Star Wars and general entertainment in one account.",
    variants: [{ label: "1 month", price: 4 }, { label: "6 months", price: 20 }] },
  { id: "p4", name: "Prime Video", category: "Streaming", note: "Full catalogue", noteAr: "المكتبة كاملة", active: true, warrantyDays: 30,
    description: "Amazon Prime Video with the full catalogue and Amazon Originals.",
    variants: [{ label: "1 month", price: 3 }, { label: "3 months", price: 8 }] },
  { id: "p5", name: "Spotify Premium", category: "Music", note: "Own account, no ads", noteAr: "حساب خاص بك، بدون إعلانات", active: true, featured: true,
    warrantyDays: 30,
    description:
      "Spotify Premium on your own account — not a family slot that disappears next month.\n\n" +
      "- No ads, ever\n- Download for offline listening\n- Highest audio quality\n- Keep your existing playlists",
    variants: [{ label: "1 month", price: 3 }, { label: "3 months", price: 8 }, { label: "12 months", price: 26 }] },
  { id: "p6", name: "Apple Music", category: "Music", note: "Lossless audio", noteAr: "جودة صوت بدون ضغط", active: true, warrantyDays: 30,
    description: "Apple Music with lossless and spatial audio, on your own Apple ID.",
    variants: [{ label: "1 month", price: 3.5 }, { label: "6 months", price: 18 }] },
  { id: "p7", name: "YouTube Premium", category: "Music", note: "No ads + background play", noteAr: "بدون إعلانات وتشغيل بالخلفية", active: true, warrantyDays: 30,
    description:
      "YouTube without ads, plus background play and YouTube Music.\n\n" +
      "- No ads on any video\n- Keeps playing with the screen off\n- Download videos\n- YouTube Music included",
    variants: [{ label: "1 month", price: 3 }, { label: "6 months", price: 16 }] },
  { id: "p8", name: "Canva Pro", category: "Productivity", note: "Full templates + brand kit", noteAr: "كل القوالب وأدوات الهوية", active: true, warrantyDays: 30,
    description: "Canva Pro with every premium template, the background remover, and brand kits.",
    variants: [{ label: "1 month", price: 4 }, { label: "12 months", price: 25 }] },
  { id: "p9", name: "ChatGPT Plus", category: "Productivity", note: "Priority access", noteAr: "أولوية في الوصول", active: true, featured: true,
    warrantyDays: 30,
    description: "ChatGPT Plus with priority access to the newest models, faster responses and higher limits.",
    variants: [{ label: "1 month", price: 22 }] },
  { id: "p10", name: "Discord Nitro", category: "Gaming", note: "Full boosts included", noteAr: "يشمل كل المزايا والبوستات", active: true, warrantyDays: 30,
    description: "Discord Nitro with server boosts, bigger uploads, HD streaming and custom emoji everywhere.",
    variants: [{ label: "1 month", price: 5 }, { label: "12 months", price: 45 }] },
  { id: "p11", name: "Crunchyroll", category: "Streaming", note: "Anime library, Mega Fan tier", noteAr: "مكتبة أنمي، باقة Mega Fan", active: true, warrantyDays: 30,
    description: "Crunchyroll Mega Fan — the full anime catalogue, ad-free, with simulcasts an hour after Japan.",
    variants: [{ label: "1 month", price: 3.5 }, { label: "3 months", price: 9 }] },
  { id: "p12", name: "Duolingo Super", category: "Learning", note: "Unlimited hearts", noteAr: "قلوب غير محدودة", active: true, warrantyDays: 30,
    description: "Duolingo Super — unlimited hearts, no ads, and unlimited legendary attempts.",
    variants: [{ label: "1 month", price: 3 }, { label: "12 months", price: 20 }] },
];

export const SEED_FAQ = [
  { q: "How fast is delivery?",
    a: "Most orders are delivered within a few minutes. During busy hours it can take up to an hour — you will always hear from us on WhatsApp.",
    qAr: "كم تستغرق مدة التسليم؟",
    aAr: "أغلب الطلبات تُسلَّم خلال دقائق. في أوقات الذروة قد تصل إلى ساعة — وفي كل الحالات نبقى على تواصل معك على واتساب." },
  { q: "How do I receive my subscription?",
    a: "Your login details are sent to the email you enter at checkout, and a confirmation goes to your WhatsApp number.",
    qAr: "كيف يصلني الاشتراك؟",
    aAr: "تصلك بيانات الدخول على البريد الإلكتروني الذي تدخله عند إتمام الطلب، ويصلك التأكيد على رقم الواتساب." },
  { q: "What if my subscription stops working?",
    a: "Message us on WhatsApp with your order code. Every subscription is covered for its full period — we replace it, no argument.",
    qAr: "ماذا لو توقف الاشتراك عن العمل؟",
    aAr: "راسلنا على واتساب مع رمز الطلب. كل اشتراك مضمون طوال مدته — نستبدله لك مباشرةً وبدون نقاش." },
  { q: "How can I pay?",
    a: "Whish Money, OMT, or cash on delivery inside Tripoli. Pick your method at checkout and we confirm before delivering.",
    qAr: "ما هي طرق الدفع المتاحة؟",
    aAr: "Whish Money أو OMT أو نقداً عند التسليم داخل طرابلس. اختر الطريقة عند إتمام الطلب ونؤكد معك قبل التسليم." },
  { q: "Are the accounts private?",
    a: "Yes. Unless a plan is clearly marked as shared, you get your own profile and nobody else uses it.",
    qAr: "هل الحسابات خاصة؟",
    aAr: "نعم. ما لم تكن الباقة مكتوباً عليها أنها مشتركة، تحصل على بروفايل خاص بك لا يستخدمه أحد غيرك." },
  { q: "Do I need an account to order?",
    a: "Yes. Message us on WhatsApp and we create one for you in a minute, then send you the email and password. There is no self sign-up — it is how we keep track of who is who and where your balance sits.",
    qAr: "هل أحتاج حساباً لأطلب؟",
    aAr: "نعم. راسلنا على واتساب وننشئ لك حساباً خلال دقيقة، ونرسل لك البريد وكلمة المرور. لا يوجد تسجيل ذاتي — بهذه الطريقة نعرف من أنت وأين يوجد رصيدك." },
  { q: "What is the balance for?",
    a: "You can transfer money once and spend it over several orders, instead of sending a transfer every time. Send the transfer, upload a picture of it, and we add it to your balance by hand — usually within minutes. Anything left is yours; ask us and we send it back.",
    qAr: "ما فائدة الرصيد؟",
    aAr: "يمكنك تحويل مبلغ مرة واحدة واستخدامه على عدة طلبات، بدل تحويل المبلغ في كل مرة. حوّل المبلغ، ارفع صورة التحويل، ونضيفه إلى رصيدك يدوياً — عادةً خلال دقائق. وأي مبلغ متبقٍ يبقى لك، اطلبه ونعيده إليك." },
];

/* Left empty on purpose. Inventing testimonials would be lying to customers,
   and the admin has a Reviews tab for the real ones people send on WhatsApp. */
export const SEED_REVIEWS = [];

/* Display names only. The English name stays the key that products point at,
   so translating one never re-parents the catalogue. */
export const SEED_CATEGORY_NAMES_AR = {
  Streaming: "أفلام ومسلسلات",
  Music: "موسيقى",
  Gaming: "ألعاب",
  Productivity: "برامج وإنتاجية",
  Learning: "تعلّم",
};

export const SEED_PAGES = {
  about:
    "## Who we are\n" +
    "The Asmar Store is a small business in Tripoli, Lebanon selling genuine digital subscriptions — streaming, music, design tools and AI services — at prices that make sense here.\n\n" +
    "We are not a marketplace and not a bot. Every order is handled by a person, and the same person answers you on WhatsApp afterwards.\n\n" +
    "## Why buy from us\n" +
    "- Accounts are genuine and private unless a plan says otherwise\n" +
    "- Delivery in minutes, not days\n" +
    "- Every subscription is covered for its full period\n" +
    "- Pay in cash inside Tripoli, or online with Whish and OMT",
  terms:
    "## Your account\n" +
    "Ordering requires an account, which we create for you — there is no self sign-up. Message us on WhatsApp and we will make one and send you the password. Keep it to yourself: anything ordered from your account, and any balance spent from it, is treated as yours.\n\n" +
    "## Balance\n" +
    "You may hold a balance with us and spend it on future orders. It is money you have already paid us and it stays yours: ask at any time and we return whatever is left, by the same method you sent it. A balance is not a bank account, earns nothing, and is only good in this shop.\n\n" +
    "## Ordering\n" +
    "Placing an order on this site is a request to buy. The order is confirmed once we have received payment, or once we have agreed cash on delivery with you.\n\n" +
    "## Delivery\n" +
    "Subscription details are sent to the email address you enter at checkout, with a confirmation on WhatsApp. Delivery is usually within minutes and always within 24 hours. If we cannot deliver, you are refunded in full.\n\n" +
    "## Your responsibilities\n" +
    "- Do not change the password or recovery email on an account we supply, unless we tell you to\n" +
    "- Do not resell or share an account bought for personal use\n" +
    "- Give us a working email and WhatsApp number — we cannot deliver to a wrong address\n\n" +
    "## Pricing\n" +
    "Prices are in US dollars and are final. Nothing is added at checkout.\n\n" +
    "## Contact\n" +
    "Any question about these terms: message us on WhatsApp.",
  refund:
    "## Warranty\n" +
    "Every subscription is covered for its full period. If it stops working before the period ends, message us on WhatsApp with your order code and we replace it — no argument and no extra charge.\n\n" +
    "## What is covered\n" +
    "- The account stops working during the period you paid for\n" +
    "- The account is delivered wrong or does not match what you ordered\n" +
    "- We fail to deliver at all\n\n" +
    "## What is not covered\n" +
    "- You changed the password or recovery email yourself\n" +
    "- You shared the account with people outside your household\n" +
    "- The service itself is unavailable in your country for reasons outside our control\n\n" +
    "## Refunds\n" +
    "If we cannot deliver, or cannot replace a broken subscription, you get a full refund by the same method you paid with. Refunds are sent within 48 hours of being agreed.\n\n" +
    "## Cancelling\n" +
    "An order can be cancelled free of charge any time before it is delivered. Once the login details are sent, the warranty above applies instead.",
  privacy:
    "## What we collect\n" +
    "Only what an order needs: your name, WhatsApp number, email address, and any note you write. Nothing else.\n\n" +
    "## Why we collect it\n" +
    "- Your email is where the subscription is delivered\n" +
    "- Your WhatsApp number is how we confirm and support the order\n" +
    "- Your name identifies the order when you contact us\n\n" +
    "## What we do not do\n" +
    "We do not sell your details, we do not pass them to advertisers, and we do not send marketing you did not ask for.\n\n" +
    "## Payments\n" +
    "We never see or store your card details. Online payments are handled on the payment provider's own page.\n\n" +
    "## Keeping and deleting\n" +
    "Order records are kept so we can honour the warranty. Ask us on WhatsApp and we will delete your details once the warranty period has passed.",
};

export const SEED_PAGES_AR = {
  about:
    "## من نحن\n" +
    "متجر أسمر هو عمل صغير من طرابلس، لبنان، متخصص ببيع الاشتراكات الرقمية الأصلية — بث، موسيقى، برامج تصميم وأدوات ذكاء اصطناعي — بأسعار منطقية لسوقنا.\n\n" +
    "لسنا منصة وسيطة ولسنا روبوتاً. كل طلب يتابعه شخص حقيقي، وهو نفسه من يرد عليك على واتساب بعد الشراء.\n\n" +
    "## لماذا تشتري منا\n" +
    "- حسابات أصلية وخاصة، إلا إذا ذُكر غير ذلك في الباقة\n" +
    "- تسليم خلال دقائق لا أيام\n" +
    "- كل اشتراك مضمون طوال مدته\n" +
    "- ادفع نقداً داخل طرابلس، أو أونلاين عبر Whish وOMT",
  terms:
    "## حسابك\n" +
    "الطلب يحتاج حساباً ننشئه لك نحن — لا يوجد تسجيل ذاتي. راسلنا على واتساب وننشئ لك حساباً ونرسل لك كلمة المرور. احتفظ بها لنفسك: أي طلب يُنفَّذ من حسابك، وأي رصيد يُصرف منه، يُعتبر منك.\n\n" +
    "## الرصيد\n" +
    "يمكنك الاحتفاظ برصيد لدينا واستخدامه في طلباتك القادمة. هو مال دفعته مسبقاً ويبقى ملكك: اطلبه في أي وقت ونعيد لك ما تبقّى بنفس طريقة التحويل. الرصيد ليس حساباً مصرفياً، ولا يحقق أي عائد، ولا يُستخدم إلا في هذا المتجر.\n\n" +
    "## الطلب\n" +
    "إرسال الطلب عبر الموقع هو طلب شراء. يُعتبر الطلب مؤكداً بعد استلامنا للدفعة، أو بعد الاتفاق معك على الدفع عند التسليم.\n\n" +
    "## التسليم\n" +
    "تُرسَل بيانات الاشتراك إلى البريد الإلكتروني الذي تدخله عند إتمام الطلب، مع تأكيد على واتساب. التسليم عادةً خلال دقائق وبحد أقصى ٢٤ ساعة. وإذا تعذّر علينا التسليم، تُعاد إليك كامل قيمة الطلب.\n\n" +
    "## مسؤولياتك\n" +
    "- لا تغيّر كلمة المرور أو بريد الاسترداد للحساب الذي نزوّدك به، إلا إذا طلبنا منك ذلك\n" +
    "- لا تُعد بيع أو مشاركة حساب اشتريته للاستخدام الشخصي\n" +
    "- زوّدنا ببريد ورقم واتساب صحيحين — لا يمكننا التسليم إلى عنوان خاطئ\n\n" +
    "## الأسعار\n" +
    "الأسعار بالدولار الأميركي ونهائية. لا تُضاف أي رسوم عند الدفع.\n\n" +
    "## للتواصل\n" +
    "أي سؤال حول هذه الشروط: راسلنا على واتساب.",
  refund:
    "## الضمان\n" +
    "كل اشتراك مضمون طوال مدته. إذا توقف عن العمل قبل انتهاء المدة، راسلنا على واتساب مع رمز الطلب ونستبدله لك — بدون نقاش وبدون أي رسوم إضافية.\n\n" +
    "## ما يشمله الضمان\n" +
    "- توقّف الحساب عن العمل خلال المدة التي دفعت ثمنها\n" +
    "- تسليم حساب خاطئ أو لا يطابق ما طلبته\n" +
    "- عدم تمكّننا من التسليم أصلاً\n\n" +
    "## ما لا يشمله الضمان\n" +
    "- تغييرك لكلمة المرور أو بريد الاسترداد بنفسك\n" +
    "- مشاركتك الحساب مع أشخاص خارج منزلك\n" +
    "- توقّف الخدمة نفسها في بلدك لأسباب خارجة عن إرادتنا\n\n" +
    "## الاسترجاع\n" +
    "إذا لم نتمكن من التسليم، أو من استبدال اشتراك متوقف، تُعاد إليك كامل القيمة بنفس طريقة الدفع، خلال ٤٨ ساعة من الاتفاق.\n\n" +
    "## الإلغاء\n" +
    "يمكن إلغاء أي طلب مجاناً قبل تسليمه. بعد إرسال بيانات الدخول يسري الضمان أعلاه بدلاً من الإلغاء.",
  privacy:
    "## ما الذي نجمعه\n" +
    "فقط ما يحتاجه الطلب: اسمك، رقم واتساب، بريدك الإلكتروني، وأي ملاحظة تكتبها. لا شيء غير ذلك.\n\n" +
    "## لماذا نجمعه\n" +
    "- بريدك هو المكان الذي يُسلَّم إليه الاشتراك\n" +
    "- رقم واتساب هو وسيلتنا لتأكيد الطلب ودعمك\n" +
    "- اسمك يُعرّف الطلب عند تواصلك معنا\n\n" +
    "## ما لا نفعله\n" +
    "لا نبيع بياناتك، ولا نمرّرها لأي معلن، ولا نرسل لك رسائل ترويجية لم تطلبها.\n\n" +
    "## الدفع\n" +
    "لا نرى بيانات بطاقتك ولا نخزّنها إطلاقاً. الدفع الإلكتروني يتم على صفحة مزوّد الدفع نفسه.\n\n" +
    "## الحفظ والحذف\n" +
    "نحتفظ بسجل الطلب لنتمكن من تنفيذ الضمان. راسلنا على واتساب ونحذف بياناتك بعد انتهاء مدة الضمان.",
};

export const SEED_SETTINGS = {
  categories: SEED_CATEGORIES,
  categoryImages: {},     // category name -> cover image data URL
  categoryNotes: {},      // category name -> one-line description
  categoryNotesAr: {},    // …and its Arabic
  categoryNamesAr: SEED_CATEGORY_NAMES_AR,
  whatsapp: "96176113048",
  pin: "1234",
  whishNote: "Whish Money → 76 113 048 (Ali Asmar)",
  omtNote: "OMT → send to Ali Asmar, Tripoli",
  heroTitle: "",        // blank falls back to the translated default
  heroSub: "",
  socials: { instagram: "", tiktok: "", channel: "" },
  faq: SEED_FAQ,
  reviews: SEED_REVIEWS,
  pages: SEED_PAGES,
  pagesAr: SEED_PAGES_AR,
};
