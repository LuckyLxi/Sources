const assert = require("node:assert/strict");
const test = require("node:test");
const { purgeUrls, purgeCache } = require("../scripts/purge-plugin-cache.cjs");

const url = "https://purge.jsdelivr.net/gh/owner/repo@main/example.js";
const finished = {
  status: "finished",
  paths: {
    "/gh/owner/repo@main/example.js": {
      throttled: false,
      providers: { cloudflare: true, fastly: true },
    },
  },
};
const options = { sleep: async () => {}, log: () => {} };
const response = (body) => ({ ok: true, json: async () => body });

test("purges indexed download URLs once and the repository index last", () => {
  const downloadUrl =
    "https://cdn.jsdelivr.net/gh/owner/repo@main/%E4%B8%AD.js";
  assert.deepEqual(
    purgeUrls({ plugins: [{ downloadUrl }, { downloadUrl }] }, "owner/repo"),
    [
      "https://purge.jsdelivr.net/gh/owner/repo@main/%E4%B8%AD.js",
      "https://purge.jsdelivr.net/gh/owner/repo@main/plugins.json",
    ],
  );
  assert.throws(() => purgeUrls({ plugins: [] }, "invalid"), /repository/);
  assert.throws(
    () =>
      purgeUrls(
        { plugins: [{ downloadUrl: "https://example.com/a.js" }] },
        "owner/repo",
      ),
    /Unexpected plugin download URL/,
  );
});

test("polls a submitted purge job until it finishes", async () => {
  const requests = [];
  await purgeCache([url], {
    ...options,
    fetch: async (target, init) => {
      requests.push(target);
      assert.ok(init.signal instanceof AbortSignal);
      return response(
        requests.length === 1
          ? { id: "job" }
          : requests.length === 2
            ? { id: "job", status: "pending" }
            : finished,
      );
    },
  });
  assert.deepEqual(requests, [
    url,
    "https://purge.jsdelivr.net/status/job",
    "https://purge.jsdelivr.net/status/job",
  ]);
});

test("retries HTTP, network, malformed JSON and provider failures", async (t) => {
  for (const failure of [
    async () => ({ ok: false, status: 429 }),
    async () => {
      throw new Error("network unavailable");
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    }),
    async () =>
      response({
        ...finished,
        paths: { [new URL(url).pathname]: { providers: { fastly: false } } },
      }),
  ]) {
    await t.test(failure.toString(), async () => {
      let calls = 0;
      await purgeCache([url], {
        ...options,
        fetch: async () => (++calls === 1 ? failure() : response(finished)),
      });
      assert.equal(calls, 2);
    });
  }
});

test("reports unconfirmed purges after retries and still attempts other URLs", async () => {
  for (const result of [
    { success: true },
    { status: "finished", paths: {} },
    {
      ...finished,
      paths: {
        [new URL(url).pathname]: {
          throttled: true,
          providers: { fastly: true },
        },
      },
    },
    { id: "job", status: "pending" },
  ]) {
    const requests = [];
    await assert.rejects(
      purgeCache([url, `${url}?second`], {
        ...options,
        fetch: async (target) => {
          requests.push(target);
          return response(target.endsWith("?second") ? finished : result);
        },
      }),
      /CDN purge failed/,
    );
    assert.equal(requests.filter((target) => target === url).length, 3);
    assert.equal(requests.at(-1), `${url}?second`);
  }
});
