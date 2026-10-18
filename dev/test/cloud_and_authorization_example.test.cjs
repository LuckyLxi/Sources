const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function example() {
  let source;
  const saved = new Map();
  const requests = [];
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../docs/examples/cloud-and-authorization.js"),
      "utf8",
    ),
    {
      Hazuki: {
        registerSource: (value) => {
          source = value;
        },
        error: (code) => Error(code),
        secrets: {
          get: async (key) => saved.get(key) ?? null,
          set: async (key, value) => saved.set(key, value),
        },
        http: {
          get: async (url) => ({
            body: JSON.stringify(
              url.endsWith("account")
                ? { id: "mock", name: "Cookie user" }
                : { chapterId: "100", page: 7 },
            ),
          }),
          post: async (url, _headers, body) => {
            requests.push({ url, body });
            return {
              body: JSON.stringify(
                url.endsWith("external")
                  ? { state: "expected", url: "mock-provider://login" }
                  : { id: "mock", token: "synthetic" },
              ),
            };
          },
        },
      },
    },
  );
  return { source, saved, requests };
}

test("cookie example declares exact scopes and verifies with its own HTTP client", async () => {
  const { source, saved } = example();
  const profile = await source.account.login("", "", {
    method: "cookies",
    requestBrowserAuthorization: async (options) => {
      assert.equal(options.completion, "manual");
      assert.equal(options.cookieScopes[0].names[0], "session");
      return { status: "completed", url: options.url };
    },
  });
  assert.equal(profile.displayName, "Cookie user");
  assert.equal(saved.size, 0);
});
test("external example prepares the website URL from the host callback then verifies state", async () => {
  const { source, requests, saved } = example();
  await source.account.login("", "", {
    method: "external",
    requestExternalAuthorization: async (options) => {
      assert.equal(
        await options.createUrl("hazuki-auth://authorize/mock"),
        "mock-provider://login",
      );
      return {
        status: "completed",
        url: "hazuki-auth://authorize/mock?code=synthetic",
      };
    },
  });
  assert.equal(requests[0].body.callbackUrl, "hazuki-auth://authorize/mock");
  assert.equal(requests[1].body.expectedState, "expected");
  assert.equal(saved.get("session"), "synthetic");
  assert.equal((await source.comic.loadReadingProgress("c")).page, 7);
});
test("timeout never validates or saves a partial account", async () => {
  const { source, saved, requests } = example();
  await assert.rejects(
    source.account.login("", "", {
      method: "external",
      requestExternalAuthorization: async () => ({ status: "timeout" }),
    }),
  );
  assert.equal(saved.size, 0);
  assert.equal(requests.length, 0);
});
