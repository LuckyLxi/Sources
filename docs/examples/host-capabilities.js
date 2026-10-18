// Illustrative contract only: replace example.com and all website response fields.
// Do not install against a real account until the plugin's login flow is verified.
Hazuki.registerSource({
  id: "host_capabilities_example",
  name: "Host capabilities example",
  version: "1.0.0",
  search: { load: async () => ({ comics: [], maxPage: 1 }) },
  account: {
    loginMethods: [
      {
        id: "password",
        title: { zh: "密码登录", en: "Password" },
        input: "credentials",
      },
      { id: "sms", title: { zh: "短信登录", en: "SMS" }, input: "account" },
    ],
    login: async (account, password, context) => {
      if (!context)
        throw Hazuki.error("INTERACTION_REQUIRED", "Open login again");
      for (;;) {
        const captcha = JSON.parse(
          (await Hazuki.http.get("https://example.com/captcha")).body,
        );
        const answer = await context.requestClickCaptcha({
          title: { zh: "按提示顺序点击", en: "Click in the indicated order" },
          image: captcha.imageDataUrl,
          hintImage: captcha.hintDataUrl,
          pointCount: 3,
        });
        if (answer.status === "refresh") continue;
        const check = JSON.parse(
          (
            await Hazuki.http.post(
              "https://example.com/captcha/check",
              {},
              {
                id: captcha.id,
                points: answer.points,
              },
            )
          ).body,
        );
        if (!check.ok) continue;
        let code = "";
        if (context.method === "sms") {
          await Hazuki.http.post(
            "https://example.com/sms/send",
            {},
            { phone: account, captchaId: captcha.id },
          );
          code = await context.requestText({
            title: { zh: "输入短信码", en: "SMS code" },
            keyboardType: "number",
          });
        }
        const result = JSON.parse(
          (
            await Hazuki.http.post(
              "https://example.com/login",
              {},
              {
                method: context.method,
                account,
                password,
                code,
                captchaId: captcha.id,
              },
            )
          ).body,
        );
        if (!result.token) throw new Error("Login failed");
        return {
          token: String(result.token),
          displayName: String(result.name ?? account),
        };
      }
    },
  },
  comic: {
    loadInfo: async (id) => ({
      id,
      title: "Example",
      chapterGroups: [
        {
          id: "serial",
          title: "Serial",
          chapters: [
            { id: "10", title: "First" },
            { id: "2", title: "Second" },
          ],
        },
        {
          id: "alternative",
          title: "Alternative",
          chapters: [{ id: "1", title: "Alternative version" }],
        },
      ],
    }),
    loadEp: async () => ({ images: [] }),
    onReadingProgress: async (progress) => {
      // The host reports one-based original image pages, never preload events.
      await Hazuki.http.post(
        "https://example.com/reading-record",
        {},
        {
          comicId: progress.comicId,
          chapterId: progress.chapterId,
          page: progress.page,
        },
      );
    },
  },
});
