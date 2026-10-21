const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function plugin(id, respond = () => ({ status: 200, data: {} }), initial = {}) {
  const storage = new Map(Object.entries(initial));
  const settings = new Map();
  const requests = [];
  const delays = [];
  const logs = [];
  const writes = [];
  let source;
  const http = async (method, url, headers = {}, body) => {
    const request = { method, url, headers, body };
    requests.push(request);
    const result = await respond(request, requests);
    return {
      status: result.status ?? 200,
      headers: result.headers ?? {},
      body: result.body ?? JSON.stringify(result.data),
    };
  };
  const api = {
    apiVersion: 1,
    registerSource(value) {
      assert.equal(source, undefined, "register exactly once");
      source = value;
    },
    storage: {
      get: (key) => storage.get(key),
      set: async (key, value) => {
        writes.push([key, value]);
        storage.set(key, value);
      },
      delete: async (key) => {
        storage.delete(key);
      },
    },
    settings: {
      get: (key) => settings.get(key) ?? source.settings?.[key]?.default,
    },
    http: {
      get: (url, headers) => http("GET", url, headers),
      post: (url, headers, body) => http("POST", url, headers, body),
      sendRequest: http,
    },
    convert: {
      md5: (value) => crypto.createHash("md5").update(value).digest(),
      hexEncode: (value) => Buffer.from(value).toString("hex"),
      encodeUtf8: (value) => Buffer.from(value, "utf8"),
      decodeUtf8: (value) => Buffer.from(value).toString("utf8"),
      encodeBase64: (value) => Buffer.from(value).toString("base64"),
      decodeBase64: (value) => Buffer.from(value, "base64"),
      decryptAesEcb: (value, key) => {
        const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
        return Buffer.concat([decipher.update(value), decipher.final()]);
      },
      hmacString: (key, value, algorithm) =>
        crypto.createHmac(algorithm, key).update(value).digest("hex"),
    },
    images: { reverseVerticalTiles: (segments) => ({ segments }) },
    delay: async (ms) => {
      delays.push(ms);
    },
    log: (message, level) => {
      logs.push({ message, level });
    },
    error: (code, message) =>
      new Error("hazuki_" + code.toLowerCase() + ": " + message),
    locale: "zh_CN",
    translate: (text) =>
      typeof text === "string" ? text : text.zh || text.en || "",
  };
  // Deliberately expose only API v1; legacy app globals are unavailable.
  const context = vm.createContext({ Hazuki: api });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "..", `${id}.js`), "utf8"),
    context,
  );
  return { source, storage, settings, requests, delays, logs, writes, context };
}

test("generated index matches plugin metadata and download paths", () => {
  // plugins.json is published by CI. Validate the generated result so adding a
  // source does not require manually updating that workflow-owned artifact.
  const { buildIndex } = require("../scripts/update-plugin-index.cjs");
  const index = buildIndex(path.join(__dirname, "..", ".."));
  assert.equal(index.schemaVersion, 1);
  const filenames = fs
    .readdirSync(path.join(__dirname, "..", ".."))
    .filter((filename) => filename.endsWith(".js"));
  const ids = [];
  assert.equal(index.plugins.length, filenames.length);
  for (const filename of filenames) {
    const { source } = plugin(path.basename(filename, ".js"));
    ids.push(source.id);
    const entry = index.plugins.find((entry) => entry.id === source.id);
    assert.ok(entry, `${filename} is missing from plugins.json`);
    assert.equal(entry.name, source.name);
    assert.equal(entry.version, source.version);
    // The index may be mirrored by either documented HTTPS CDN layout; pin the
    // repository, branch and file name rather than the CDN host.
    const download = new URL(entry.downloadUrl);
    assert.equal(download.protocol, "https:");
    assert.ok(
      [
        `/gh/LuckyLxi/Sources@main/${encodeURIComponent(filename)}`,
        `/LuckyLxi/Sources/main/${encodeURIComponent(filename)}`,
      ].includes(download.pathname),
    );
  }
  assert.deepEqual(index.plugins.map((entry) => entry.id).sort(), ids.sort());
});

const picaUser = {
  name: "Pica User",
  avatar: { fileServer: "https://images.example/", path: "/avatar.jpg" },
  isPunched: false,
};

test("JM declares ID rules and an independent recommendation search order", () => {
  const { source } = plugin("jm");
  assert.equal(source.presentation.directComicId, undefined);
  const rules = source.presentation.directComicIdRules;
  assert.equal(rules.extractDigits, true);
  assert.ok(rules.patterns.length > 0);
  const pattern = new RegExp(rules.patterns[0], "i");
  assert.equal(pattern.exec("12345")[1], "12345");
  assert.equal(pattern.exec("JM12345")[1], "12345");
  assert.equal(pattern.exec("abc123def"), null);
  assert.equal(pattern.exec("1"), null);
  const order = source.presentation.dailyRecommendation.searchOrder;
  assert.equal(order, "mr");
  assert.ok(Object.hasOwn(source.presentation.searchOrders, order));
});

function jmResponse(request, data) {
  const time = request.headers.tokenparam.split(",")[0];
  const key = crypto
    .createHash("md5")
    .update(`${time}185Hcomic3PAPP7R`)
    .digest("hex");
  const cipher = crypto.createCipheriv("aes-256-ecb", Buffer.from(key), null);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  return { data: { data: encrypted.toString("base64") } };
}

test("JM resolves numeric and prefixed IDs through the album API without keyword search", async () => {
  for (const keyword of ["12345", "JM12345", " jm12345 "]) {
    const app = plugin("jm", (request) => {
      const url = new URL(request.url);
      assert.equal(url.pathname, "/album");
      assert.equal(url.searchParams.get("id"), "12345");
      return jmResponse(request, {
        name: "ID result",
        author: ["First", "Second"],
        category: { title: "Category" },
      });
    });
    const result = await app.source.search.load(keyword, [], 1);
    assert.equal(result.maxPage, 1);
    assert.equal(result.comics.length, 1);
    assert.equal(result.comics[0].id, "12345");
    assert.equal(result.comics[0].title, "ID result");
    assert.equal(result.comics[0].subTitle, undefined);
    assert.match(result.comics[0].cover, /\/media\/albums\/12345_3x4\.jpg$/);
    assert.deepEqual(Array.from(result.comics[0].tags), ["Category"]);
    assert.equal(app.requests.length, 1);
    const nextPage = await app.source.search.load(keyword, [], 2);
    assert.equal(nextPage.comics.length, 0);
    assert.equal(nextPage.maxPage, 1);
  }
});

