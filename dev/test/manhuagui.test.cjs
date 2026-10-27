const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { HtmlDocument } = require("./helpers/mini_dom.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://m.manhuagui.com";
const DESKTOP = "https://www.manhuagui.com";
const fixture = (name) =>
  fs.readFileSync(
    path.join(__dirname, "fixtures/manhuagui", name + ".html"),
    "utf8",
  );
const plain = (value) => JSON.parse(JSON.stringify(value));
const json = (data) => ({
  status: 200,
  body: JSON.stringify(data),
  headers: {},
});
const ratingData = {
  success: true,
  data: { s1: 1, s2: 2, s3: 3, s4: 4, s5: 10 },
};

function serve({ method, url, body }) {
  const route = new URL(url);
  const pathname = decodeURIComponent(route.pathname);
  if (route.origin === DESKTOP) {
    assert.match(route.pathname, /^\/comic\/(7580|19430)\/$/);
    return {
      status: 200,
      body:
        fixture("recommendations") +
        fixture("metadata-" + route.pathname.split("/")[2]) +
        fixture("chapters-" + route.pathname.split("/")[2]),
      headers: {},
    };
  }
  assert.equal(route.origin, ORIGIN);
  if (route.pathname === "/tools/vote.ashx") {
    assert.equal(route.searchParams.get("act"), "get");
    return json(ratingData);
  }
  const page = route.searchParams.get("page") || "1";
  let name;
  if (pathname === "/") name = "home";
  else if (pathname === "/s/一拳_o0.html") name = "search";
  else if (pathname === "/s/一拳_o2.html") name = "search-order";
  else if (pathname === "/s/人_o0.html") {
    if (method === "POST") {
      assert.equal(new URLSearchParams(body).get("page"), "2");
      assert.equal(new URLSearchParams(body).get("ajax"), "1");
      assert.equal(new URLSearchParams(body).get("key"), "人");
      assert.equal(new URLSearchParams(body).get("order"), "0");
      name = "search-page2";
    } else name = "search-many";
  } else if (pathname === "/s/不存在_o0.html") name = "empty";
  else if (route.pathname === "/list/")
    name = page === "2" ? "list-query2" : "list";
  else if (route.pathname === "/list/aiqing/")
    name = page === "2" ? "category2" : "category";
  else if (route.pathname === "/list/aiqing/update.html")
    name = "category-sort";
  else if (route.pathname === "/update/") name = "update";
  else if (route.pathname === "/rank/") name = page === "2" ? "rank2" : "rank";
  else if (route.pathname === "/comic/7580/") name = "detail";
  else if (route.pathname === "/comic/19430/") name = "detail2";
  else if (route.pathname === "/comic/7580/913712.html") name = "reader";
  else if (route.pathname === "/comic/7580/68731.html") name = "reader-old";
  else throw new Error("Unrouted request: " + url);
  return { status: 200, body: fixture(name), headers: {} };
}

function plugin(respond = serve, host = {}) {
  let source;
  const requests = [];
  const documents = [];
  const storage = new Map();
  const deletedCookies = [];
  let now = Date.now();
  class PluginDate extends Date {
    static now() {
      return now;
    }
  }
  const request = async (method, url, headers, body) => {
    const entry = {
      method,
      url: decodeURI(url),
      headers,
      body,
      startedAt: now,
    };
    requests.push(entry);
    return respond(entry);
  };
  // No Node APIs, browser globals, or legacy host APIs are exposed to the plugin.
  const context = vm.createContext({
    Date: PluginDate,
    Hazuki: {
      delay: async (ms) => {
        const deadline = now + ms;
        await new Promise((resolve) => setImmediate(resolve));
        now = Math.max(now, deadline);
      },
      registerSource: (value) => {
        source = value;
      },
      http: {
        get: (url, headers) => request("GET", url, headers),
        post: (url, headers, body) => request("POST", url, headers, body),
      },
      storage: {
        get: (key) => storage.get(key),
        set: async (key, value) => storage.set(key, value),
      },
      cookies: { delete: async (url) => deletedCookies.push(url) },
      error: (code, message) => Object.assign(new Error(message), { code }),
      html: {
        parse: (html) => {
          const doc = new HtmlDocument(html);
          doc.disposed = false;
          doc.dispose = () => {
            doc.disposed = true;
          };
          documents.push(doc);
          return doc;
        },
      },
      ...host,
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "manhuagui.js"), "utf8"),
    context,
  );
  return { source, requests, documents, context, storage, deletedCookies };
}

test("registers an API v1 plugin without network access on import", () => {
  const { source, requests } = plugin();
  assert.equal(source.id, "manhuagui");
  assert.equal(source.version, "1.3.2");
  assert.equal(source.apiVersion, 1);
  assert.equal(requests.length, 0);
  assert.equal(source.presentation.searchDefaultOrder, "0");
  const patterns = source.presentation.directComicIdRules.patterns.map(
    (p) => new RegExp(p, "i"),
  );
  for (const input of [
    "7580",
    ORIGIN + "/comic/7580/",
    "https://www.manhuagui.com/comic/7580/913712.html",
  ]) {
    assert.equal(patterns.map((p) => p.exec(input)?.[1]).find(Boolean), "7580");
  }
  assert.ok(patterns.every((p) => !p.test("https://evil.example/comic/7580/")));
});

test("search preserves highlighted title order, covers and genres without author subtitles", async () => {
  const { source, documents, requests } = plugin();
  const result = await source.search.load("一拳", [], 1);
  assert.equal(result.maxPage, 1);
  assert.equal(result.comics.length, 9);
  assert.deepEqual(plain(result.comics[0]), {
    id: "7580",
    title: "一拳超人",
    cover: "https://cf.mhgui.com/cpic/m/7580.jpg",
    subTitle: "第286话",
    tags: ["搞笑", "格斗", "武侠"],
  });
  assert.equal(
    documents.every((doc) => doc.disposed),
    true,
  );
  assert.equal(requests[0].headers.Referer, ORIGIN + "/");
});

test("search uses the selected website ordering and handles empty results", async () => {
  const { source, requests } = plugin();
  await source.search.load("一拳", ["2"], 1);
  assert.equal(
    decodeURIComponent(new URL(requests[0].url).pathname),
    "/s/一拳_o2.html",
  );
  assert.deepEqual(plain(await source.search.load("不存在", [], 1)), {
    comics: [],
    maxPage: 1,
  });
});

test("search page two uses the website POST protocol and retains the total page count", async () => {
  const { source, requests } = plugin();
  const first = await source.search.load("人", [], 1);
  const second = await source.search.load("人", [], 2);
  assert.equal(first.maxPage, 58);
  assert.equal(second.maxPage, 58);
  assert.equal(second.comics.length, 20);
  assert.equal(second.comics[0].id, "61117");
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(requests.at(-1).method, "POST");
  assert.equal(
    requests.at(-1).headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(requests.at(-1).headers["X-Requested-With"], "XMLHttpRequest");
  const exhausted = await source.search.load("人", [], 59);
  assert.deepEqual(plain(exhausted), { comics: [], maxPage: 58 });
  assert.equal(requests.at(-1).method, "GET");
});

test("concurrent website loads keep request starts spaced apart", async () => {
  const { source, requests } = plugin(async (request) => {
    await new Promise((resolve) => setImmediate(resolve));
    return serve(request);
  });
  const values = await Promise.all([
    source.explore[0].load(),
    source.search.load("一拳", [], 1),
    source.comic.loadInfo("7580"),
  ]);
  assert.equal(Object.keys(values[0]).length, 4);
  assert.equal(values[1].comics.length, 9);
  assert.equal(values[2].title, "一拳超人");
  for (let i = 1; i < requests.length; i++) {
    assert.ok(requests[i].startedAt - requests[i - 1].startedAt >= 1000);
  }
});

test("network failures explain the unreachable website without blocking other requests", async () => {
  let fail = true;
  const { source } = plugin((request) => {
    if (fail) {
      fail = false;
      throw "DioException [connection timeout]: request timed out";
    }
    return serve(request);
  });
  const failed = source.explore[0].load();
  const next = source.search.load("一拳", [], 1);
  await assert.rejects(failed, /无法连接 m\.manhuagui\.com.*当前代理节点/);
  assert.equal((await next).comics.length, 9);
});

test("a stalled homepage request cannot prevent a new refresh from loading", async () => {
  let release;
  const stalled = new Promise((resolve) => {
    release = resolve;
  });
  let firstRequest = true;
  const { source } = plugin(async (request) => {
    if (firstRequest) {
      firstRequest = false;
      await stalled;
    }
    return serve(request);
  });
  const old = source.explore[0].load();
  let timeout;
  try {
    const fresh = await Promise.race([
      source.explore[0].load(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("refresh waited for the stalled request")),
          1000,
        );
      }),
    ]);
    assert.equal(Object.keys(fresh).length, 4);
  } finally {
    clearTimeout(timeout);
    release();
    await old;
  }
});

