// Contract example only; these endpoints are synthetic and require adaptation.
Hazuki.registerSource({
  id: "comment_captcha_example",
  name: "Comment captcha example",
  version: "1.0.0",
  search: { load: async () => ({ comics: [] }) },
  account: {
    loginMethods: [
      { id: "comments", title: "网页登录（评论）", input: "credentials" },
    ],
    login: async (_account, _password, context) => {
      if (!context || context.method !== "comments")
        throw Hazuki.error("INTERACTION_REQUIRED", "Open comment login");
      const result = await context.requestBrowserAuthorization({
        url: "https://example.com/login",
        completion: "manual",
        cookieScopes: [{ url: "https://example.com/", names: ["session"] }],
      });
      if (result.status !== "completed")
        throw Hazuki.error("AUTH_TIMEOUT", "Try again");
      // Cookie + actual WebView UA already apply to this verification request.
      const response = await Hazuki.http.get("https://example.com/account");
      const profile = JSON.parse(response.body);
      if (response.status !== 200 || !profile.id)
        throw Hazuki.error("AUTH_FAILED", "Account verification failed");
      return { displayName: String(profile.name ?? "User") };
    },
  },
  comic: {
    loadInfo: async (id) => ({ id, title: "Example", chapters: {} }),
    loadEp: async () => ({ images: [] }),
    sendComment: async (comicId, _subId, text) => {
      if (!(await Hazuki.ui.isAvailable()))
        throw Hazuki.error("UI_UNAVAILABLE", "Open the comments page");
      const captcha = await Hazuki.http.fetchBytes(
        "GET",
        "https://example.com/captcha",
      );
      if (captcha.status !== 200)
        throw Hazuki.error("CAPTCHA_FAILED", "Could not load captcha");
      const dialog = await Hazuki.ui.openDialog({
        title: "评论验证码",
        content: [
          { id: "captcha", type: "image", image: new Uint8Array(captcha.body) },
          { id: "code", type: "input", label: "验证码", required: true },
        ],
        buttons: [
          { id: "send", text: "发送", role: "primary", validate: true },
        ],
      });
      try {
        const event = await dialog.nextEvent();
        if (event.type === "closed")
          throw new Hazuki.ui.PluginDialogCancelledError(event.reason);
        const body = `video_id=${encodeURIComponent(comicId)}&comment=${encodeURIComponent(text)}&originator=&status=false&invite_verification=${encodeURIComponent(String(event.values.code))}`;
        const response = await Hazuki.http.sendRequest(
          "POST",
          "https://example.com/comment",
          {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "https://example.com/",
            Origin: "https://example.com",
            "X-Requested-With": "XMLHttpRequest",
          },
          body,
        );
        // Adapt to the site's actual success/captcha-expiry contract. Do not
        // retry an uncertain submission automatically, as it may already exist.
        if (
          response.status !== 200 ||
          JSON.parse(response.body).success !== true
        )
          throw Hazuki.error("COMMENT_FAILED", "Comment was not confirmed");
      } finally {
        await dialog.close();
      }
    },
  },
});
