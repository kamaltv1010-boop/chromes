// Languages: pages see the languages Chrome lists for the system's
// (navigator.languages: the locale, its language, then English), as the
// request headers say; Chromium alone lists the one locale. The list is
// one frozen array per navigator, given back as is, as the browser does.
{
  const navigatorProto = (window.Navigator || window.WorkerNavigator).prototype;
  const languages = config.languages;
  if (languages && languages.length) {
    const freeze = Object.freeze;
    const lists = new WeakMap();
    defineGetter(navigatorProto, "languages", function () {
      let list = lists.get(this);
      if (!list) {
        list = freeze(languages.slice());
        lists.set(this, list);
      }
      return list;
    });
    defineGetter(navigatorProto, "language", () => languages[0]);
  }
}
