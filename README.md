# Noor for Chrome

برنامج لـ Windows كيفتح **Google Chrome نفسو** ببروفايلات، كل بروفايل عندو **البصمات ديالو** (Canvas، WebGL، حجم الشاشة، البروسيسور والذاكرة، المنطقة الزمنية ديال الـ IP)، **البيانات ديالو** (cookies، حسابات، extensions، historique)، و**proxy ديالو** إلا بغيتي. نفس الحماية ديال [متصفح Noor](https://github.com/kamaltv1010-boop/noor-windows) ولكن داخل Chrome الحقيقي، فالمواقع كتشوف Chrome عادي بكلشي فيه.

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

## التثبيت

من [Releases](https://github.com/kamaltv1010-boop/chromes/releases): `NoorChrome-Setup-<version>-windows-x64.exe` (installer) أو `NoorChrome-<version>-windows-x64-portable.exe`. خاص Google Chrome يكون منصّب؛ إلا ماكانش فالبلاصة العادية، اختارو من الإعدادات.

## التطوير

```
npm install
npm start            # يفتح البرنامج
npm test             # الاختبارات
NOOR_CHROME=/path/to/chrome xvfb-run -a node tools/smoke-chrome.js   # اختبار كامل مع Chromium
npm run dist         # يبني .exe
```

`scripts/protect.js` ما كيتبدلش بالإيد: كيتولّد من `AmirBrowser/FingerprintProtection.swift` ديال تطبيق iPhone بالأداة `tools/extract_from_ios.py` ديال مشروع noor-windows.
