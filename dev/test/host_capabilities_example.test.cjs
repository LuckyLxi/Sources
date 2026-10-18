const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function example() {
  let source;
  const requests = [];
  const http = async (url, _headers, body) => {
    requests.push({ url, body });
    let data = {};
    if (url.endsWith("/captcha"))
      data = { id: "captcha", imageDataUrl: "data:image/png;base64,AA==" };
    if (url.endsWith("/captcha/check")) data = { ok: true };
    if (url.endsWith("/login"))
      data = { token: "mock-token", name: "Example user" };
    return { status: 200, body: JSON.stringify(data) };
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../docs/examples/host-capabilities.js"),
      "utf8",
    ),
    {
      Hazuki: {
        registerSource: (value) => {
          source = value;
        },
        http: { get: http, post: http },
        error: (code, message) => new Error(`${code}: ${message}`),
      },
    },
  );
  return { source, requests };
}

test("example demonstrates refresh, ordered points and SMS without a password", async () => {
  const { source, requests } = example();
  let clicks = 0;
  const profile = await source.account.login("phone", "", {
    method: "sms",
    requestClickCaptcha: async () =>
      clicks++ === 0
        ? { status: "refresh" }
        : {
            status: "submitted",
            points: [
              { x: 9, y: 1 },
              { x: 2, y: 4 },
              { x: 7, y: 3 },
            ],
          },
    requestText: async () => "123456",
  });
  assert.equal(profile.token, "mock-token");
  assert.equal(clicks, 2);
  assert.equal(requests.filter((r) => r.url.endsWith("/captcha")).length, 2);
  assert.deepEqual(
    requests.find((r) => r.url.endsWith("/captcha/check")).body.points,
    [
      { x: 9, y: 1 },
      { x: 2, y: 4 },
      { x: 7, y: 3 },
    ],
  );
  assert.equal(
    requests.find((r) => r.url.endsWith("/login")).body.code,
    "123456",
  );
});

test("example preserves numeric chapter IDs in arrays and submits host page numbers", async () => {
  const { source, requests } = example();
  const details = await source.comic.loadInfo("comic");
  assert.deepEqual(
    Array.from(details.chapterGroups[0].chapters, (c) => c.id),
    ["10", "2"],
  );
  await source.comic.onReadingProgress({
    comicId: "comic",
    chapterId: "10",
    page: 3,
    totalPages: 9,
    visiblePages: [3, 4],
    reason: "page",
  });
  assert.equal(requests[0].body.page, 3);
});

test("cancelled interaction prevents the example from making a login request", async () => {
  const { source, requests } = example();
  await assert.rejects(
    source.account.login("phone", "", {
      method: "sms",
      requestClickCaptcha: async () => {
        throw new Error("cancelled");
      },
    }),
    /cancelled/,
  );
  assert.equal(
    requests.some((r) => r.url.endsWith("/login")),
    false,
  );
});