test("catalog and category pagination return distinct live-captured pages", async () => {
  const { source } = plugin();
  for (const [label, param, maxPage] of [
    ["全部", "", 3101],
    ["爱情", "aiqing", 733],
  ]) {
    const first = await source.categoryComics.load(label, param, [], 1);
    const second = await source.categoryComics.load(label, param, [], 2);
    assert.equal(first.maxPage, maxPage);
    assert.equal(second.maxPage, maxPage);
    assert.equal(first.comics.length, 20);
    assert.equal(second.comics.length, 20);
    assert.notEqual(first.comics[0].id, second.comics[0].id);
  }
});

test("category ordering uses the mobile URL format and invalid categories do not request a URL", async () => {
  const { source, requests } = plugin();
  await source.categoryComics.load("爱情", "aiqing", ["update"], 1);
  assert.equal(new URL(requests[0].url).pathname, "/list/aiqing/update.html");
  assert.throws(
    () => source.categoryComics.load("bad", "../evil", [], 1),
    /无效的分类/,
  );
  assert.equal(requests.length, 1);
});

test("home includes the four website sections and reads lazy covers", async () => {
  const { source, documents } = plugin();
  const sections = await source.explore[0].load();
  assert.deepEqual(Object.keys(sections), [
    "热门连载漫画",
    "经典完结漫画",
    "漫迷推荐漫画",
    "最新上架漫画",
  ]);
  assert.equal(sections["热门连载漫画"].length, 12);
  assert.equal(sections["热门连载漫画"][0].title, "一拳超人");
  assert.equal(
    sections["热门连载漫画"][0].cover,
    "https://cf.mhgui.com/cpic/g/7580.jpg",
  );
  assert.equal(
    documents.every((doc) => doc.disposed),
    true,
  );
});