test("JM falls back to keyword search when an ID is unavailable or has no valid album", async () => {
  for (const album of [
    () => ({ status: 404, data: {} }),
    (request) => jmResponse(request, {}),
    (request) => jmResponse(request, { name: " " }),
  ]) {
    const app = plugin("jm", (request) => {
      if (new URL(request.url).pathname === "/album") return album(request);
      assert.equal(
        new URL(request.url).searchParams.get("search_query"),
        "12345",
      );
      return jmResponse(request, {
        content: [{ id: 67890, name: "Keyword fallback" }],
        total: 81,
      });
    });
    for (const page of [1, 2]) {
      const result = await app.source.search.load("12345", [], page);
      assert.equal(result.comics[0].id, "67890");
      assert.equal(result.maxPage, 2);
    }
    assert.equal(app.requests.length, 4);
    assert.equal(app.logs.length, 2);
  }
});

test("JM preserves author searches, recommendation ordering, encoding and pagination", async () => {
  for (const keyword of ["Author Name", "abc123def", "1", "JM", "A&B+C"]) {
    const app = plugin("jm", (request) => {
      const url = new URL(request.url);
      assert.equal(url.pathname, "/search");
      assert.equal(url.searchParams.get("search_query"), keyword);
      return jmResponse(request, {
        content: [{ id: 12345, name: "Author result" }],
        total: 81,
      });
    });
    const order = app.source.presentation.dailyRecommendation.searchOrder;
    const result = await app.source.search.load(` ${keyword} `, [order], 1);
    assert.equal(result.comics[0].id, "12345");
    assert.equal(result.maxPage, 2);
    assert.equal(new URL(app.requests[0].url).searchParams.get("o"), order);
    assert.equal(new URL(app.requests[0].url).searchParams.has("page"), false);
    await app.source.search.load(keyword, ["mv_w"], 2);
    const nextPage = new URL(app.requests[1].url);
    assert.equal(nextPage.searchParams.get("page"), "2");
    assert.equal(nextPage.searchParams.get("o"), "mv_w");
    assert.equal(app.requests.length, 2);
  }
});

test("JM normalizes ID detail input and reports failures after keyword fallback", async () => {
  const app = plugin("jm", (request) => {
    assert.equal(new URL(request.url).searchParams.get("id"), "12345");
    return jmResponse(request, { name: "Details" });
  });
  const details = await app.source.comic.loadInfo(" JM12345 ");
  assert.equal(details.id, "12345");
  assert.equal(details.title, "Details");
  const unavailable = plugin("jm", () => ({ status: 503, data: {} }));
  await assert.rejects(
    unavailable.source.search.load("12345", [], 1),
    /JM HTTP 503/,
  );
  assert.equal(unavailable.requests.length, 2);
  const expired = plugin("jm", () => ({ status: 401, data: {} }));
  await assert.rejects(
    expired.source.search.load("12345", [], 1),
    /hazuki_auth_expired/,
  );
  assert.equal(expired.requests.length, 2);
});

test("JM treats an existing vote as success and rejects unlike before a request", async () => {
  const app = plugin("jm", (request) =>
    jmResponse(request, { code: 200, msg: "已經評價！" }),
  );
  await app.source.comic.likeComic("12345", true);
  assert.equal(app.requests.length, 1);
  await assert.rejects(
    app.source.comic.likeComic("12345", false),
    /不支持取消点赞|support unliking/,
  );
  assert.equal(app.requests.length, 1);
  const failed = plugin("jm", (request) =>
    jmResponse(request, { code: 500, msg: "busy" }),
  );
  await assert.rejects(failed.source.comic.likeComic("12345", true), /busy/);
});

test("JM clears a folder with one request", async () => {
  let cleared = false;
  const app = plugin("jm", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/favorite_folder") {
      const body = new URLSearchParams(String(request.body || ""));
      assert.equal(body.get("type"), "clear");
      assert.equal(body.get("folder_id"), "9");
      cleared = true;
      return jmResponse(request, { status: "ok", msg: "cleared" });
    }
    if (url.pathname === "/favorite") {
      return jmResponse(request, {
        folder_list: cleared ? [] : [{ FID: "9", name: "Test" }],
      });
    }
    return jmResponse(request, {});
  });
  await app.source.favorites.deleteFolder("9");
  assert.equal(app.requests.length, 2);
  assert.equal(cleared, true);
  const failed = plugin("jm", (request) =>
    jmResponse(request, { status: "fail", msg: "clear rejected" }),
  );
  await assert.rejects(
    failed.source.favorites.deleteFolder("9"),
    /clear rejected/,
  );
});

test("JM renames a folder through the edit action", async () => {
  const app = plugin("jm", (request) => {
    assert.equal(new URL(request.url).pathname, "/favorite_folder");
    const body = new URLSearchParams(String(request.body || ""));
    assert.equal(body.get("type"), "edit");
    assert.equal(body.get("folder_id"), "9");
    assert.equal(body.get("folder_name"), "New name");
    return jmResponse(request, { status: "ok", msg: "ok" });
  });
  await app.source.favorites.renameFolder("9", "New name");
  assert.equal(app.requests.length, 1);
  const failed = plugin("jm", (request) =>
    jmResponse(request, { status: "fail", msg: "rename rejected" }),
  );
  await assert.rejects(
    failed.source.favorites.renameFolder("9", "New name"),
    /rename rejected/,
  );
});

function jmFavoritePages(totals = { 0: 45, 9: 21 }) {
  const app = plugin("jm", (request) => {
    const url = new URL(request.url);
    assert.equal(url.pathname, "/favorite");
    const folder = url.searchParams.get("folder_id");
    const total = totals[folder] ?? 0;
    const page = Number(url.searchParams.get("page"));
    assert.ok(page >= 1);
    assert.ok(["mr", "mp"].includes(url.searchParams.get("o")));
    const start = (page - 1) * 20;
    const list = Array.from(
      { length: Math.max(0, Math.min(20, total - start)) },
      (_, index) => ({ id: String(start + index + 1), name: "Favorite" }),
    );
    return jmResponse(request, { list, total: String(total) });
  });
  return {
    ...app,
    totals,
    pages: () =>
      app.requests.map((request) => {
        const query = new URL(request.url).searchParams;
        return [
          query.get("folder_id"),
          query.get("o"),
          Number(query.get("page")),
        ];
      }),
  };
}

