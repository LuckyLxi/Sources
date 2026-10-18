// Contract example only. Replace endpoints and verify the website's real flow.
Hazuki.registerSource({
  id: "browser_authorization_example",
  name: "Browser authorization example",
  version: "1.0.0",
  search: { load: async () => ({ comics: [] }) },
  comic: {
    loadInfo: async (id) => ({ id, title: "Example", chapters: {} }),
    loadEp: async () => ({ images: [] }),
  },
  account: {
    loginMethods: [
      { id: "browser", title: "Browser authorization", input: "none" },
    ],
    login: async (_account, _password, context) => {
      if (!context)
        throw Hazuki.error("INTERACTION_REQUIRED", "Open login again");
      const start = JSON.parse(
        (await Hazuki.http.get("https://example.com/auth/start")).body,
      );
      const result = await context.requestBrowserAuthorization({
        url: start.url,
        callbacks: [
          {
            origin: "https://example.com",
            path: "/auth/callback",
            requiredQueryKeys: ["code", "state"],
          },
        ],
      });
      if (result.status === "timeout")
        throw Hazuki.error("AUTH_TIMEOUT", "Try again");
      // Only the trusted backend checks state, exchanges code and verifies the
      // account. Never log the full callback or import the browser's Cookie jar.
      const profile = JSON.parse(
        (
          await Hazuki.http.post(
            "https://example.com/auth/finish",
            {},
            {
              callback: result.url,
              expectedState: start.state,
            },
          )
        ).body,
      );
      if (!profile.token)
        throw Hazuki.error("AUTH_FAILED", "Account verification failed");
      await Hazuki.secrets.set("session", profile.token);
      return { displayName: String(profile.name ?? "User") };
    },
  },
});
