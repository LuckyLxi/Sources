const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function example() {
  let source;
  const requests = [];
  const secrets = new Map();
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../docs/examples/browser-authorization.js"),
      "utf8",
    ),
    {
      Hazuki: {
        registerSource: (value) => {
          source = value;
        },
        error: (code) => new Error(code),
        secrets: { set: async (key, value) => secrets.set(key, value) },
        http: {
          get: async () => ({
            body: JSON.stringify({
              url: "https://provider.example/auth",
              state: "mock-state",
            }),
          }),
          post: async (url, _headers, body) => {
            requests.push({ url, body });
            return {
              body: JSON.stringify({ token: "mock-session", name: "User" }),
            };
          },
        },
      },
    },
  );
  return { source, requests, secrets };
}

test("browser example verifies callback before saving a passwordless session", async () => {
  const { source, requests, secrets } = example();
  const profile = await source.account.login("", "", {
    requestBrowserAuthorization: async (options) => {
      assert.equal(options.callbacks[0].path, "/auth/callback");
      return {
        status: "completed",
        url: "https://example.com/auth/callback?code=mock&state=mock-state",
      };
    },
  });
  assert.equal(profile.displayName, "User");
  assert.equal(requests[0].body.expectedState, "mock-state");
  assert.equal(secrets.get("session"), "mock-session");
});

test("browser example does not verify or persist after timeout or cancellation", async () => {
  for (const cancel of [false, true]) {
    const { source, requests, secrets } = example();
    await assert.rejects(
      source.account.login("", "", {
        requestBrowserAuthorization: async () => {
          if (cancel) throw Error("cancelled");
          return { status: "timeout" };
        },
      }),
    );
    assert.equal(requests.length, 0);
    assert.equal(secrets.size, 0);
  }
});