test("JM declares forward and reverse submenus for both favorite orders", () => {
  const { presentation, settings } = plugin("jm").source;
  assert.equal(presentation.favoriteDefaultOrder, "mr");
  assert.equal(presentation.favoriteOrderAliases["-datetime_updated"], "mp");
  assert.deepEqual(Array.from(presentation.favoriteOrders), [
    "mr",
    "mr_reverse",
    "mp",
    "mp_reverse",
  ]);
  assert.deepEqual(
    Array.from(settings.favoriteOrder.options, (item) => item.value),
    Array.from(presentation.favoriteOrders),
  );
  for (const [index, order] of ["mr", "mp"].entries()) {
    const group = presentation.favoriteMenu[index];
    assert.ok(group.title.zh);
    assert.ok(group.title.en);
    assert.deepEqual(
      Array.from(group.children, (item) => item.order),
      [order, `${order}_reverse`],
    );
    assert.deepEqual(
      Array.from(group.children, (item) => item.title.zh),
      ["正序", "倒序"],
    );
  }
});

for (const order of ["mr", "mp"]) {
  test(`JM forward ${order} favorites request pages 1, 2, 3 without reversing`, async () => {
    const app = jmFavoritePages();
    app.settings.set("favoriteOrder", order);
    const ids = [];
    for (let page = 1; page <= 3; page++) {
      const result = await app.source.favorites.loadComics(page, null);
      assert.equal(result.maxPage, 3);
      ids.push(...result.comics.map((comic) => comic.id));
    }
    assert.deepEqual(app.pages(), [
      ["0", order, 1],
      ["0", order, 2],
      ["0", order, 3],
    ]);
    assert.deepEqual(
      ids,
      Array.from({ length: 45 }, (_, i) => String(i + 1)),
    );
  });

  test(`JM reverse ${order} favorites count once then read pages 3, 2, 1 and reverse each array`, async () => {
    const app = jmFavoritePages();
    app.settings.set("favoriteOrder", `${order}_reverse`);
    const ids = [];
    for (let page = 1; page <= 3; page++) {
      const result = await app.source.favorites.loadComics(page, "0");
      assert.equal(result.maxPage, 3);
      assert.equal(result.comics.length, page === 1 ? 5 : 20);
      ids.push(...result.comics.map((comic) => comic.id));
    }
    assert.deepEqual(app.pages(), [
      ["0", order, 1],
      ["0", order, 3],
      ["0", order, 2],
      ["0", order, 1],
    ]);
    assert.deepEqual(
      ids,
      Array.from({ length: 45 }, (_, i) => String(45 - i)),
    );
    const count = app.requests.length;
    const exhausted = await app.source.favorites.loadComics(4, "0");
    assert.deepEqual(Array.from(exhausted.comics), []);
    assert.equal(exhausted.maxPage, 3);
    assert.equal(app.requests.length, count);
  });
}

for (const total of [0, 1, 20, 40]) {
  test(`JM reverse favorites handle ${total} items without requesting a nonexistent page`, async () => {
    const app = jmFavoritePages({ 0: total });
    app.settings.set("favoriteOrder", "mr_reverse");
    const ids = [];
    const pages = Math.ceil(total / 20);
    for (let page = 1; page <= Math.max(1, pages); page++) {
      const result = await app.source.favorites.loadComics(page, null);
      assert.equal(result.maxPage, pages);
      ids.push(...result.comics.map((comic) => comic.id));
    }
    assert.deepEqual(
      ids,
      Array.from({ length: total }, (_, i) => String(total - i)),
    );
    assert.equal(app.requests.length, pages <= 1 ? 1 : 3);
  });
}

test("JM favorite pagination resets on direction changes, refresh and folder changes", async () => {
  const app = jmFavoritePages();
  app.settings.set("favoriteOrder", "mr_reverse");
  assert.equal(
    (await app.source.favorites.loadComics(1, "0")).comics[0].id,
    "45",
  );
  app.settings.set("favoriteOrder", "mr");
  assert.equal(
    (await app.source.favorites.loadComics(1, "0")).comics[0].id,
    "1",
  );
  app.totals[0] = 65;
  app.settings.set("favoriteOrder", "mr_reverse");
  let result = await app.source.favorites.loadComics(1, "0");
  assert.equal(result.maxPage, 4);
  assert.equal(result.comics[0].id, "65");
  result = await app.source.favorites.loadComics(1, "9");
  assert.equal(result.maxPage, 2);
  assert.equal(result.comics[0].id, "21");
  result = await app.source.favorites.loadComics(2, "0");
  assert.equal(result.maxPage, 4);
  assert.equal(result.comics[0].id, "60");
  app.totals[0] = 2;
  result = await app.source.favorites.loadComics(1, "0");
  assert.equal(result.maxPage, 1);
  assert.deepEqual(
    Array.from(result.comics, (comic) => comic.id),
    ["2", "1"],
  );
});

test("JM reverse favorites retry a failed data page using the same logical page", async () => {
  let fail = true;
  const app = plugin("jm", (request) => {
    const page = Number(new URL(request.url).searchParams.get("page"));
    if (page === 2 && fail) throw new Error("data page unavailable");
    return jmResponse(request, {
      total: 21,
      list: [{ id: String(page), name: "Favorite" }],
    });
  });
  app.settings.set("favoriteOrder", "mr_reverse");
  await assert.rejects(
    app.source.favorites.loadComics(1, "9"),
    /data page unavailable/,
  );
  fail = false;
  const result = await app.source.favorites.loadComics(1, "9");
  assert.equal(result.maxPage, 2);
  assert.equal(result.comics[0].id, "2");
});

test("JM late reverse counts cannot overwrite a newer refresh snapshot", async () => {
  let releaseOldCount;
  let signalStarted;
  const oldCount = new Promise((resolve) => {
    releaseOldCount = resolve;
  });
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let countRequests = 0;
  const app = plugin("jm", async (request) => {
    const page = Number(new URL(request.url).searchParams.get("page"));
    if (page === 1 && ++countRequests === 1) {
      signalStarted();
      await oldCount;
      return jmResponse(request, { total: 45, list: [] });
    }
    return jmResponse(request, {
      total: 65,
      list: [{ id: String(page), name: "Favorite" }],
    });
  });
  app.settings.set("favoriteOrder", "mr_reverse");
  const oldLoad = app.source.favorites.loadComics(1, "9");
  await started;
  const fresh = await app.source.favorites.loadComics(1, "9");
  assert.equal(fresh.maxPage, 4);
  releaseOldCount();
  await oldLoad;
  const next = await app.source.favorites.loadComics(2, "9");
  assert.equal(next.maxPage, 4);
  assert.equal(new URL(app.requests.at(-1).url).searchParams.get("page"), "3");
});