test("latest updates and ranking expose the website's five-page lists", async () => {
  const { source } = plugin();
  assert.equal((await source.explore[1].load(1)).maxPage, 5);
  const first = await source.explore[2].load(1);
  const second = await source.explore[2].load(2);
  assert.equal(first.maxPage, 5);
  assert.equal(first.comics[0].title, "鬼灭之刃");
  assert.notEqual(first.comics[0].id, second.comics[0].id);
});

test("the host ranking entry declares an option and loads the website's paginated ranking", async () => {
  const { source, requests } = plugin();
  const ranking = source.categoryComics.ranking;
  assert.deepEqual(plain(ranking.options), ["all-排行榜"]);
  const first = await ranking.load("all", 1);
  const second = await ranking.load("all", 2);
  assert.equal(first.maxPage, 5);
  assert.equal(first.comics[0].title, "鬼灭之刃");
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(new URL(requests[1].url).searchParams.get("page"), "2");
  assert.throws(() => ranking.load("unknown", 1), /无效的排行榜/);
  assert.equal(requests.length, 2);
});

test("cloud favorites expose a website shelf without fetching an account at registration", async () => {
  const { source, requests } = plugin();
  assert.equal(source.favorites.singleFolderForSingleComic, true);
  assert.equal(source.presentation.refreshCloudFavorites, true);
  assert.deepEqual(plain(await source.favorites.loadFolders(null)), {
    folders: { shelf: "网站书架" },
  });
  assert.equal(requests.length, 0);
});

