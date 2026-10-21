// Generic contract example. These endpoints and provider scheme are fixtures,
// not a claim of compatibility with any real website or provider SDK.
/** @returns {Promise<Record<string, string>>} */
async function readingHeaders() {
  const token = await Hazuki.secrets.get("session");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
Hazuki.registerSource({
  id: "cloud_and_authorization_example",
  name: "Cloud reading and authorization example",
  version: "1.0.0",
  search: { load: async () => ({ comics: [] }) },
  comic: {
    loadInfo: async (id) => ({ id, title: "Example", chapters: {} }),
    loadEp: async () => ({ images: [] }),
    loadReadingProgress: async (comicId) =>
      JSON.parse(
        (
          await Hazuki.http.get(
            `https://example.com/reading/${encodeURIComponent(comicId)}`,
            await readingHeaders(),
          )
        ).body,
      ),
    loadReadingHistory: async (page) =>
      JSON.parse(
        (
          await Hazuki.http.get(
            `https://example.com/reading/history?page=${page}`,
            await readingHeaders(),
          )
        ).body,
      ),
    onReadingProgress: async (progress) => {
      await Hazuki.http.post(
        "https://example.com/reading",
        await readingHeaders(),
        progress,
      );
    },
  },
  account: {
    loginMethods: [
      { id: "cookies", title: "Browser sign in", input: "none" },
      { id: "external", title: "External app", input: "none" },
    ],
    login: async (_account, _password, context) => {
      if (!context) throw Hazuki.error("INTERACTION_REQUIRED", "Open login");
      if (context.method === "cookies") {
        const result = await context.requestBrowserAuthorization({
          url: "https://example.com/login",
          completion: "manual",
          cookieScopes: [
            { url: "https://example.com/account", names: ["session"] },
          ],
        });
        if (result.status === "timeout")
          throw Hazuki.error("AUTH_TIMEOUT", "Retry");
        // The host stages the scoped Cookie (including HttpOnly) AND actual WebView UA.
        // Hazuki.http applies both now, overriding a stale explicit UA for this origin.
        // Only a verified account permits committing both; errors/cancel roll back.
        const profile = JSON.parse(
          (await Hazuki.http.get("https://example.com/account")).body,
        );
        if (!profile.id)
          throw Hazuki.error("AUTH_FAILED", "Account verification failed");
        return { displayName: String(profile.name ?? "User") };
      }
      let expectedState = "";
      const result = await context.requestExternalAuthorization({
        allowedSchemes: ["mock-provider"],
        createUrl: async (callbackUrl) => {
          const start = JSON.parse(
            (
              await Hazuki.http.post(
                "https://example.com/auth/external",
                {},
                { callbackUrl },
              )
            ).body,
          );
          expectedState = String(start.state);
          return String(start.url);
        },
      });
      if (result.status === "timeout")
        throw Hazuki.error("AUTH_TIMEOUT", "Retry");
      // A trusted backend validates provider state, exchanges the credential and
      // verifies the account. Never log or persist the full callback URL.
      const verified = JSON.parse(
        (
          await Hazuki.http.post(
            "https://example.com/auth/finish",
            {},
            { callback: result.url, expectedState },
          )
        ).body,
      );
      if (!verified.id)
        throw Hazuki.error("AUTH_FAILED", "Account verification failed");
      if (verified.token)
        await Hazuki.secrets.set("session", String(verified.token));
      return { displayName: String(verified.name ?? "User") };
    },
  },
});