test("JM reports the real folder that contains a favorited comic", async () => {
  const app = plugin("jm", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/album") {
      return jmResponse(request, { is_favorite: true });
    }
    if (url.pathname === "/favorite") {
      if (url.searchParams.get("folder_id") === "9") {
        return jmResponse(request, {
          list: [{ id: "12345", name: "Comic" }],
          total: 1,
        });
      }
      return jmResponse(request, {
        folder_list: [{ FID: "9", name: "Folder" }],
      });
    }
    return jmResponse(request, {});
  });
  const result = await app.source.favorites.loadFolders("12345");
  assert.equal(result.folders["9"], "Folder");
  assert.deepEqual(Array.from(result.favorited), ["9"]);

  const unfiled = plugin("jm", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/album") {
      return jmResponse(request, { is_favorite: true });
    }
    if (url.pathname === "/favorite") {
      if (url.searchParams.has("folder_id")) {
        return jmResponse(request, { list: [], total: 0 });
      }
      return jmResponse(request, {
        folder_list: [{ FID: "9", name: "Folder" }],
      });
    }
    return jmResponse(request, {});
  });
  assert.deepEqual(
    Array.from((await unfiled.source.favorites.loadFolders("12345")).favorited),
    ["0"],
  );
});

test("JM moves an existing favorite without toggling it off", async () => {
  let favorite = true;
  const app = plugin("jm", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/album") {
      return jmResponse(request, { is_favorite: favorite });
    }
    if (url.pathname === "/favorite") {
      favorite = !favorite;
      return jmResponse(request, { code: 200 });
    }
    if (url.pathname === "/favorite_folder") {
      return jmResponse(request, { status: "ok", msg: "moved" });
    }
    return jmResponse(request, {});
  });
  const paths = () =>
    app.requests.map((request) => new URL(request.url).pathname);

  app.requests.length = 0;
  await app.source.favorites.addOrDelFavorite("12345", "9", true);
  assert.equal(favorite, true);
  assert.deepEqual(paths(), ["/album", "/favorite_folder"]);
  const move = new URLSearchParams(app.requests[1].body);
  assert.equal(move.get("type"), "move");
  assert.equal(move.get("folder_id"), "9");

  app.requests.length = 0;
  await app.source.favorites.addOrDelFavorite("12345", "0", true);
  assert.equal(favorite, true);
  assert.deepEqual(paths(), ["/album", "/favorite", "/favorite"]);

  app.requests.length = 0;
  await app.source.favorites.addOrDelFavorite("12345", "9", false);
  assert.equal(favorite, false);
  assert.deepEqual(paths(), ["/album", "/favorite"]);

  app.requests.length = 0;
  await app.source.favorites.addOrDelFavorite("12345", "9", true);
  assert.equal(favorite, true);
  assert.deepEqual(paths(), ["/album", "/favorite", "/favorite_folder"]);
});

test("JM declares nested comment replies", () => {
  assert.equal(plugin("jm").source.presentation.commentReplies, true);
});

test("JM maps root replies and nested reply threads", async () => {
  const app = plugin("jm", (request) => {
    if (new URL(request.url).pathname === "/forum") {
      return jmResponse(request, {
        total: 1,
        list: [
          {
            CID: "1",
            username: "root",
            content: "root",
            addtime: "t0",
            replys: [
              {
                CID: "2",
                parent_CID: "1",
                username: "a",
                content: "r1",
                addtime: "t1",
              },
              {
                CID: "3",
                parent_CID: "2",
                username: "b",
                content: "r2",
                addtime: "t2",
              },
            ],
          },
        ],
      });
    }
    return jmResponse(request, {});
  });
  const roots = await app.source.comic.loadComments("781", null, 1, null);
  assert.equal(roots.comments.length, 1);
  assert.equal(roots.comments[0].id, "1");
  assert.equal(roots.comments[0].replyCount, 2);
  const replies = await app.source.comic.loadComments("781", null, 1, "1");
  assert.deepEqual(
    Array.from(replies.comments, (comment) => comment.id),
    ["2", "3"],
  );
  assert.equal(replies.comments[0].replyCount, 1);
  assert.equal(replies.comments[1].content, "@a r2");
  const nested = await app.source.comic.loadComments("781", null, 1, "2");
  assert.deepEqual(
    Array.from(nested.comments, (comment) => comment.id),
    ["3"],
  );
});

test("JM posts replies with comment_id", async () => {
  const app = plugin("jm", (request) => {
    assert.equal(new URL(request.url).pathname, "/comment");
    const body = new URLSearchParams(String(request.body || ""));
    assert.equal(body.get("aid"), "123");
    assert.equal(body.get("comment"), "hi");
    assert.equal(body.get("comment_id"), "2");
    assert.equal(body.has("status"), false);
    return jmResponse(request, { status: "ok", msg: "ok" });
  });
  await app.source.comic.sendComment("123", null, "hi", "2");
  assert.equal(app.requests.length, 1);
  const auth = plugin("jm", (request) =>
    jmResponse(request, { type: "auth_fail" }),
  );
  await assert.rejects(
    auth.source.comic.sendComment("123", null, "hi", null),
    /hazuki_auth_expired/,
  );
});

