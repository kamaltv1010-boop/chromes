# Noor for Chrome

برنامج لـ Windows كيفتح **Google Chrome نفسو** ببروفايلات، كل بروفايل عندو **البصمات ديالو** (Canvas، WebGL، حجم الشاشة، البروسيسور والذاكرة، المنطقة الزمنية ديال الـ IP)، **البيانات ديالو** (cookies، حسابات، extensions، historique)، و**proxy ديالو** إلا بغيتي. نفس الحماية ديال [متصفح Noor](https://github.com/kamaltv1010-boop/noor-windows) ولكن داخل Chrome الحقيقي، فالمواقع كتشوف Chrome عادي بكلشي فيه.

وكاينة حتى **[Noor for Edge](#noor-for-edge-extension-)**: إضافة (extension) لـ Microsoft Edge (وChrome) فيها الحماية ديال Canvas وWebGL والصوت وClientRects، بلا برنامج.

## كيفاش كيخدم

- **بروفايلات**: كل بروفايل عندو folder ديالو (`--user-data-dir`) فChrome كيحتافظ فيه بكلشي ديالو، منفصل على البروفايلات الأخرى وعلى Chrome ديالك العادي.
- **الحماية**: فاش كتضغط *Open Chrome*، البرنامج كيفتح Chrome بـ debugging port ديالو (port عشوائي كيختارو البرنامج، على هاد الـ PC بوحدو، والمواقع ما تقدرش توصل ليه). كل صفحة، كل iframe، وكل worker (dedicated، service، shared، وحتى worker داخل worker) كياخد الحماية قبل أول سطر ديالو (نفس `scripts/protect.js` ديال Noor، المولّد من تطبيق iPhone)، والمنطقة الزمنية، والمتتبعين المحجوبين. الروابط اللي كتحل فـ onglet جديد، `window.open`، والـ onglets اللي Chrome كيرجعهم ملي كيتحل، حتى هوما.
- **ما كتبانش**: الحماية كتتصاوب داخل frame خاوي ومخبّي، باش الـ functions ديالها ما يبانوش فالـ stack ديال الأخطاء (بحال الـ functions الأصلية ديال Chrome)، حتى فالمواقع اللي عندها CSP قوي: ما كيتّكتب حتى كود من نص (`eval`)، فالـ CSP ما عندو ما يمنع وما يبلّغ للموقع. فالـ workers كتدخل ككود داخلي ديال DevTools اللي حتى هو ما كيبانش. العلامة اللي كتعرف بيها الحماية الـ functions ديالها كتبدّل مع كل تشغيل، فحتى موقع ما يقدر يعرفها ولا يقلّدها.
- **نفس القيم فكل frame**: الـ frames ديال الصفحة والـ windows اللي كتحل كيتقاسمو نفس الحماية، فالـ canvas اللي ترسم فالصفحة كيعطي نفس القيمة واخا تقراه من frame آخر.
- **حجم الشاشة من Chrome نفسو**: Chrome هو اللي كيوري للصفحة الشاشة ديال البروفايل، فالـ CSS (`@media (device-width)`) والـ JavaScript متوافقين. مواقع تسجيل الدخول كيشوفو الشاشة الحقيقية.
- **المنطقة الزمنية**: كتتجاب أوتوماتيكياً من الـ IP اللي كتشوفو المواقع وكتتطبق على الصفحات، باش الموقع يلقاها كتوافق مع الـ IP: الـ IP ديال الاتصال (أو VPN)، وللبروفايل اللي عندو proxy، الـ IP ديال الـ proxy (كتتسوّل من خلال الـ proxy نفسو).
- **المتتبعين**: Meta، Google Analytics، TikTok وغيرهم ما كيتحمّلوش على المواقع الأخرى (نفس القواعد ديال Noor، `rules/trackers.json`).
- **Proxy لكل بروفايل**: `socks5://host:port` أو `http://host:port`. WebRTC فهاد البروفايل ما كيخرج غير من الـ proxy، حيت Chrome كيدوّز WebRTC (UDP) برا الـ proxy، والموقع كان يقدر يشوف الـ IP الحقيقي ديالك حدا ديال الـ proxy.
- **navigator.webdriver**: Chrome كيحط `true` غير ملي يتحل بـ debugging pipe ولا بـ port كيختارو هو (بحال الأدوات ديال automation). البرنامج كيعطيه port محدد، فـ Chrome كيعتبرو developer عادي: `navigator.webdriver` كيبقى `false` بلا حتى flag، وبلا الشريط ديال «unsupported command-line flag».
- **New fingerprints**: كتطبّق على Chrome المفتوح ديال داك البروفايل بلا ما تسدو: الصفحات كياخدوها ملي تعاود تحلهم (F5).

Chrome المفتوح من Noor كيتسد فاش يتسد Noor، حيت بلا Noor الصفحات الجديدة غادي تبقى بلا حماية.

## الإضافات لكل بروفايل جديد 🧩

فالبرنامج كاين قسم **Extensions for New Profiles**: بروفايل خاص (نموذج) فين كتزيد الإضافات اللي بغيتي مرة وحدة، وكل بروفايل جديد كتصاوبو من بعد كيبدا بيهم أوتوماتيكياً.

1. ضغط **Open Chrome** فالقسم ديال **Extensions for New Profiles**.
2. فـ Chrome اللي تحل، زيد الإضافات بحال ديما: من Chrome Web Store («Add to Chrome»)، ولا Developer mode ← Load unpacked. تقدر حتى تبدّل الإعدادات ديالهم.
3. زيد بروفايل جديد: كيبدا بنفس الإضافات، بالإعدادات والبيانات ديالهم. (إلا كان Chrome ديال النموذج محلول، البرنامج كيسدّو قبل.)

- الإضافات اللي جاو من Web Store كيتجددو بوحدهم فكل بروفايل. اللي جاو من dossier (Load unpacked) كيبقاو كيتقراو من نفس الـ dossier، فما تمسحوش.
- البروفايلات اللي كانو قبل كيبقاو بالإضافات ديالهم.
- **علاش النسخ**: Chrome ما كيخلي حتى برنامج يزيد إضافة لبروفايل بوحدو، وكيوقّع (signature) السجل ديال الإضافات ديال كل بروفايل. البرنامج كينسخ هاد السجل كيفما كتبو Chrome، فـ Chrome كيقبلو. ما كيتنسخوش الـ cookies، السجل (history)، كلمات السر، ولا البيانات ديال المواقع؛ والأرقام ديال البروفايل اللي ماشي موقّعين كيتحيدو، وChrome كيصاوب جداد.
- **الحد**: البروفايلات اللي تصاوبو من النموذج كيتشاركو شي قيم مخبية ديال Chrome (بحال المفتاح اللي كيشفّر بيه البيانات ديال البروفايل)، والإضافة اللي كتعطي لراسها رقم كتبقى بنفس الرقم فكل بروفايل. المواقع ما كتشوفش هاد القيم.

## التثبيت

من [Releases](https://github.com/kamaltv1010-boop/chromes/releases): `NoorChrome-Setup-<version>-windows-x64.exe` (installer) أو `NoorChrome-<version>-windows-x64-portable.exe`. خاص Google Chrome يكون منصّب؛ إلا ماكانش فالبلاصة العادية، اختارو من الإعدادات.

## Noor for Edge (extension) 🧩

إضافة لـ **Microsoft Edge** (وكتخدم حتى فـ Google Chrome) فيها نفس الحماية ديال Noor: **Canvas**، **WebGL**، **الصوت** و**ClientRects**. ما خاصهاش البرنامج: كتزيدها لـ Edge ديالك وصافي.

- **قبل أي سطر ديال الموقع**: فكل صفحة، فكل frame، وفكل نافذة كيحلها الموقع، الإضافة كتزيد ضجيج صغير فالقيم اللي كيقراو المواقع باش يعرفوك (نفس الكود ديال Noor، `scripts/protect.js`).
- **قيم ثابتة لكل موقع**: كل موقع كيشوف قيم ديالو، نفسهم فكل زيارة، وموقع آخر كيشوف قيم أخرى، فما يقدروش يتبعوك من موقع لموقع. **جديد** حدا كل حماية كيعطي قيم جديدة، و**تغيير الكل** كيبدّل كلشي.
- **الصوت وClientRects طافيين فالبداية** (بحال Noor لـ Windows): فالـ PC هاد القيم تقريباً نفسها عند الجميع، فالضجيج فيهم كيبيّن المتصفح بدل ما يخبيه. تقدر تشعلهم من النافذة ديال الإضافة.
- **موقع بوحدو**: إلا شي موقع ما خدمش مزيان، طفي الحماية فيه بوحدو من النافذة ديال الإضافة.
- **ما كتبانش**: الـ functions اللي كتبدّل كيبانو بحال ديال المتصفح، والصفحة ما كتلقى حتى أثر ديال الإضافة، حتى فالمواقع اللي عندها CSP قوي. كل Release عندو علامة (mark) ديالو، ماشي اللي كتبان هنا فالكود.
- **كيفاش**: المتصفح كيشغّل ملفات الإضافة فالصفحة قبل الـ scripts ديالها (content script فالعالم ديال الصفحة). الإعدادات (القيم ديال كل حماية) كتوصل للصفحة بالملفات اللي كيتشغلو (`extension/bits/<n>.js`، واحد لكل bit)، حيت ملف ديال إضافة ما يقدرش يتبدل، وحتى موقع ما يقدر يعرف شمن ملف تشغّل.

### التثبيت فـ Edge

1. حمّل `Noor-Edge-<version>.zip` من [Releases](https://github.com/kamaltv1010-boop/chromes/releases) وفكّو (Extract all) فـ dossier غادي يبقى (ما تمسحوش من بعد).
2. حل `edge://extensions` وشعل **Developer mode**.
3. ضغط **Load unpacked** واختار الـ dossier اللي فكّيتي.
4. باش يبان الزر ديالها: ضغط على 🧩 فالشريط، ومن بعد على 👁 حدا Noor.

الصفحات اللي كانو محلولين خاصهم يتعاودو يتحلو (F5). فـ Chrome: نفس الشي من `chrome://extensions`. فـ InPrivate: شعل «Allow in InPrivate» فالإعدادات ديال الإضافة إلا بغيتيها تخدم تماك.

**الحدود**: الـ workers (كود كتشغلو الصفحة فالخلفية) ما كتوصلهومش الحماية، حيت الإضافات ما كتقدرش تدخل ليهم؛ Noor for Chrome (البرنامج) كيحميهم.

## التطوير

```
npm install
npm start            # يفتح البرنامج
npm test             # الاختبارات
NOOR_CHROME=/path/to/chrome xvfb-run -a node tools/smoke-chrome.js   # اختبار كامل مع Chromium
npm run dist         # يبني .exe
NOOR_CHROME=/path/to/chrome xvfb-run -a node tools/smoke-template.js /path/to/template   # اختبار كامل ديال الإضافات لكل بروفايل جديد
node tools/build-extension.js --pack 1.0.0   # يبني dist/Noor-Edge-1.0.0.zip
xvfb-run -a node tools/smoke-extension.js    # اختبار كامل ديال الإضافة فـ Chromium (Playwright)
```

ملي يتبدل `scripts/protect.js`، عاود ولّد الملفات ديال الإضافة (`extension/realm.js` و`extension/bits/`) بـ `node tools/build-extension.js`.

`scripts/protect.js` ما كيتبدلش بالإيد: كيتولّد من `AmirBrowser/FingerprintProtection.swift` ديال تطبيق iPhone بالأداة `tools/extract_from_ios.py` ديال مشروع noor-windows.