test("website shelf pages, favorite state, adding and removal use the authenticated website", async () => {
  const saved = new Set(["7580", "19430"]);
  const { source, requests, documents } = plugin((request) => {
    const route = new URL(request.url);
    assert.equal(route.origin, ORIGIN);
    const action = route.searchParams.get("action");
    if (action === "user_check_login") {
      assert.equal(route.searchParams.get("m"), "1");
      return json({ status: 1, nick_name: "测试用户" });
    }
    if (route.pathname === "/user/book/")
      return {
        status: 200,
        body: fixture(
          route.searchParams.get("page") === "2" ? "shelf2" : "shelf",
        ),
      };
    if (action === "user_book_shelf_check") {
      assert.equal(request.method, "GET");
      return json({
        status: saved.has(route.searchParams.get("book_id")) ? 1 : 0,
        total: saved.size,
      });
    }
    assert.equal(request.method, "POST");
    const form = new URLSearchParams(request.body);
    assert.equal([...form.keys()].join(","), "book_id");
    assert.equal(form.get("book_id"), "1011");
    if (action === "user_book_shelf_add") saved.add("1011");
    else if (action === "user_book_shelf_delete") saved.delete("1011");
    else assert.fail("Unexpected action: " + action);
    return json({ status: 1 });
  });
  const first = await source.favorites.loadComics(1, "shelf");
  const second = await source.favorites.loadComics(2, "shelf");
  assert.equal(first.maxPage, 2);
  assert.equal(second.maxPage, 2);
  assert.deepEqual(plain(first.comics[0]), {
    id: "7580",
    title: "一拳超人",
    cover: "https://cf.mhgui.com/cpic/m/7580.jpg",
    subTitle: "第286话",
    tags: [],
  });
  assert.equal(second.comics[0].id, "19430");
  assert.deepEqual(
    plain((await source.favorites.loadFolders("7580")).favorited),
    ["shelf"],
  );
  assert.deepEqual(
    plain((await source.favorites.loadFolders("1011")).favorited),
    [],
  );
  await source.favorites.addOrDelFavorite("1011", "shelf", true);
  assert.deepEqual(
    plain((await source.favorites.loadFolders("1011")).favorited),
    ["shelf"],
  );
  await source.favorites.addOrDelFavorite("1011", "shelf", false);
  assert.deepEqual(
    plain((await source.favorites.loadFolders("1011")).favorited),
    [],
  );
  const posts = requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 2);
  assert.ok(
    posts.every(
      (request) =>
        request.headers.Referer === ORIGIN + "/" &&
        request.headers["Content-Type"] === "application/x-www-form-urlencoded",
    ),
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("an authenticated empty shelf is distinct from an expired session", async () => {
  const empty = plugin((request) =>
    request.url.includes("user_check_login")
      ? json({ status: 1, username: "test" })
      : { status: 200, body: fixture("shelf-empty") },
  );
  assert.deepEqual(plain(await empty.source.favorites.loadComics(1, null)), {
    comics: [],
    maxPage: 1,
  });
  const expired = plugin(() => json({ status: 0 }));
  await assert.rejects(expired.source.favorites.loadComics(1, "shelf"), {
    code: "AUTH_EXPIRED",
  });
  await assert.rejects(expired.source.favorites.loadFolders("7580"), {
    code: "AUTH_EXPIRED",
  });
  await assert.rejects(
    expired.source.favorites.addOrDelFavorite("7580", "shelf", true),
    { code: "AUTH_EXPIRED" },
  );
  assert.ok(
    expired.requests.every((request) =>
      request.url.includes("user_check_login"),
    ),
  );
});

test("shelf failures surface errors without reporting success or repeating writes", async () => {
  const expired = plugin((request) =>
    request.url.includes("user_check_login")
      ? json({ status: 1, username: "test" })
      : json({ status: 0, msg: "对不起，用户尚未登录或已超时！" }),
  );
  await assert.rejects(expired.source.favorites.loadFolders("7580"), {
    code: "AUTH_EXPIRED",
  });
  for (const response of [
    json({ status: 0, msg: "书架操作失败" }),
    new Error("connection error"),
  ]) {
    const { source, requests } = plugin((request) => {
      if (request.url.includes("user_check_login"))
        return json({ status: 1, username: "test" });
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(
      source.favorites.addOrDelFavorite("7580", "shelf", false),
      /书架操作失败|无法连接/,
    );
    assert.equal(
      requests.filter((request) => request.method === "POST").length,
      1,
    );
  }
  const invalid = plugin();
  await assert.rejects(invalid.source.favorites.loadFolders("../bad"), /无效/);
  await assert.rejects(
    invalid.source.favorites.addOrDelFavorite("../bad", "shelf", true),
    /无效/,
  );
  assert.equal(invalid.requests.length, 0);
  const blocked = plugin((request) =>
    request.url.includes("user_check_login")
      ? json({ status: 1, username: "test" })
      : { status: 200, body: "<html>blocked</html>" },
  );
  await assert.rejects(
    blocked.source.favorites.loadComics(1, "shelf"),
    /无法读取漫画列表/,
  );
});

test("detail exposes authors in infoFields and keeps chapter reading order in an array", async () => {
  const { source, documents } = plugin();
  const detail = await source.comic.loadInfo("7580");
  assert.equal(detail.title, "一拳超人");
  assert.equal(detail.description, "固定测试简介");
  assert.equal(detail.updateTime, "2026-10-08");
  assert.deepEqual(plain(detail.infoFields[0]), {
    label: "作者",
    values: ["one", "村田雄介"],
    action: "search",
  });
  assert.deepEqual(plain(detail.infoFields), [
    { label: "作者", values: ["one", "村田雄介"], action: "search" },
    { label: "题材", values: ["搞笑", "格斗", "武侠"], action: "search" },
    { label: "地区", values: ["日本漫画"], action: "search" },
    { label: "读者", values: ["少年"], action: "search" },
    { label: "出品年代", values: ["2009年"], action: "search" },
    { label: "字母索引", values: ["Y"], action: "search" },
    {
      label: "别名",
      values: ["ONE-PUNCH MAN", "一击男", "ワンパンマン"],
      action: "search",
    },
  ]);
  assert.deepEqual(plain(detail.headerBadges), [{ text: "连载" }]);
  const chapters = detail.chapterGroups[0].chapters;
  assert.deepEqual(plain(detail.chapterGroups.map((group) => group.title)), [
    "单话",
    "单行本",
    "番外篇",
    "原作版",
  ]);
  assert.equal(chapters.length, 337);
  assert.equal(chapters[0].title, "第01回");
  assert.equal(chapters.at(-1).id, "913712");
  assert.equal(chapters.at(-1).title, "第286话");
  assert.equal(chapters[66].title, "第56回");
  assert.equal(chapters[67].title, "第57回");
  const allChapters = detail.chapterGroups.flatMap((group) => group.chapters);
  assert.equal(allChapters.length, 449);
  assert.equal(
    new Set(allChapters.map((ch) => ch.id)).size,
    allChapters.length,
  );
  assert.equal(detail.chapterGroups[2].chapters[0].id, "68731");
  const completed = await source.comic.loadInfo("19430");
  assert.deepEqual(plain(completed.tags.状态), ["完结"]);
  assert.deepEqual(plain(completed.headerBadges), [{ text: "完结" }]);
  assert.deepEqual(plain(completed.headerStats[0]), {
    text: "更新至 第23卷",
    icon: "book",
  });
  assert.equal(
    completed.infoFields.find((field) => field.label === "出品年代").values[0],
    "2016年",
  );
  assert.equal(
    completed.infoFields.some((field) => field.label === "别名"),
    false,
  );
  assert.equal(
    completed.infoFields.some((field) => field.label === "状态"),
    false,
  );
  assert.equal(
    completed.headerStats.some((stat) => stat.text === "完结"),
    false,
  );
  assert.deepEqual(plain(completed.chapterGroups.map((group) => group.title)), [
    "单行本",
    "单话",
    "番外篇",
  ]);
  assert.equal(completed.chapterGroups[0].chapters[0].title, "第01卷");
  assert.equal(completed.chapterGroups[0].chapters.at(-1).title, "第23卷");
  assert.equal(
    documents.every((doc) => doc.disposed),
    true,
  );
});

test("detail includes the website's similar books and weighted ten-point rating", async () => {
  const { source, requests, documents } = plugin();
  assert.equal(source.presentation.showComments, true);
  assert.deepEqual(plain(source.presentation.commentOrders), {
    newest: "最新",
    hot: "热门",
  });
  assert.equal(source.presentation.commentDefaultOrder, "newest");
  assert.equal(source.presentation.buttons[0].id, "relatedComics");
  const detail = await source.comic.loadInfo("7580");
  assert.deepEqual(plain(detail.recommend.map((comic) => comic.id)), [
    "1011",
    "8162",
    "11201",
    "14079",
    "20331",
    "22084",
  ]);
  assert.deepEqual(plain(detail.recommend[0]), {
    id: "1011",
    title: "怪怪守护神",
    cover: "https://cf.mhgui.com/cpic/s/1011.jpg",
    subTitle: "更新至186.1话",
  });
  assert.deepEqual(plain(detail.headerStats), [
    { text: "更新至 第286话", icon: "book" },
    { text: "8.0 分 · 20 人", icon: "star" },
  ]);
  assert.equal(
    detail.infoFields.some((field) => ["评分", "更新至"].includes(field.label)),
    false,
  );
  const desktopRequest = requests.find((request) =>
    request.url.startsWith(DESKTOP),
  );
  assert.equal(desktopRequest.url, DESKTOP + "/comic/7580/");
  assert.equal(desktopRequest.headers.Referer, DESKTOP + "/");
  assert.ok(documents.every((doc) => doc.disposed));
});

test("clicking a genre searches its website category with pagination and selected ordering", async () => {
  const { source, requests } = plugin();
  const first = await source.search.load("爱情", [], 1);
  const second = await source.search.load("爱情", [], 2);
  assert.equal(first.maxPage, 733);
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(new URL(requests[1].url).pathname, "/list/aiqing/");
  assert.equal(new URL(requests[1].url).searchParams.get("page"), "2");
  await source.search.load("爱情", ["1"], 1);
  assert.equal(
    new URL(requests.at(-1).url).pathname,
    "/list/aiqing/update.html",
  );
});

test("zero votes and an empty similar list do not invent recommendations or produce NaN", async () => {
  const { source } = plugin((request) => {
    if (request.url.startsWith(DESKTOP))
      return {
        status: 200,
        body:
          '<div class="book-similar"><ul></ul></div>' +
          fixture("chapters-7580"),
      };
    if (request.url.includes("/tools/vote.ashx"))
      return json({
        success: true,
        data: { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 },
      });
    return serve(request);
  });
  const detail = await source.comic.loadInfo("7580");
  assert.deepEqual(plain(detail.recommend), []);
  assert.deepEqual(plain(detail.infoFields.map((field) => field.label)), [
    "作者",
    "题材",
  ]);
  assert.equal(detail.headerStats.at(-1).text, "0.0 分 · 0 人");
});

test("region, reader, production year and initial tags open the matching website category", async () => {
  const { source, requests } = plugin(() => ({
    status: 200,
    body: fixture("list"),
  }));
  for (const [term, slug] of [
    ["日本漫画", "japan"],
    ["少年", "shaonian"],
    ["2009年", "200x"],
    ["2016年", "2016"],
    ["Y", "y"],
  ]) {
    await source.search.load(term, [], 2);
    const route = new URL(requests.at(-1).url);
    assert.equal(route.pathname, "/list/" + slug + "/");
    assert.equal(route.searchParams.get("page"), "2");
  }
});

test("invalid rating or missing similar section fails explicitly and disposes documents", async () => {
  for (const invalid of [
    { success: false },
    { success: true, data: { s1: -1, s2: 0, s3: 0, s4: 0, s5: 1 } },
    { success: true, data: { s1: 0 } },
  ]) {
    const { source, documents } = plugin((request) =>
      request.url.includes("/tools/vote.ashx") ? json(invalid) : serve(request),
    );
    await assert.rejects(source.comic.loadInfo("7580"), /无法读取评分/);
    assert.ok(documents.every((doc) => doc.disposed));
  }
  const { source, documents } = plugin((request) =>
    request.url.startsWith(DESKTOP)
      ? { status: 200, body: "<html>verification required</html>" }
      : serve(request),
  );
  await assert.rejects(source.comic.loadInfo("7580"), /无法读取相关推荐/);
  assert.ok(documents.every((doc) => doc.disposed));
});

test("password login uses the website form and verifies the resulting session", async () => {
  let loggedIn = false;
  const { source, requests, deletedCookies } = plugin((request) => {
    const route = new URL(request.url);
    assert.equal(route.origin, DESKTOP);
    if (route.searchParams.get("action") === "user_login") {
      assert.equal(request.method, "POST");
      const form = new URLSearchParams(request.body);
      assert.equal(form.get("txtUserName"), "账号+test@example.com");
      assert.equal(form.get("txtPassword"), " 密码+&= ");
      assert.equal(form.get("chkRemember"), "checked");
      loggedIn = true;
      return json({ status: 1, msg: "登录成功" });
    }
    assert.equal(route.searchParams.get("action"), "user_check_login");
    assert.equal(route.searchParams.get("m"), "1");
    return json(
      loggedIn
        ? {
            status: 1,
            username: "test",
            nick_name: encodeURI("测试昵称"),
            avatar: "//cf.mhgui.com/upload/avatar.jpg",
          }
        : { status: 0 },
    );
  });
  assert.equal(source.account.loginMethods[0].input, "credentials");
  await assert.rejects(source.account.loadProfile(), { code: "AUTH_EXPIRED" });
  assert.deepEqual(
    plain(await source.account.login(" 账号+test@example.com ", " 密码+&= ")),
    {
      displayName: "测试昵称",
      avatarUrl: "https://cf.mhgui.com/upload/avatar.jpg",
    },
  );
  assert.deepEqual(plain(await source.account.loadProfile()), {
    displayName: "测试昵称",
    avatarUrl: "https://cf.mhgui.com/upload/avatar.jpg",
  });
  assert.equal(
    requests[1].headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  await source.account.logout();
  assert.deepEqual(deletedCookies, [DESKTOP + "/", ORIGIN + "/"]);
});

test("profiles resolve website avatar URLs and preserve the username when no nickname is set", async () => {
  for (const [avatar, expected] of [
    ["/upload/avatar.jpg", DESKTOP + "/upload/avatar.jpg"],
    ["https://cf.mhgui.com/avatar.jpg", "https://cf.mhgui.com/avatar.jpg"],
    ["", ""],
  ]) {
    const { source } = plugin(() =>
      json({ status: 1, username: encodeURI("昵称"), avatar }),
    );
    assert.deepEqual(plain(await source.account.loadProfile()), {
      displayName: "昵称",
      avatarUrl: expected,
    });
  }
});

test("failed login and unverified sessions are rejected without accepting a profile", async () => {
  const failed = plugin(() => json({ status: 0, msg: "用户名或密码错误" }));
  await assert.rejects(
    failed.source.account.login("user", "wrong"),
    /用户名或密码错误/,
  );
  assert.equal(failed.requests.length, 1);
  const unverified = plugin((request) =>
    json({ status: request.method === "POST" ? 1 : 0 }),
  );
  await assert.rejects(unverified.source.account.login("user", "pass"), {
    code: "AUTH_EXPIRED",
  });
  const empty = plugin();
  await assert.rejects(empty.source.account.login(" ", "pass"), /请填写/);
  assert.equal(empty.requests.length, 0);
});

const commentRows = {
  total: 61,
  commentIds: ["3,2,1", "2,1", "1"],
  comments: {
    1: {
      id: 1,
      user_name: "甲",
      content: "原评论",
      add_time: "2026-10-26 10:00:00",
      support_count: 3,
      reply_count: 1,
    },
    2: {
      id: 2,
      user_name: "",
      content: "",
      add_time: "2026-10-26 11:00:00",
      support_count: 0,
      reply_count: 1,
    },
    3: {
      id: 3,
      user_name: "乙",
      avatar: "//cf.mhgui.com/avatar.jpg",
      content:
        "<b>第一行</b><br/>第二行<script>globalThis.untrusted=true;</script>",
      add_time: "2026-10-26 12:00:00",
      support_count: 2,
      reply_count: 0,
    },
  },
};

test("comments preserve website order, quote chains and pagination with newest and hot requests", async () => {
  const { source, requests, documents, context } = plugin((request) => {
    const route = new URL(request.url);
    assert.equal(route.origin, ORIGIN);
    assert.equal(route.searchParams.get("action"), "comment_list");
    assert.equal(route.searchParams.get("m"), "1");
    assert.equal(route.searchParams.get("book_id"), "7580");
    return route.searchParams.get("page_index") === "1"
      ? json(commentRows)
      : json({ total: 61, commentIds: ["1"], comments: commentRows.comments });
  });
  const first = await source.comic.loadComments("7580", null, 1, null);
  assert.equal(first.maxPage, 3);
  assert.deepEqual(plain(first.comments.map((comment) => comment.id)), [
    "3",
    "2",
    "1",
  ]);
  assert.deepEqual(plain(first.comments[0]), {
    id: "3",
    userName: "乙",
    avatar: "https://cf.mhgui.com/avatar.jpg",
    content: "第一行\n第二行",
    time: "2026-10-26 12:00:00",
    score: 2,
    replyCount: 0,
    isLiked: false,
    canUnlike: false,
    quotedComments: [
      {
        id: "1",
        userName: "甲",
        avatar: "",
        content: "原评论",
        time: "2026-10-26 10:00:00",
        score: 3,
        replyCount: 1,
        isLiked: false,
        canUnlike: false,
      },
      {
        id: "2",
        userName: "",
        avatar: "",
        content: "此评论已被删除",
        time: "2026-10-26 11:00:00",
        score: 0,
        replyCount: 1,
        isLiked: false,
        canUnlike: false,
      },
    ],
  });
  const second = await source.comic.loadComments(
    "7580",
    null,
    2,
    null,
    "newest",
  );
  assert.equal(second.comments[0].id, "1");
  await source.comic.loadComments("7580", null, 1, null, "hot");
  assert.equal(new URL(requests.at(-1).url).searchParams.get("hot"), "1");
  assert.equal(new URL(requests[0].url).searchParams.has("hot"), false);
  assert.equal(vm.runInContext("globalThis.untrusted", context), undefined);
  assert.ok(documents.every((doc) => doc.disposed));
  assert.notEqual(
    source.presentation.commentReplies,
    true,
    "quote chains are not reply pages",
  );
});

test("empty comments and malformed responses are distinguished", async () => {
  const empty = plugin(() => json({ total: 0, commentIds: [], comments: {} }));
  assert.deepEqual(
    plain(await empty.source.comic.loadComments("7580", null, 1, null)),
    { comments: [], maxPage: 1 },
  );
  const broken = plugin(() =>
    json({ total: 3, commentIds: ["3"], comments: {} }),
  );
  await assert.rejects(
    broken.source.comic.loadComments("7580", null, 1, null),
    /无法读取评论内容/,
  );
  const blocked = plugin(() => ({ status: 200, body: "<html>blocked</html>" }));
  await assert.rejects(
    blocked.source.comic.loadComments("7580", null, 1, null),
    /无法读取网站数据/,
  );
});

test("chapter groups reject missing categories, duplicate IDs and foreign comic links", () => {
  const { context } = plugin();
  for (const [html, message] of [
    ["<div></div>", /没有可读取的章节/],
    [
      '<div class="chapter-list"><ul><a href="/comic/7580/1.html">第一话</a></ul></div>',
      /无法读取章节分类/,
    ],
    [
      '<h4>单话</h4><div class="chapter-list"><ul><a href="/comic/19430/1.html">第一话</a></ul></div>',
      /无效或重复/,
    ],
    [
      '<h4>单话</h4><div class="chapter-list"><ul><a href="/comic/7580/1.html">第一话</a></ul></div><h4>单行本</h4><div class="chapter-list"><ul><a href="/comic/7580/1.html">第一卷</a></ul></div>',
      /无效或重复/,
    ],
  ]) {
    context.groupHtml = html;
    assert.throws(
      () =>
        vm.runInContext(
          'manhuaguiChapterGroups(Hazuki.html.parse(groupHtml), "7580")',
          context,
        ),
      message,
    );
  }
});

test("comment likes target the selected floor and persist without simulating unlike", async () => {
  const { source, requests, storage } = plugin((request) => {
    const route = new URL(request.url);
    if (route.searchParams.get("action") === "comment_list")
      return json(commentRows);
    assert.equal(route.origin, ORIGIN);
    assert.equal(route.searchParams.get("action"), "comment_support");
    assert.equal(route.searchParams.get("comment_id"), "1");
    return json({ status: 1 });
  });
  await source.comic.likeComment("7580", null, "1", true);
  assert.equal(storage.get("commentLike:1"), true);
  const page = await source.comic.loadComments("7580", null, 1, null);
  assert.equal(page.comments[0].quotedComments[0].isLiked, true);
  assert.equal(page.comments[2].isLiked, true);
  const count = requests.length;
  await assert.rejects(
    source.comic.likeComment("7580", null, "1", false),
    /不支持取消点赞/,
  );
  assert.equal(requests.length, count);
});

test("failed likes do not save liked state and are not retried", async () => {
  for (const response of [
    json({ status: 0, msg: "点赞失败" }),
    new Error("connection error"),
  ]) {
    const { source, storage, requests } = plugin(() => {
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(
      source.comic.likeComment("7580", null, "1", true),
      /点赞失败|无法连接/,
    );
    assert.equal(storage.has("commentLike:1"), false);
    assert.equal(requests.length, 1);
  }
});

test("sending and replying follow the website's double-encoded content protocol", async () => {
  const { source, requests } = plugin((request) => {
    assert.equal(new URL(request.url).origin, DESKTOP);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "user_check_login")
      return json({ status: 1, username: "test" });
    assert.equal(action, "comment_add");
    assert.equal(request.method, "POST");
    const form = new URLSearchParams(request.body);
    assert.equal(form.get("book_id"), "7580");
    assert.equal(
      decodeURIComponent(form.get("txtContent")),
      "你好 + & = %\n第二行",
    );
    return json({ status: 1 });
  });
  const content = " 你好 + & = %\n第二行 ";
  await source.comic.sendComment("7580", null, content, null);
  await source.comic.sendComment("7580", null, content, "3");
  const posts = requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    posts.map((request) =>
      new URLSearchParams(request.body).get("to_comment_id"),
    ),
    ["0", "3"],
  );
});

test("comment validation and expired sessions cannot send, and sending errors are never retried", async () => {
  const invalid = plugin();
  for (const content of [" ", "字".repeat(1001)])
    await assert.rejects(
      invalid.source.comic.sendComment("7580", null, content, null),
      /1～1000/,
    );
  await assert.rejects(
    invalid.source.comic.sendComment("7580", null, "test", "../bad"),
    /无效/,
  );
  assert.equal(invalid.requests.length, 0);
  const expired = plugin(() => json({ status: 0 }));
  await assert.rejects(
    expired.source.comic.sendComment("7580", null, "test", null),
    { code: "AUTH_EXPIRED" },
  );
  assert.ok(expired.requests.every((request) => request.method === "GET"));
  for (const response of [
    json({ status: 0, msg: "发送过于频繁" }),
    new Error("connection error"),
  ]) {
    const { source, requests } = plugin((request) => {
      if (request.method === "GET")
        return json({ status: 1, username: "test" });
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(
      source.comic.sendComment("7580", null, "test", null),
      /发送过于频繁|无法连接/,
    );
    assert.equal(
      requests.filter((request) => request.method === "POST").length,
      1,
    );
  }
});

function ratingDialog(event) {
  const opened = [],
    patches = [],
    alerts = [];
  let closed = 0;
  return {
    opened,
    patches,
    alerts,
    get closed() {
      return closed;
    },
    host: {
      comicHeaderVersion: 2,
      ui: {
        dialogVersion: 3,
        alert: async (options) => {
          assert.equal(
            closed,
            opened.length,
            "close the rating form before showing success",
          );
          alerts.push(plain(options));
        },
        openDialog: async (options) => {
          opened.push(plain(options));
          return {
            nextEvent: async () => event,
            update: async (patch) => patches.push(plain(patch)),
            close: async () => {
              closed++;
            },
          };
        },
      },
    },
  };
}

test("rating action submits whole stars once, persists the vote and requests a detail refresh", async () => {
  const dialog = ratingDialog({
    type: "action",
    id: "submit",
    values: { score: 4 },
  });
  const { source, storage, requests } = plugin((request) => {
    if (new URL(request.url).searchParams.get("act") === "vote")
      return json({ success: true });
    return serve(request);
  }, dialog.host);
  const detail = await source.comic.loadInfo("7580");
  assert.equal(detail.headerStats.at(-1).action, "plugin");
  assert.equal(detail.headerStats.at(-1).id, "rating");
  assert.deepEqual(plain(await source.comic.onHeaderAction("7580", "rating")), {
    reload: true,
  });
  assert.equal(storage.get("vote:7580"), 4);
  const votes = () =>
    requests.filter(
      (request) => new URL(request.url).searchParams.get("act") === "vote",
    );
  assert.equal(votes().length, 1);
  assert.equal(new URL(votes()[0].url).searchParams.get("s"), "4");
  assert.equal(dialog.opened[0].content[1].max, 5);
  assert.equal(dialog.closed, 1);
  assert.deepEqual(dialog.alerts, [
    { title: "评分成功", message: "感谢您的参与！" },
  ]);
  await source.comic.onHeaderAction("7580", "rating");
  assert.equal(dialog.opened[1].content[1].readOnly, true);
  assert.equal(dialog.opened[1].content[1].initialValue, 4);
  assert.equal(votes().length, 1);
  assert.equal(
    dialog.alerts.length,
    1,
    "viewing an existing vote must not report another success",
  );
});

test("rating cancellation, failure and invalid stars do not save a successful vote", async () => {
  for (const event of [
    { type: "closed", reason: "user" },
    { type: "action", id: "submit", values: { score: 0 } },
    { type: "action", id: "submit", values: { score: 3.5 } },
    { type: "action", id: "submit", values: { score: 6 } },
    { type: "action", id: "submit", values: { score: 5 } },
  ]) {
    const dialog = ratingDialog(event);
    const { source, storage, requests } = plugin(
      (request) =>
        new URL(request.url).searchParams.get("act") === "vote"
          ? json({ success: false })
          : serve(request),
      dialog.host,
    );
    const task = source.comic.onHeaderAction("7580", "rating");
    if (event.type === "closed") await task;
    else await assert.rejects(task, /请选择|评分失败/);
    assert.equal(storage.has("vote:7580"), false);
    assert.equal(
      requests.filter(
        (request) => new URL(request.url).searchParams.get("act") === "vote",
      ).length,
      event.values?.score === 5 ? 1 : 0,
    );
    assert.equal(dialog.closed, 1);
    assert.equal(dialog.alerts.length, 0);
  }
});

test("reads modern and old packed chapters without running website JavaScript", async () => {
  const { source, context } = plugin((request) => ({
    ...serve(request),
    body: "<script>globalThis.untrusted = true;</script>" + serve(request).body,
  }));
  const modern = await source.comic.loadEp("7580", "913712");
  const old = await source.comic.loadEp("7580", "68731");
  assert.equal(modern.images.length, 14);
  assert.equal(old.images.length, 27);
  assert.equal(
    modern.images[0],
    "https://i.hamreus.com/ps3/y/yiquanchaoren/%E7%AC%AC286%E8%AF%9D/0001.jpg.webp?e=1793882140&m=kPNy-udyp3LF2v_SY1rzSw",
  );
  assert.match(modern.images.at(-1), /0014\.jpg\.webp\?e=/);
  assert.match(old.images[0], /\/00\/000001\.jpg\.webp\?e=/);
  assert.equal(vm.runInContext("globalThis.untrusted", context), undefined);
  const config = source.comic.onImageLoad(modern.images[0], "7580", "913712");
  assert.equal(config.headers.Referer, ORIGIN + "/");
  assert.equal(
    source.comic.onImageLoad("https://cf.mhgui.com/cpic/m/7580.jpg").headers
      .Referer,
    ORIGIN + "/",
  );
});

test("a blocked POST page cannot silently end search results", async () => {
  const { source, documents } = plugin((request) =>
    request.method === "POST"
      ? { status: 200, body: "<html>verification required</html>", headers: {} }
      : serve(request),
  );
  await assert.rejects(source.search.load("人", [], 2), /无法读取搜索分页结果/);
  assert.equal(
    documents.every((doc) => doc.disposed),
    true,
  );
});

test("rejects wrong chapters, missing reader data and corrupt compression", async () => {
  const mismatched = plugin(() => ({
    status: 200,
    body: fixture("reader"),
    headers: {},
  }));
  await assert.rejects(
    mismatched.source.comic.loadEp("7580", "68731"),
    /章节与请求不一致/,
  );
  const missing = plugin(() => ({
    status: 200,
    body: "<html>访问受限</html>",
    headers: {},
  }));
  await assert.rejects(
    missing.source.comic.loadEp("7580", "913712"),
    /找不到章节图片数据/,
  );
  const { context } = plugin();
  assert.throws(
    () => vm.runInContext('manhuaguiDecompress("!")', context),
    /无效的章节压缩数据/,
  );
  assert.throws(
    () => vm.runInContext('manhuaguiDecompress("A")', context),
    /章节压缩数据不完整/,
  );
});

test("request and parsing failures are surfaced and parsed documents are disposed", async () => {
  const denied = plugin(() => ({ status: 403, body: "denied", headers: {} }));
  await assert.rejects(denied.source.search.load("一拳", [], 1), /HTTP 403/);
  const missing = plugin(() => ({
    status: 200,
    body: "<html></html>",
    headers: {},
  }));
  await assert.rejects(missing.source.comic.loadInfo("7580"), /找不到漫画详情/);
  await assert.rejects(
    missing.source.categoryComics.load("全部", "", [], 1),
    /无法读取漫画列表/,
  );
  assert.equal(
    missing.documents.every((doc) => doc.disposed),
    true,
  );
  const { source, requests } = plugin();
  await assert.rejects(
    source.comic.loadEp("../bad", "913712"),
    /无效的漫画或章节 ID/,
  );
  assert.equal(requests.length, 0);
});
