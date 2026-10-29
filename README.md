# Noor for Chrome

برنامج لـ Windows كيفتح **Google Chrome نفسو** ببروفايلات، كل بروفايل عندو **البصمات ديالو** (Canvas، WebGL، حجم الشاشة، البروسيسور والذاكرة، المنطقة الزمنية ديال الـ IP)، **البيانات ديالو** (cookies، حسابات، extensions، historique)، و**proxy ديالو** إلا بغيتي. نفس الحماية ديال [متصفح Noor](https://github.com/kamaltv1010-boop/noor-windows) ولكن داخل Chrome الحقيقي، فالمواقع كتشوف Chrome عادي بكلشي فيه.

## كيفاش كيخدم

- **بروفايلات**: كل بروفايل عندو folder ديالو (`--user-data-dir`) فChrome كيحتافظ فيه بكلشي ديالو، منفصل على البروفايلات الأخرى وعلى Chrome ديالك العادي.
- **الحماية**: فاش كتضغط *Open Chrome*، البرنامج كيفتح Chrome وكيتواصل معاه بالـ debugging pipe ديالو (ماشي port، ما كاين والو على الشبكة). كل صفحة، كل iframe، وكل worker (dedicated، service، shared) كيتوقف قبل أول سطر ديالو، كياخد الحماية (نفس `scripts/protect.js` ديال Noor، المولّد من تطبيق iPhone)، والمنطقة الزمنية، والمتتبعين المحجوبين، وعاد كيتخلى يكمل.
- **المنطقة الزمنية**: كتتجاب أوتوماتيكياً من الـ IP ديال الاتصال (VPN أو proxy) وكتتطبق على الصفحات، باش الموقع يلقاها كتوافق مع الـ IP.
- **المتتبعين**: Meta، Google Analytics، TikTok وغيرهم ما كيتحمّلوش على المواقع الأخرى (نفس القواعد ديال Noor، `rules/trackers.json`).
- **Proxy لكل بروفايل**: `socks5://host:port` أو `http://host:port`.
- **navigator.webdriver**: Chrome كيحط `true` فاش يكون debugging pipe محلول؛ البرنامج كيطفي هاد العلامة (`--disable-blink-features=AutomationControlled`) باش الصفحة ما تقراهاش.

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