test("JM authorizes web comments on the first send", async () => {
  let webOptions;
  let openCount = 0;
  let closeCount = 0;
  const app = plugin("jm", (request) => {
    const url = new URL(request.url);
    if (url.host === "18comic.vip" && url.pathname === "/") {
      return { status: 200, data: {} };
    }
    assert.equal(url.pathname, "/ajax/album_comment");
    return { status: 200, data: { status: "ok" } };
  });
  app.context.Hazuki.http.fetchBytes = async (method, url) => {
    assert.equal(method, "GET");
    assert.match(url, /\/captcha/);
    return {
      status: 200,
      headers: {},
      body: new Uint8Array([1, 2, 3]).buffer,
    };
  };
  app.context.Hazuki.ui = {
    isAvailable: async () => true,
    openWebView: (options) => {
      openCount += 1;
      webOptions = options;
      const view = Promise.resolve({
        status: "completed",
        url: "https://18comic.vip/",
      });
      view.close = async () => {
        closeCount += 1;
      };
      return view;
    },
    openDialog: async () => ({
      nextEvent: async () => ({
        type: "action",
        id: "submit",
        values: { code: "35" },
      }),
      update: async () => {},
      close: async () => {},
    }),
  };
  await app.source.comic.sendComment("287234", null, "hi", null);
  assert.equal(openCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(app.storage.get("webSession"), true);
  assert.equal(webOptions.completion, "manual");
  assert.deepEqual(
    Array.from(webOptions.cookieScopes[0].names),
    ["AVS", "cf_clearance"],
  );
  assert.equal(new URL(app.requests[0].url).host, "18comic.vip");
  assert.equal(new URL(app.requests[0].url).pathname, "/");
  assert.equal(new URL(app.requests[1].url).pathname, "/ajax/album_comment");

  await app.source.comic.sendComment("287234", null, "again", null);
  assert.equal(openCount, 1);
});

test("JM falls back to app comments when web authorization is declined", async () => {
  const app = plugin("jm", (request) => {
    assert.equal(new URL(request.url).pathname, "/comment");
    return jmResponse(request, { status: "ok" });
  });
  app.context.Hazuki.ui = {
    isAvailable: async () => true,
    openWebView: async () => ({ status: "timeout" }),
  };
  await app.source.comic.sendComment("123", null, "hi", null);
  assert.equal(app.requests.length, 1);
  assert.equal(new URL(app.requests[0].url).pathname, "/comment");
  assert.equal(app.storage.get("webSession"), undefined);
});

test("JM reports whether the web comment session is active", async () => {
  const app = plugin(
    "jm",
    (request) => {
      assert.equal(new URL(request.url).host, "18comic.vip");
      return { status: 200, data: {} };
    },
    { webSession: true },
  );
  assert.match(await app.source.actions.webCommentStatus(), /有效/);
  const off = plugin("jm");
  assert.match(await off.source.actions.webCommentStatus(), /未启用/);
});

test("JM posts web comments with captcha and reply fields", async () => {
  let dialogOptions;
  const app = plugin(
    "jm",
    (request) => {
      assert.equal(
        new URL(request.url).pathname,
        "/ajax/album_comment",
      );
      return { status: 200, data: { status: "ok" } };
    },
    { webSession: true },
  );
  app.context.Hazuki.http.fetchBytes = async (method, url) => {
    assert.equal(method, "GET");
    assert.match(url, /\/captcha/);
    return {
      status: 200,
      headers: {},
      body: new Uint8Array([1, 2, 3]).buffer,
    };
  };
  app.context.Hazuki.ui = {
    isAvailable: async () => true,
    openDialog: async (options) => {
      dialogOptions = options;
      return {
        nextEvent: async () => ({
          type: "action",
          id: "submit",
          values: { code: "35" },
        }),
        update: async () => {},
        close: async () => {},
      };
    },
  };
  await app.source.comic.sendComment("287234", null, "hi", null);
  assert.equal(app.requests.length, 1);
  const body = new URLSearchParams(app.requests[0].body);
  assert.equal(body.get("video_id"), "287234");
  assert.equal(body.get("comment"), "hi");
  assert.equal(body.get("invite_verification"), "35");
  assert.equal(body.get("status"), "false");
  assert.equal(dialogOptions.content[1].type, "input");

  app.requests.length = 0;
  await app.source.comic.sendComment("287234", null, "reply", "2");
  const replyBody = new URLSearchParams(app.requests[0].body);
  assert.equal(replyBody.get("comment_id"), "2");
  assert.equal(replyBody.get("is_reply"), "1");
  assert.equal(replyBody.get("forum_subject"), "1");
  assert.equal(replyBody.has("status"), false);
});

test("Picacg keeps list tags independent of plugin-defined info rows", () => {
  const { source } = plugin("picacg");
  const presentation = source.presentation;
  assert.equal(presentation.showPageCount, undefined);
  for (const key of [
    "showUploader",
    "showCategories",
    "showChineseTeam",
    "detailTagGroups",
  ])
    assert.equal(presentation[key], undefined);
  assert.ok(presentation.listTagGroups.includes("category"));
  assert.equal(presentation.directComicIdRules, undefined);
  assert.equal(presentation.dailyRecommendation, undefined);
});

for (const [id, expression] of [
  ["picacg", 'picacgComic({_id: "comic", title: "Comic", author: "Artist"})'],
  [
    "copy_manga",
    'copyComic({path_word: "comic", name: "Comic", author: [{name: "Artist"}]})',
  ],
]) {
  test(id + " does not put authors in comic subtitles", () => {
    const app = plugin(id);
    const comic = vm.runInContext(expression, app.context);
    assert.equal(comic.id, "comic");
    assert.equal(comic.subTitle, undefined);
    assert.equal(comic.subtitle, undefined);
  });
}

function picaResponse(request) {
  if (request.url.endsWith("/auth/sign-in"))
    return { data: { data: { token: "pica-token" } } };
  if (request.url.endsWith("/users/profile"))
    return { data: { data: { user: picaUser } } };
  return { data: { data: { comics: { docs: [], pages: 1 } } } };
}

for (const id of ["jm", "picacg", "copy_manga"]) {
  test(
    id + " registers API v1 without legacy globals or import-time I/O",
    () => {
      const app = plugin(id);
      assert.equal(app.source.id, id);
      assert.equal(app.source.apiVersion, 1);
      assert.equal(app.requests.length, 0);
      assert.equal(app.writes.length, 0);
      for (const setting of Object.values(app.source.settings)) {
        assert.ok(["input", "select", "switch", "bool"].includes(setting.type));
      }
    },
  );
}

test("Picacg signs the configured API and converts profile media to a complete URL", async () => {
  const app = plugin("picacg", picaResponse);
  app.settings.set("base_url", "https://custom.example///");
  app.settings.set("appChannel", "1");
  app.settings.set("imageQuality", "medium");
  const result = await app.source.account.login("user", "password");
  assert.equal(result.token, "pica-token");
  assert.equal(result.avatarUrl, "https://images.example/static/avatar.jpg");
  assert.equal(result.displayName, "Pica User");
  const login = app.requests[0];
  assert.equal(login.url, "https://custom.example/auth/sign-in");
  assert.equal(login.headers["app-channel"], "1");
  assert.equal(login.headers["image-quality"], "medium");
  assert.equal(login.headers.nonce.length, 32);
  const key =
    "~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn";
  const data = (
    "auth/sign-in" +
    login.headers.time +
    login.headers.nonce +
    "POST" +
    login.headers["api-key"]
  ).toLowerCase();
  assert.equal(
    login.headers.signature,
    crypto.createHmac("sha256", key).update(data).digest("hex"),
  );
  assert.ok(!JSON.stringify(app.logs).includes("pica-token"));
});

test("Picacg tries both profile signature paths before falling back to old client headers", async () => {
  const app = plugin(
    "picacg",
    (request) =>
      request.headers["app-channel"] === "2"
        ? {
            data: {
              user: {
                ...picaUser,
                avatar: { fullUrl: "https://images.example/full.jpg" },
              },
            },
          }
        : { status: 403, data: {} },
    { token: "token" },
  );
  app.settings.set("appChannel", "1");
  const profile = await app.source.account.loadProfile();
  assert.equal(profile.avatarUrl, "https://images.example/full.jpg");
  assert.equal(app.requests.length, 3);
  assert.notEqual(
    app.requests[0].headers.signature,
    app.requests[1].headers.signature,
  );
  assert.equal(app.requests[2].headers["app-build-version"], "44");
});

test("Picacg continues profile lookup when the first signature returns a name but no avatar", async () => {
  const app = plugin(
    "picacg",
    (_, requests) => ({
      data: {
        data: {
          user:
            requests.length === 1
              ? { name: "Name only" }
              : { ...picaUser, avatar: "//images.example/avatar.jpg" },
        },
      },
    }),
    { token: "token" },
  );
  const profile = await app.source.account.loadProfile();
  assert.equal(profile.avatarUrl, "https://images.example/avatar.jpg");
  assert.equal(app.requests.length, 2);
});

test("Picacg uses a UTF-8 JWT name when the profile service fails without failing login", async () => {
  const token =
    "header." +
    Buffer.from(JSON.stringify({ name: "哔咔用户" })).toString("base64url") +
    ".signature";
  const app = plugin("picacg", (request) =>
    request.url.endsWith("/auth/sign-in")
      ? { data: { data: { token } } }
      : { status: 503, data: {} },
  );
  const profile = await app.source.account.login("user", "password");
  assert.equal(profile.token, token);
  assert.equal(profile.displayName, "哔咔用户");
  assert.equal(profile.avatarUrl, undefined);
});

test("Picacg shares a single relogin for concurrent expired requests and returns successful retries", async () => {
  let loginCount = 0;
  const app = plugin(
    "picacg",
    (request) => {
      if (request.url.endsWith("/auth/sign-in")) {
        loginCount++;
        return picaResponse(request);
      }
      if (request.url.includes("/users/profile")) return picaResponse(request);
      if (request.headers.authorization !== "pica-token")
        return { status: 401, data: {} };
      if (request.url.endsWith("/recommendation"))
        return { data: { data: { comics: [] } } };
      if (request.url.includes("/eps?"))
        return {
          data: {
            data: { eps: { docs: [{ order: 1, title: "First" }], pages: 1 } },
          },
        };
      return {
        data: {
          data: {
            comic: { title: "Recovered", pagesCount: 7, author: "Artist" },
          },
        },
      };
    },
    { token: "expired", account: ["user", "password"] },
  );
  const details = await app.source.comic.loadInfo("comic-id");
  assert.equal(details.title, "Recovered");
  assert.equal(details.pageCount, 7);
  assert.equal(details.headerStats[0].action, "like");
  assert.equal(details.headerStats[1].text.en, "7 pages");
  assert.deepEqual(Array.from(details.tags.Author), ["Artist"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(details.infoFields.map((row) => row.label.en))),
    ["Author", "Categories", "Tags", "Uploader", "Chinese team", "Status"],
  );
  assert.deepEqual(Array.from(details.infoFields[0].values), ["Artist"]);
  assert.equal(details.infoFields[0].action, "search");
  assert.equal(details.subTitle, undefined);
  assert.equal(details.chapters.get("1"), "First");
  assert.equal(loginCount, 1);
});

test("Picacg check-in normalizes punch-state variants and avoids duplicate submissions", async () => {
  let submissions = 0;
  const app = plugin(
    "picacg",
    (request) => {
      if (request.url.endsWith("/users/punch-in")) {
        submissions++;
        return { data: { message: "今天已签到" } };
      }
      return {
        data: {
          isPunched: "false",
          name: "User",
          avatar: "https://images.example/avatar.jpg",
        },
      };
    },
    { token: "token" },
  );
  const results = await Promise.all([
    app.source.account.checkIn(),
    app.source.account.checkIn(),
  ]);
  assert.equal(submissions, 1);
  assert.equal(results[0].status, "alreadyCheckedIn");
  assert.equal(results[1].status, "alreadyCheckedIn");
  const punched = plugin(
    "picacg",
    () => ({ data: { data: { user: { ...picaUser, isPunched: 1 } } } }),
    { token: "token" },
  );
  assert.equal(await punched.source.account.checkInStatus(), true);
  assert.equal(
    (await punched.source.account.checkIn()).status,
    "alreadyCheckedIn",
  );
  assert.equal(
    punched.requests.some((request) => request.url.endsWith("/users/punch-in")),
    false,
  );
});

test("Picacg reports ordinary server failures without labelling them expired sessions", async () => {
  const app = plugin(
    "picacg",
    (request) =>
      request.url.endsWith("/users/profile")
        ? picaResponse(request)
        : { status: 503, data: {} },
    { token: "token" },
  );
  await assert.rejects(app.source.account.checkIn(), /Picacg HTTP 503/);
  await assert.rejects(
    app.source.search.load("test", [], 1),
    /Picacg HTTP 503/,
  );
});

test("Picacg paginates episode images and returns complete comment avatar URLs", async () => {
  const app = plugin(
    "picacg",
    (request) => {
      if (request.url.includes("/pages?")) {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return {
          data: {
            data: {
              pages: {
                docs: [
                  {
                    media: {
                      fileServer: "https://images.example",
                      path: page + ".jpg",
                    },
                  },
                ],
                pages: 2,
              },
            },
          },
        };
      }
      return {
        data: {
          data: {
            comments: {
              docs: [
                {
                  _id: "comment",
                  content: "Hello",
                  _user: {
                    name: "Reader",
                    avatar: { fullUrl: "//images.example/user.jpg" },
                  },
                },
              ],
              pages: 1,
            },
          },
        },
      };
    },
    { token: "token" },
  );
  assert.deepEqual(
    Array.from((await app.source.comic.loadEp("id", "1")).images),
    [
      "https://images.example/static/1.jpg",
      "https://images.example/static/2.jpg",
    ],
  );
  assert.equal(
    (await app.source.comic.loadComments("id", null, 1, null)).comments[0]
      .avatar,
    "https://images.example/user.jpg",
  );
});

test("CopyManga form-encodes credentials, awaits device storage and normalizes login fields", async () => {
  const app = plugin("copy_manga", () => ({
    data: {
      results: {
        token: "copy-token",
        nickname: "Copy User",
        user_cover: "/user/cover/avatar.jpg",
      },
    },
  }));
  const result = await app.source.account.login("user+name&x=1", "password");
  assert.equal(
    result.avatarUrl,
    "https://s3.mangafuna.xyz/user/cover/avatar.jpg",
  );
  assert.equal(result.displayName, "Copy User");
  const request = app.requests[0];
  const body = new URLSearchParams(request.body);
  assert.equal(body.get("username"), "user+name&x=1");
  assert.ok(
    Buffer.from(body.get("password").trim(), "base64")
      .toString("utf8")
      .startsWith("password-"),
  );
  assert.ok(request.body.includes("\n&salt="));
  for (const key of ["_device", "_deviceinfo", "_pseudoid"])
    assert.equal(request.headers[key.slice(1)], app.storage.get(key));
});

test("both plugins preserve an existing token when login is rejected or malformed", async () => {
  for (const id of ["picacg", "copy_manga"]) {
    for (const response of [
      { status: 401, data: {} },
      { status: 200, data: { results: {}, data: {} } },
      { status: 200, body: "invalid json" },
    ]) {
      const app = plugin(id, () => response, { token: "previous-token" });
      await assert.rejects(app.source.account.login("user", "password"));
      assert.equal(app.storage.get("token"), "previous-token");
    }
  }
});

test("CopyManga refreshes avatars through a bounded relogin and retains cached data on failure", async () => {
  const app = plugin(
    "copy_manga",
    () => ({
      data: {
        results: { token: "new-token", avatar: "//images.example/avatar.jpg" },
      },
    }),
    { token: "token", account: ["user", "password"] },
  );
  const [first, second] = await Promise.all([
    app.source.account.loadProfile(),
    app.source.account.loadProfile(),
  ]);
  assert.equal(first.avatarUrl, "https://images.example/avatar.jpg");
  assert.equal(second.avatarUrl, first.avatarUrl);
  assert.equal(
    (await app.source.account.loadProfile()).avatarUrl,
    first.avatarUrl,
  );
  assert.equal(app.requests.length, 1);
  const failed = plugin("copy_manga", () => ({ status: 503, data: {} }), {
    token: "old-token",
    avatar_url: "https://images.example/cached.jpg",
    account: ["user", "password"],
  });
  assert.equal(
    (await failed.source.account.loadProfile()).avatarUrl,
    "https://images.example/cached.jpg",
  );
  assert.equal(failed.storage.get("token"), "old-token");
});

test("CopyManga concurrent requests share persisted device IDs", async () => {
  const app = plugin("copy_manga", () => ({
    data: { results: { list: [], total: 0 } },
  }));
  await Promise.all([
    app.source.search.load("first", [], 1),
    app.source.search.load("second", [], 1),
  ]);
  for (const key of ["_device", "_deviceinfo", "_pseudoid"]) {
    assert.equal(app.writes.filter(([written]) => written === key).length, 1);
    assert.equal(
      app.requests[0].headers[key.slice(1)],
      app.requests[1].headers[key.slice(1)],
    );
  }
});

test("CopyManga retrieves a missing avatar even after a successful login", async () => {
  const app = plugin(
    "copy_manga",
    (_, requests) => ({
      data: {
        results:
          requests.length === 1
            ? { token: "token" }
            : { token: "token", avatar: "user/cover/found.jpg" },
      },
    }),
    { account: ["user", "password"] },
  );
  await app.source.account.login("user", "password");
  assert.equal(
    (await app.source.account.loadProfile()).avatarUrl,
    "https://s3.mangafuna.xyz/user/cover/found.jpg",
  );
  assert.equal(app.requests.length, 2);
});

test("CopyManga retries HTTP 210 in the plugin, changes device IDs and preserves image order and quality", async () => {
  const app = plugin("copy_manga", (_, requests) =>
    requests.length === 1
      ? { status: 210, data: { message: "Expected available in 2 seconds" } }
      : {
          data: {
            results: {
              chapter: {
                contents: [
                  { url: "https://images.example/second/c800x.jpg" },
                  { url: "https://images.example/first/c800x.jpg" },
                ],
                words: [1, 0],
              },
            },
          },
        },
  );
  app.settings.set("image_quality", "1200");
  const result = await app.source.comic.loadEp("comic", "chapter");
  assert.deepEqual(Array.from(result.images), [
    "https://images.example/first/c1200x.webp",
    "https://images.example/second/c1200x.webp",
  ]);
  assert.deepEqual(app.delays, [2000]);
  assert.notEqual(
    app.requests[0].headers.device,
    app.requests[1].headers.device,
  );
  assert.equal(app.source.presentation.recreateOnStatus, undefined);
});

test("CopyManga bounds read retries and never retries comment submissions", async () => {
  const app = plugin("copy_manga", () => ({
    status: 210,
    data: { message: "Expected available in 0 seconds" },
  }));
  await assert.rejects(app.source.search.load("test", [], 1), /HTTP 210/);
  assert.equal(
    app.requests.filter((request) =>
      request.url.includes("/api/v3/search/comic"),
    ).length,
    5,
  );
  assert.equal(app.delays.length, 4);
  const comments = plugin("copy_manga", () => ({ status: 210, data: {} }), {
    token: "token",
  });
  await assert.rejects(
    comments.source.comic.sendComment("comic", "uuid", "Hello", null),
    /HTTP 210/,
  );
  assert.equal(comments.requests.length, 1);
  assert.equal(comments.delays.length, 0);
});

test("CopyManga refreshes its default API host after an HTTP 210 recovery", async () => {
  let reads = 0;
  const app = plugin("copy_manga", (request) => {
    if (request.url.includes("/system/network2"))
      return { data: { results: { api: [["api.recovered.example"]] } } };
    if (++reads === 1)
      return {
        status: 210,
        data: { message: "Expected available in 0 seconds" },
      };
    return { data: { results: { list: [], total: 0 } } };
  });
  await app.source.search.load("keyword", [], 1);
  assert.equal(reads, 2);
  assert.ok(
    app.requests.at(-1).url.startsWith("https://api.recovered.example/"),
  );
});

test("CopyManga uses 30-item pages and normalizes comment IDs and avatars", async () => {
  const app = plugin("copy_manga", (request) =>
    request.url.includes("/comments?")
      ? {
          data: {
            results: {
              list: [
                {
                  id: 9,
                  user_name: "Reader",
                  user_avatar: "user/cover/avatar.jpg",
                  comment: "Hi",
                },
              ],
              total: 20,
            },
          },
        }
      : {
          data: {
            results: {
              list: [
                {
                  path_word: "comic",
                  name: "Comic",
                  cover: "https://images.example/cover.jpg",
                },
              ],
              total: 60,
            },
          },
        },
  );
  const page = await app.source.search.load("keyword", ["-"], 2);
  assert.equal(page.maxPage, 2);
  assert.equal(new URL(app.requests[0].url).searchParams.get("offset"), "30");
  assert.equal(new URL(app.requests[0].url).searchParams.get("q_type"), "");
  const comments = await app.source.comic.loadComments(
    "comic",
    "uuid",
    1,
    null,
  );
  assert.equal(comments.maxPage, 1);
  assert.equal(comments.comments[0].id, "9");
  assert.equal(
    comments.comments[0].avatar,
    "https://s3.mangafuna.xyz/user/cover/avatar.jpg",
  );
});

test("CopyManga flattens grouped chapters into the declared ID-to-title contract", async () => {
  const app = plugin("copy_manga", (request) => {
    if (request.url.endsWith("/query"))
      return { data: { results: { collect: null } } };
    if (request.url.includes("/chapters?")) {
      const url = new URL(request.url);
      const offset = Number(url.searchParams.get("offset"));
      const group = url.pathname.includes("/group/main/") ? "main" : "extra";
      return {
        data: {
          results: {
            list: [{ uuid: group + offset, name: group + offset }],
            total: group === "main" ? 101 : 1,
          },
        },
      };
    }
    return {
      data: {
        results: {
          comic: {
            name: "Comic",
            uuid: "uuid",
            author: [{ name: "Artist", path_word: "artist" }],
            status: { display: "连载中" },
          },
          groups: {
            main: { path_word: "main" },
            extra: { path_word: "extra" },
          },
        },
      },
    };
  });
  const result = await app.source.comic.loadInfo("comic");
  assert.deepEqual(
    Array.from(result.chapters.entries(), (pair) => Array.from(pair)),
    [
      ["main0", "main0"],
      ["main100", "main100"],
      ["extra0", "extra0"],
    ],
  );
  assert.equal(result.subId, "uuid");
  assert.deepEqual(Array.from(result.tags["作者"]), ["Artist"]);
  assert.deepEqual(Array.from(result.infoFields[0].values), ["Artist"]);
  assert.equal(result.infoFields[2].label.en, "Status");
  assert.equal(result.infoFields[2].action, undefined);
  assert.equal(result.headerStats.length, 1);
  assert.equal(result.headerStats[0].text, result.tags["状态"][0]);
  assert.equal(result.subTitle, undefined);
});

test("CopyManga discovers endpoints through API v1 and preserves a user-selected host", async () => {
  const app = plugin("copy_manga", (request) =>
    request.url.endsWith("/search")
      ? { body: 'const countApi = "/api/custom/search"' }
      : request.url.includes("/system/network2")
        ? { data: { results: { api: [["api.discovered.example"]] } } }
        : { data: { results: { list: [], total: 0 } } },
  );
  app.settings.set("base_url", "api.user.example");
  app.settings.set("search_api", "webAPI");
  await app.source.init();
  await app.source.search.load("test", [], 1);
  assert.ok(
    app.requests
      .at(-1)
      .url.startsWith("https://api.user.example/api/custom/search"),
  );
  app.settings.delete("base_url");
  await app.source.search.load("test", [], 1);
  assert.ok(
    app.requests.at(-1).url.startsWith("https://api.discovered.example/"),
  );
});

test("JM normalizes HTTPS URLs inside the plugin without altering unrelated URLs", () => {
  const app = plugin("jm");
  const normalize = (url) =>
    vm.runInContext(`jmNormalizeUrl(${JSON.stringify(url)})`, app.context);
  assert.equal(
    normalize("https://www.cdntwice.org:45176/a?q=1#frag"),
    "https://www.cdntwice.org/a?q=1#frag",
  );
  assert.equal(
    normalize("https://user:pass@cdnsha.jmapiproxyxxx.vip:45176/a"),
    "https://user:pass@cdnsha.jmapiproxyxxx.vip/a",
  );
  assert.equal(
    normalize("https://example.com:45176/a"),
    "https://example.com:45176/a",
  );
  assert.equal(
    normalize("http://www.cdntwice.org:45176/a"),
    "http://www.cdntwice.org:45176/a",
  );
  const image = app.source.comic.onImageLoad(
    "https://cdnhth.jmapiproxyxxx.vip:45176/1.jpg",
    "7",
    "250000",
  );
  assert.equal(image.url, "https://cdnhth.jmapiproxyxxx.vip/1.jpg");
  assert.equal(image.segments, 10);
  const later = app.source.comic.onImageLoad(
    "https://cdnhth.jmapiproxyxxx.vip:45176/1.jpg",
    "7",
    "500000",
  );
  const hash = crypto.createHash("md5").update("5000001").digest("hex");
  assert.equal(later.segments, (hash.charCodeAt(hash.length - 1) % 8) * 2 + 2);
});

test("JM declares ordered info rows and an explicit view count", async () => {
  const app = plugin("jm", (request) =>
    jmResponse(request, {
      name: "Example",
      author: ["Artist"],
      tags: ["Adventure"],
      works: ["Original"],
      actors: ["Hero"],
      total_views: 123,
    }),
  );
  const details = await app.source.comic.loadInfo("12345");
  assert.equal(details.viewsCount, 123);
  assert.equal(details.headerStats[0].text.en, "0 likes");
  assert.equal(details.headerStats[0].action, "like");
  assert.equal(details.headerStats[1].text.en, "123 views");
  assert.deepEqual(
    JSON.parse(JSON.stringify(details.infoFields.map((row) => row.label.en))),
    ["Author", "Tags", "Work", "Characters"],
  );
  assert.deepEqual(Array.from(details.infoFields[0].values), ["Artist"]);
  assert.ok(details.infoFields.every((row) => row.action === "search"));
});

test("comment services explicitly opt into both detail and reader comments", () => {
  for (const id of ["jm", "copy_manga", "picacg"]) {
    const { source } = plugin(id);
    assert.equal(source.presentation.showComments, true, id);
    assert.equal(typeof source.comic.loadComments, "function", id);
  }
  assert.equal(
    plugin("relamanhua").source.presentation.showComments,
    undefined,
  );
});

test("existing sources do not opt into website daily recommendations", () => {
  for (const id of ["copy_manga", "picacg", "relamanhua"]) {
    const { source } = plugin(id);
    assert.equal(source.presentation.dailyRecommendation, undefined, id);
    assert.equal(source.dailyRecommendation, undefined, id);
  }
});
