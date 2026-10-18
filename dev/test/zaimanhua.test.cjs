const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures/zaimanhua");
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));

function respond(url) {
  const route = new URL(url);
  // Account success data is synthetic, based on the site's published fields.
  // No real account credentials or successful account responses are fixtures.
  const ok = (data) => ({
    status: 200,
    body: JSON.stringify({ errno: 0, data }),
  });
  if (route.pathname === "/api/v1/comic1/config")
    return ok({ clientId: "test-client" });
  if (route.pathname === "/lpi/v1/captcha/click/create")
    return ok({
      captchaId: "test-captcha",
      bigImg: "data:image/png;base64,AA==",
      verifyImg: "data:image/png;base64,AA==",
      dots: '{"0":{},"1":{},"2":{}}',
    });
  if (/\/lpi\/v1\/login\/(passwd|sms)$/.test(route.pathname))
    return ok({ user: { token: "test-session" } });
  if (
    route.pathname === "/lpi/v1/sms/send" ||
    route.pathname === "/app/v1/readingRecord/add"
  )
    return ok({});
  if (route.pathname === "/v1/userInfo/get")
    return ok({
      userInfo: {
        uid: 42,
        nickname: "测试账号",
        photo: "//images.zaimanhua.com/test-avatar.jpg",
      },
    });
  if (route.pathname === "/app/v1/comic/sub/list")
    return ok({
      subList: fixture(
        route.searchParams.get("page") === "2" ? "search2" : "search",
      ).data.list,
      total: 41,
    });
  if (route.pathname === "/app/v1/comic/sub/checkIsSub")
    return ok({ isSub: false });
  if (
    ["/app/v1/comic/sub/add", "/app/v1/comic/sub/del"].includes(route.pathname)
  )
    return ok(null);
  if (/\/lpi\/v1\/(wechat|qq|weibo)\/web\/auth_url$/.test(route.pathname)) {
    const provider = route.pathname.split("/")[3];
    const bases = {
      wechat: "https://open.weixin.qq.com/connect/qrconnect",
      qq: "https://graph.qq.com/oauth2.0/authorize",
      weibo: "https://api.weibo.com/oauth2/authorize",
    };
    return ok({
      url:
        bases[provider] +
        "?state=test-provider-state&redirect_uri=" +
        encodeURIComponent(
          `https://account-api.zaimanhua.com/v1/${provider}/web/auth_back`,
        ),
    });
  }
  const routes = {
    "/api/v1/comic2/index": "home",
    "/api/v1/comic2/update_list": "update",
    "/api/v1/comic1/filter": "catalog",
    "/api/v1/comic1/rank_list": "ranking",
    "/api/v1/comic2/comic/detail": "detail",
    "/api/v1/comic1/comic/same_list": "related",
  };
  let name = routes[route.pathname];
  if (route.pathname === "/app/v1/search/index")
    name = route.searchParams.get("page") === "2" ? "search2" : "search";
  if (route.pathname === "/api/v1/comic2/chapter/detail")
    name =
      route.searchParams.get("chapter_id") === "193700"
        ? "chapter2"
        : "chapter";
  assert.ok(name, "unrouted request: " + url);
  return { status: 200, body: JSON.stringify(fixture(name)) };
}

function plugin(override, initial = {}) {
  let source;
  const requests = [];
  const logs = [];
  const secrets = new Map(Object.entries(initial.secrets || {}));
  const storage = new Map(Object.entries(initial.storage || {}));
  const writes = [];
  const cookieDeletes = [];
  const http = async (method, url, headers, body) => {
    requests.push({ method, url: new URL(url), headers, body });
    return (
      (override && (await override(url, headers, method, body))) || respond(url)
    );
  };
  const Hazuki = {
    registerSource(value) {
      assert.equal(source, undefined);
      source = value;
    },
    http: {
      get: (url, headers) => http("GET", url, headers),
      post: (url, headers, body) => http("POST", url, headers, body),
    },
    secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => {
        writes.push(["secret", key, value]);
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
    storage: {
      get: (key) => storage.get(key),
      set: async (key, value) => {
        writes.push(["storage", key, value]);
        storage.set(key, value);
      },
      delete: async (key) => {
        storage.delete(key);
      },
    },
    cookies: {
      delete: async (url) => {
        cookieDeletes.push(url);
      },
    },
    convert: {
      encodeUtf8: (value) => Buffer.from(value, "utf8"),
      md5: (value) => crypto.createHash("md5").update(value).digest(),
      hexEncode: (value) => Buffer.from(value).toString("hex"),
    },
    error: (code, message) => Object.assign(new Error(message), { code }),
    log: (...args) => logs.push(args),
  };
  // No browser/Node globals: exercise the same single-file API v1 environment.
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "zaimanhua.js"), "utf8"), {
    Hazuki,
  });
  assert.equal(requests.length, 0, "import must not access the network");
  return { source, requests, logs, secrets, storage, writes, cookieDeletes };
}

test("registers an API v1 source discoverable by the index generator", () => {
  const { source } = plugin();
  const { buildIndex } = require("../scripts/update-plugin-index.cjs");
  const entry = buildIndex(ROOT).plugins.find((item) => item.id === source.id);
  assert.equal(entry.name, "再漫画");
  assert.equal(entry.version, "1.2.0");
  assert.equal(source.apiVersion, 1);
  assert.equal(typeof source.comic.loadReadingProgress, "function");
  assert.equal(typeof source.comic.loadReadingHistory, "function");
  assert.deepEqual(
    Array.from(source.account.loginMethods, (method) => method.id),
    ["password", "sms", "wechat", "qq", "weibo"],
  );
  for (const method of ["loadComics", "loadFolders", "addOrDelFavorite"])
    assert.equal(
      typeof source.favorites[method],
      "function",
      "host favorites capability must be registered",
    );
  assert.equal(source.favorites.addFolder, undefined);
  assert.equal(source.favorites.deleteFolder, undefined);
  assert.equal(source.presentation.showComments, undefined);
  const rules = source.presentation.directComicIdRules.patterns.map(
    (pattern) => new RegExp(pattern, "i"),
  );
  for (const input of [
    "80825",
    "https://manhua.zaimanhua.com/details/80825?from=search",
    "https://manhua.zaimanhua.com/view/example/80825/170150",
  ]) {
    assert.equal(
      rules.find((rule) => rule.test(input)).exec(input)[1],
      "80825",
    );
  }
  assert.equal(
    rules.some((rule) => rule.test("https://example.com/80825")),
    false,
  );
});

test("search encodes user input, normalizes lists and calculates total pages", async () => {
  const { source, requests } = plugin();
  const first = await source.search.load(" 猫 &?# ", [], 1);
  const second = await source.search.load("猫", [], 2);
  const raw = fixture("search").data;
  assert.equal(first.maxPage, Math.ceil(raw.total / raw.size));
  assert.equal(first.comics.length, 20);
  assert.equal(first.comics[0].id, "63911");
  assert.equal(first.comics[0].title, "我是猫魔导师");
  assert.equal(first.comics[0].subTitle, "番外篇");
  assert.deepEqual(plain(first.comics[0].tags), ["魔法", "轻小说"]);
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(requests[0].url.searchParams.get("keyword"), "猫 &?#");
  assert.equal(requests[1].url.searchParams.get("page"), "2");
  assert.equal(requests[0].headers.Platform, "pc");
  assert.equal(requests[0].headers.Referer, "https://manhua.zaimanhua.com/");
  assert.equal(requests[0].headers.Authorization, undefined);
});

test("empty search results terminate pagination", async () => {
  const { source } = plugin(() => ({
    status: 200,
    body: JSON.stringify({ errno: 0, data: { list: null, total: 0 } }),
  }));
  assert.deepEqual(plain(await source.search.load("no results", [], 1)), {
    comics: [],
    maxPage: 1,
  });
});

test("catalog uses the site's filter IDs and all three filters", async () => {
  const { source, requests } = plugin();
  const group = source.category.parts[0];
  const theme = group.categoryParams[group.categories.indexOf("爱情")];
  assert.equal(theme, "5", "detail tag IDs belong to a different namespace");
  const result = await source.categoryComics.load(
    "爱情",
    theme,
    ["2", "3263", "2"],
    2,
  );
  const params = requests[0].url.searchParams;
  for (const [key, expected] of Object.entries({
    theme: "5",
    sortType: "0",
    status: "2",
    audience: "3263",
    cate: "2",
    page: "2",
    size: "20",
  }))
    assert.equal(params.get(key), expected);
  assert.equal(
    result.maxPage,
    Math.ceil(fixture("catalog").data.totalNum / 20),
  );
  assert.equal(result.comics.length, 20);
});

test("all six usable rankings map to category and duration with real pagination", async () => {
  const { source, requests } = plugin();
  const ranking = source.categoryComics.ranking;
  assert.equal(ranking.options.length, 6);
  const result = await ranking.load("2:3", 2);
  assert.equal(requests[0].url.searchParams.get("cate"), "2");
  assert.equal(requests[0].url.searchParams.get("duration"), "3");
  assert.equal(requests[0].url.searchParams.get("page"), "2");
  assert.equal(result.comics[0].id, "80758");
  assert.equal(result.maxPage, 5);
  await assert.rejects(ranking.load("0:0", 1), /无效的排行/);
});

test("home, updates and recommendations preserve the public site lists", async () => {
  const { source, requests } = plugin();
  const sections = await source.explore[0].load();
  const home = fixture("home").data.data;
  assert.equal(sections.精品力荐.length, home.recList.length);
  assert.equal(sections.最新更新.length, home.updateList.length);
  assert.equal(sections.本周排行[0].id, String(home.weekRankList[0].comic_id));
  const banners = await source.dailyRecommendation.load();
  assert.equal(banners.length, home.bannerList.length);
  assert.equal(banners[0].id, String(home.bannerList[0].obj_id));
  assert.equal(banners[0].imageUrl, home.bannerList[0].cover);
  assert.equal(
    banners[0].cover,
    undefined,
    "promotional art is not a comic cover",
  );
  const updates = await source.explore[1].load(2);
  assert.equal(
    updates.maxPage,
    Math.ceil(fixture("update").data.totalNum / 20),
  );
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  assert.equal(requests.at(-1).url.searchParams.has("sortType"), false);
  assert.equal(requests.at(-1).url.searchParams.has("firstLetter"), false);
  const ranks = await source.explore[2].load(1);
  assert.equal(ranks.maxPage, 5);
});

test("details expose authors in infoFields and keep chapter reading order by group", async () => {
  const { source } = plugin();
  const info = await source.comic.loadInfo("80825");
  assert.equal(info.title, "恐怕她是冲着我哥来的");
  assert.equal(info.subTitle, undefined);
  assert.deepEqual(plain(info.infoFields[0]), {
    label: "作者",
    values: ["伊瀬まるの"],
    action: "search",
  });
  assert.deepEqual(plain(info.tags.题材), ["爱情", "校园"]);
  const chapters = [...info.chapters];
  assert.deepEqual(plain(chapters[0]), ["170150", "连载 · 第01话"]);
  assert.deepEqual(plain(chapters[1]), ["170152", "连载 · 番外01"]);
  assert.deepEqual(plain(chapters[26]), ["193700", "连载 · 番外13"]);
  assert.deepEqual(plain(chapters.at(-1)), ["174853", "其它汉化版 · 番外3"]);
  assert.equal(chapters.length, 29);
  assert.deepEqual(
    plain(
      info.chapterGroups.map((group) => ({
        title: group.title,
        count: group.chapters.length,
      })),
    ),
    [
      { title: "连载", count: 27 },
      { title: "其它汉化版", count: 2 },
    ],
  );
  assert.deepEqual(plain(info.chapterGroups[0].chapters[0]), {
    id: "170150",
    title: "第01话",
  });
  assert.deepEqual(plain(info.chapterGroups[1].chapters[0]), {
    id: "174852",
    title: "04话",
  });
  assert.equal(info.recommend[0].id, "61023");
  assert.equal(info.headerStats[0].text, "连载中");
  assert.match(info.description, /远野阳太/);
});

test("unavailable recommendations do not prevent reading the comic", async () => {
  const { source, logs } = plugin((url) =>
    url.includes("same_list")
      ? { status: 503, body: "unavailable" }
      : undefined,
  );
  const info = await source.comic.loadInfo("80825");
  assert.equal(info.chapters.size, 29);
  assert.equal(info.recommend.length, 0);
  assert.equal(logs.length, 1);
});

test("reader preserves image order, encoded slashes and the image Referer", async () => {
  const { source, requests } = plugin();
  for (const [chapterId, name] of [
    ["170150", "chapter"],
    ["193700", "chapter2"],
  ]) {
    const chapter = await source.comic.loadEp("80825", chapterId);
    assert.deepEqual(
      plain(chapter.images),
      fixture(name).data.chapterInfo.page_url,
    );
    assert.match(chapter.images[0], /k%2F/);
    const image = await source.comic.onImageLoad(
      chapter.images[0],
      "80825",
      chapterId,
    );
    assert.equal(image.url, chapter.images[0]);
    assert.equal(image.headers.Referer, "https://manhua.zaimanhua.com/");
  }
  assert.equal(requests[1].url.searchParams.get("chapter_id"), "193700");
});

test("invalid IDs fail before a network request", async () => {
  const { source, requests } = plugin();
  for (const id of ["", "0", "-1", "1&uid=2", "https://example.com/"]) {
    await assert.rejects(source.comic.loadInfo(id), /无效/);
    await assert.rejects(source.comic.loadEp("80825", id), /无效/);
  }
  assert.equal(requests.length, 0);
});

test("HTTP, API and malformed response errors are visible", async () => {
  for (const [response, message] of [
    [{ status: 429, body: "slow down" }, /HTTP 429/],
    [{ status: 200, body: "<html>maintenance</html>" }, /有效 JSON/],
    [{ status: 200, body: '{"errno":1,"errmsg":"请先登录"}' }, /请先登录/],
    [{ status: 200, body: "null" }, /接口返回异常/],
    [{ status: 200, body: '{"errno":0}' }, /缺少数据/],
    [{ status: 200, body: '{"errno":0,"data":{"list":null}}' }, /列表格式异常/],
  ]) {
    const { source } = plugin(() => response);
    await assert.rejects(source.search.load("猫", [], 1), message);
  }
});

test("reader rejects wrong IDs, unavailable chapters and invalid image URLs", async () => {
  for (const [changes, message] of [
    [{ comic_id: 1 }, /不匹配/],
    [{ chapter_id: 1 }, /不匹配/],
    [{ page_url: [] }, /暂无可用图片/],
    [{ page_url: null }, /暂无可用图片/],
    [{ page_url: ["javascript:alert(1)"] }, /图片地址异常/],
    [{ page_url: ["https://images.zaimanhua.com/01.jpg", ""] }, /图片地址异常/],
  ]) {
    const data = fixture("chapter");
    Object.assign(data.data.chapterInfo, changes);
    const { source } = plugin(() => ({
      status: 200,
      body: JSON.stringify(data),
    }));
    await assert.rejects(source.comic.loadEp("80825", "170150"), message);
  }
});

test("protocol relative images become HTTPS without decoding the path", async () => {
  const data = fixture("chapter");
  data.data.chapterInfo.page_url = [
    "//images.zaimanhua.com/a%2Fb.jpg",
    "http://images.zaimanhua.com/b.jpg",
  ];
  const { source } = plugin(() => ({
    status: 200,
    body: JSON.stringify(data),
  }));
  assert.deepEqual(
    plain((await source.comic.loadEp("80825", "170150")).images),
    [
      "https://images.zaimanhua.com/a%2Fb.jpg",
      "https://images.zaimanhua.com/b.jpg",
    ],
  );
});

test("missing chapter order falls back to reversed API order and removes duplicate IDs", async () => {
  const data = fixture("detail");
  data.data.comicInfo.chapterList = [
    {
      title: "连载",
      data: [
        { chapter_id: 10, chapter_title: "第二话" },
        { chapter_id: 20, chapter_title: "第一话" },
        { chapter_id: 20, chapter_title: "第一话" },
      ],
    },
  ];
  const { source } = plugin((url) =>
    url.includes("comic/detail")
      ? { status: 200, body: JSON.stringify(data) }
      : undefined,
  );
  assert.deepEqual(
    plain([...(await source.comic.loadInfo("80825")).chapters]),
    [
      ["20", "第一话"],
      ["10", "第二话"],
    ],
  );
});

const clickedPoints = [
  { x: 17, y: 98 },
  { x: 91, y: 20 },
  { x: 44, y: 60 },
];
function loginContext(method, overrides = {}) {
  return {
    method,
    requestClickCaptcha: async () => ({
      status: "submitted",
      points: clickedPoints,
    }),
    requestText: async () => "123456",
    requestBrowserAuthorization: async () => ({
      status: "completed",
      url: "https://i.zaimanhua.com/login?token=test-session",
    }),
    ...overrides,
  };
}

test("password login submits the user's ordered captcha points and verifies the session", async () => {
  const { source, requests, secrets, storage } = plugin();
  const profile = await source.account.login(
    " user ",
    "test-password",
    loginContext("password"),
  );
  assert.equal(profile.displayName, "测试账号");
  assert.equal(
    profile.avatarUrl,
    "https://images.zaimanhua.com/test-avatar.jpg",
  );
  assert.equal(secrets.get("session"), "test-session");
  assert.equal(storage.get("uid"), "42");
  const login = requests.find((request) =>
    request.url.pathname.endsWith("/login/passwd"),
  );
  assert.equal(login.method, "POST");
  assert.equal(login.headers["X-Client-ID"], "test-client");
  assert.equal(login.headers.Authorization, undefined);
  assert.equal(login.url.searchParams.get("username"), "user");
  assert.equal(
    login.url.searchParams.get("passwd"),
    crypto.createHash("md5").update("test-password").digest("hex"),
  );
  assert.deepEqual(
    JSON.parse(login.url.searchParams.get("captchaResult")),
    clickedPoints,
  );
  assert.equal(login.url.searchParams.get("captchaCate"), "2");
  const verification = requests.at(-1);
  assert.equal(
    verification.url.href,
    "https://account-api.zaimanhua.com/v1/userInfo/get",
  );
  assert.equal(verification.headers.Authorization, "Bearer test-session");
  const request = await source.search.load("猫", [], 1);
  assert.equal(request.comics.length, 20);
  assert.equal(requests.at(-1).headers.Authorization, "Bearer test-session");
  assert.equal(requests.at(-1).url.searchParams.get("uid"), "42");
});

test("captcha refresh and rejection fetch new images without collecting credentials again", async () => {
  let submissions = 0;
  let displayed = 0;
  const { source, requests } = plugin((url) => {
    if (url.includes("/login/passwd") && submissions++ === 0)
      return { status: 200, body: '{"errno":102,"errmsg":"验证码错误"}' };
  });
  await source.account.login(
    "user",
    "password",
    loginContext("password", {
      requestClickCaptcha: async (options) => {
        assert.equal(options.pointCount, 3);
        assert.match(options.image, /^data:image/);
        if (displayed++ === 0) return { status: "refresh" };
        return { status: "submitted", points: clickedPoints };
      },
    }),
  );
  assert.equal(displayed, 3);
  assert.equal(submissions, 2);
  assert.equal(
    requests.filter((r) => r.url.pathname.endsWith("/captcha/click/create"))
      .length,
    3,
  );
});

test("SMS login sends only after captcha and waits for a code before authentication", async () => {
  const { source, requests, secrets } = plugin();
  await source.account.login(
    "13800000000",
    "",
    loginContext("sms", {
      requestText: async (options) => {
        assert.equal(options.keyboardType, "number");
        assert.equal(requests.at(-1).url.pathname, "/lpi/v1/sms/send");
        return " 123456 ";
      },
    }),
  );
  const sms = requests.find((r) => r.url.pathname.endsWith("/sms/send"));
  assert.equal(sms.method, "GET");
  assert.equal(sms.url.searchParams.get("type"), "3");
  assert.deepEqual(
    JSON.parse(sms.url.searchParams.get("digits")),
    clickedPoints,
  );
  const login = requests.find((r) => r.url.pathname.endsWith("/login/sms"));
  assert.equal(login.method, "POST");
  assert.equal(login.url.searchParams.get("phone"), "13800000000");
  assert.equal(login.url.searchParams.get("sms_code"), "123456");
  assert.equal(secrets.get("session"), "test-session");
});

test("all browser methods use exact callbacks and verify the returned site token", async () => {
  for (const provider of ["wechat", "qq", "weibo"]) {
    const { source, requests, secrets, logs } = plugin();
    await source.account.login(
      "",
      "",
      loginContext(provider, {
        requestBrowserAuthorization: async (options) => {
          const authorization = new URL(options.url);
          assert.equal(
            authorization.searchParams.get("state"),
            "test-provider-state",
          );
          assert.equal(
            authorization.searchParams.get("redirect_uri"),
            `https://account-api.zaimanhua.com/v1/${provider}/web/auth_back`,
          );
          assert.deepEqual(plain(options.callbacks), [
            {
              origin: "https://i.zaimanhua.com",
              path: "/login",
              requiredQueryKeys: ["token"],
            },
          ]);
          return {
            status: "completed",
            url: "https://i.zaimanhua.com/login?token=test-session",
          };
        },
      }),
    );
    assert.equal(
      requests[1].url.searchParams.get("backUrl"),
      "https://i.zaimanhua.com/login",
    );
    assert.equal(requests[1].url.pathname, `/lpi/v1/${provider}/web/auth_url`);
    assert.equal(requests.at(-1).url.host, "account-api.zaimanhua.com");
    assert.equal(secrets.get("session"), "test-session");
    assert.equal(logs.length, 0);
  }
});

test("browser cancellation, timeout and invalid callbacks never replace an existing session", async () => {
  for (const outcome of [
    { status: "timeout" },
    {
      status: "completed",
      url: "https://i.zaimanhua.com.evil.test/login?token=bad",
    },
    {
      status: "completed",
      url: "https://i.zaimanhua.com/login/extra?token=bad",
    },
    {
      status: "completed",
      url: "https://i.zaimanhua.com/login?token=a&token=b",
    },
    { status: "completed", url: "https://i.zaimanhua.com/login?token=%ZZ" },
    { status: "completed", url: "https://i.zaimanhua.com/login?token=" },
    new Error("cancelled"),
  ]) {
    const { source, secrets, requests, logs } = plugin(undefined, {
      secrets: { session: "old-session" },
    });
    await assert.rejects(
      source.account.login(
        "",
        "",
        loginContext("wechat", {
          requestBrowserAuthorization: async () => {
            if (outcome instanceof Error) throw outcome;
            return outcome;
          },
        }),
      ),
    );
    assert.equal(secrets.get("session"), "old-session");
    assert.equal(
      requests.some((r) => r.url.pathname === "/v1/userInfo/get"),
      false,
    );
    assert.equal(logs.length, 0);
  }
});

test("failed account verification does not save a token", async () => {
  for (const data of [
    { errno: 99, errmsg: "请先登录", data: {} },
    { errno: 0, data: { userInfo: { nickname: "Invalid" } } },
  ]) {
    const { source, secrets } = plugin((url) =>
      url.includes("/v1/userInfo/get")
        ? { status: 200, body: JSON.stringify(data) }
        : undefined,
    );
    await assert.rejects(
      source.account.login("user", "password", loginContext("password")),
    );
    assert.equal(secrets.has("session"), false);
  }
});

test("captcha and SMS cancellations propagate without submitting login or saving tokens", async () => {
  for (const method of ["password", "sms"]) {
    const { source, requests, secrets } = plugin();
    const cancelled = new Error("cancelled");
    await assert.rejects(
      source.account.login(
        method === "sms" ? "13800000000" : "user",
        "password",
        loginContext(method, {
          requestClickCaptcha: async () => {
            throw cancelled;
          },
        }),
      ),
      (error) => error === cancelled,
    );
    assert.equal(
      requests.some((r) => /\/login\/|\/sms\/send/.test(r.url.pathname)),
      false,
    );
    assert.equal(secrets.size, 0);
  }
  const { source, requests, secrets } = plugin();
  await assert.rejects(
    source.account.login(
      "13800000000",
      "",
      loginContext("sms", {
        requestText: async () => {
          throw new Error("cancelled");
        },
      }),
    ),
    /cancelled/,
  );
  assert.equal(
    requests.some((r) => r.url.pathname.endsWith("/login/sms")),
    false,
  );
  assert.equal(secrets.size, 0);
});

test("wrong credentials stop retrying and network failures do not expose login URLs", async () => {
  const { source, requests } = plugin((url) =>
    url.includes("/login/passwd")
      ? { status: 200, body: '{"errno":2,"errmsg":"账号或密码错误"}' }
      : undefined,
  );
  await assert.rejects(
    source.account.login("user", "password", loginContext("password")),
    /账号或密码错误/,
  );
  assert.equal(
    requests.filter((r) => r.url.pathname.endsWith("/login/passwd")).length,
    1,
  );
  const failing = plugin((url) => {
    if (url.includes("/login/passwd"))
      throw new Error("request failed: " + url);
  });
  await assert.rejects(
    failing.source.account.login(
      "private-user",
      "private-password",
      loginContext("password"),
    ),
    (error) => error.message === "再漫画：网络请求失败，请检查连接后重试",
  );
});

test("new login methods require foreground context and valid initial inputs", async () => {
  const { source, requests } = plugin();
  await assert.rejects(
    source.account.login("user", "password"),
    (error) => error.code === "INTERACTION_REQUIRED",
  );
  await assert.rejects(
    source.account.login("", "password", loginContext("password")),
    /账号和密码/,
  );
  await assert.rejects(
    source.account.login("invalid phone", "", loginContext("sms")),
    /手机号/,
  );
  await assert.rejects(
    source.account.login("", "", loginContext("unknown")),
    /未知登录/,
  );
  assert.equal(requests.length, 0);
});

test("profile reload and logout use the persistent session and remove plugin cookies", async () => {
  const { source, secrets, storage, requests, cookieDeletes } = plugin(
    undefined,
    {
      secrets: { session: "test-session" },
      storage: { uid: "42" },
    },
  );
  const profile = await source.account.loadProfile();
  assert.equal(profile.displayName, "测试账号");
  assert.equal(requests[0].headers.Authorization, "Bearer test-session");
  await source.account.logout();
  assert.equal(secrets.has("session"), false);
  assert.equal(storage.has("uid"), false);
  assert.deepEqual(cookieDeletes, [
    "https://manhua.zaimanhua.com",
    "https://account-api.zaimanhua.com",
  ]);
  await assert.rejects(
    source.account.loadProfile(),
    (error) => error.code === "AUTH_EXPIRED",
  );
});

test("reading progress posts the actual one-based image page and requires a session", async () => {
  const progress = {
    comicId: "80825",
    chapterId: "170150",
    page: 3,
    totalPages: 27,
    visiblePages: [3, 4],
    reason: "page",
  };
  const { source, requests } = plugin(undefined, {
    secrets: { session: "test-session" },
    storage: { uid: "42" },
  });
  await source.comic.onReadingProgress(progress);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url.pathname, "/app/v1/readingRecord/add");
  assert.equal(requests[0].headers.Authorization, "Bearer test-session");
  assert.equal(requests[0].url.searchParams.get("source"), "mh");
  assert.deepEqual(JSON.parse(requests[0].url.searchParams.get("json")), [
    { bizId: 80825, chapterId: 170150, page: 3 },
  ]);
  for (const page of [0, -1, 28, 1.5])
    await assert.rejects(
      source.comic.onReadingProgress({ ...progress, page }),
      /进度数据异常/,
    );
  const anonymous = plugin();
  await anonymous.source.comic.onReadingProgress(progress);
  assert.equal(anonymous.requests.length, 0);
});

test("expired authenticated requests report AUTH_EXPIRED without logging secrets", async () => {
  const { source, logs } = plugin(
    () => ({ status: 200, body: '{"errno":99,"errmsg":"请先登录"}' }),
    { secrets: { session: "private-session" } },
  );
  await assert.rejects(
    source.search.load("猫", [], 1),
    (error) => error.code === "AUTH_EXPIRED",
  );
  assert.equal(logs.length, 0);
});

test("cloud subscription pages use authenticated requests and the site's total", async () => {
  const { source, requests } = plugin(undefined, {
    secrets: { session: "test-session" },
    storage: { uid: "42" },
  });
  const first = await source.favorites.loadComics(1, null);
  const second = await source.favorites.loadComics(2, "0");
  assert.equal(first.comics.length, 20);
  assert.equal(first.maxPage, 3);
  assert.equal(second.maxPage, 3);
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.method, "GET");
    assert.equal(request.url.pathname, "/app/v1/comic/sub/list");
    assert.equal(request.headers.Authorization, "Bearer test-session");
    assert.equal(request.url.searchParams.get("uid"), "42");
    assert.equal(request.url.searchParams.get("status"), "");
    assert.equal(request.url.searchParams.get("firstLetter"), "");
    assert.equal(request.url.searchParams.get("page"), String(index + 1));
    assert.equal(request.url.searchParams.get("size"), "20");
  }
});

test("the single subscription folder reports membership without scanning the library", async () => {
  let isSub = false;
  const { source, requests } = plugin(
    (url) =>
      url.includes("/checkIsSub")
        ? { status: 200, body: JSON.stringify({ errno: 0, data: { isSub } }) }
        : undefined,
    { secrets: { session: "test-session" } },
  );
  assert.equal(source.favorites.singleFolderForSingleComic, true);
  assert.deepEqual(plain(await source.favorites.loadFolders(null)), {
    folders: { 0: "我的订阅" },
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(plain(await source.favorites.loadFolders("80825")), {
    folders: { 0: "我的订阅" },
    favorited: [],
  });
  isSub = true;
  assert.deepEqual(plain(await source.favorites.loadFolders("80825")), {
    folders: { 0: "我的订阅" },
    favorited: ["0"],
  });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url.pathname, "/app/v1/comic/sub/checkIsSub");
    assert.equal(request.url.searchParams.get("objId"), "80825");
    assert.equal(request.url.searchParams.get("source"), "1");
  }
});

test("adding and removing subscriptions changes only the requested comic", async () => {
  let subscribed = false;
  const { source, requests } = plugin(
    (url) => {
      const route = new URL(url);
      if (route.pathname.endsWith("/sub/add")) subscribed = true;
      if (route.pathname.endsWith("/sub/del")) subscribed = false;
      if (route.pathname.endsWith("/checkIsSub"))
        return {
          status: 200,
          body: JSON.stringify({ errno: 0, data: { isSub: subscribed } }),
        };
    },
    { secrets: { session: "test-session" } },
  );
  await source.favorites.addOrDelFavorite("80825", "0", true);
  assert.deepEqual(
    plain((await source.favorites.loadFolders("80825")).favorited),
    ["0"],
  );
  await source.favorites.addOrDelFavorite("80825", "0", false);
  assert.deepEqual(
    plain((await source.favorites.loadFolders("80825")).favorited),
    [],
  );
  const mutations = requests.filter((r) =>
    /\/sub\/(add|del)$/.test(r.url.pathname),
  );
  assert.deepEqual(
    mutations.map((r) => r.url.pathname),
    ["/app/v1/comic/sub/add", "/app/v1/comic/sub/del"],
  );
  for (const request of mutations) {
    assert.equal(request.method, "GET");
    assert.equal(request.url.searchParams.get("comic_id"), "80825");
    assert.equal(request.url.searchParams.has("folder_id"), false);
    assert.equal(request.headers.Authorization, "Bearer test-session");
  }
});

test("cloud favorites require login and validate IDs/folders before a request", async () => {
  const anonymous = plugin();
  for (const call of [
    () => anonymous.source.favorites.loadFolders(null),
    () => anonymous.source.favorites.loadComics(1, "0"),
    () => anonymous.source.favorites.addOrDelFavorite("80825", "0", true),
  ])
    await assert.rejects(
      call(),
      (error) => error.code === "AUTH_EXPIRED" && /先登录/.test(error.message),
    );
  assert.equal(anonymous.requests.length, 0);
  const { source, requests } = plugin(undefined, {
    secrets: { session: "test-session" },
  });
  await assert.rejects(
    source.favorites.loadComics(1, "unknown"),
    /未知的云端收藏夹/,
  );
  await assert.rejects(
    source.favorites.addOrDelFavorite("80825", "unknown", false),
    /未知的云端收藏夹/,
  );
  await assert.rejects(
    source.favorites.addOrDelFavorite("1&comic_id=2", "0", true),
    /无效/,
  );
  await assert.rejects(source.favorites.loadFolders("-1"), /无效/);
  assert.equal(requests.length, 0);
});

test("empty and out-of-range cloud pages terminate pagination", async () => {
  for (const [page, total, maxPage] of [
    [1, 0, 1],
    [4, 41, 3],
  ]) {
    const { source } = plugin(
      () => ({
        status: 200,
        body: JSON.stringify({ errno: 0, data: { subList: null, total } }),
      }),
      { secrets: { session: "test-session" } },
    );
    assert.deepEqual(plain(await source.favorites.loadComics(page, "0")), {
      comics: [],
      maxPage,
    });
  }
});

test("cloud errors and invalid membership responses are not treated as success", async () => {
  const { source } = plugin(
    () => ({ status: 200, body: '{"errno":99,"errmsg":"请先登录"}' }),
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    source.favorites.loadComics(1, "0"),
    (error) => error.code === "AUTH_EXPIRED",
  );
  await assert.rejects(
    source.favorites.loadFolders("80825"),
    (error) => error.code === "AUTH_EXPIRED",
  );
  await assert.rejects(
    source.favorites.addOrDelFavorite("80825", "0", true),
    (error) => error.code === "AUTH_EXPIRED",
  );
  const rejected = plugin(
    () => ({ status: 200, body: '{"errno":1,"errmsg":"订阅操作失败"}' }),
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    rejected.source.favorites.addOrDelFavorite("80825", "0", false),
    /订阅操作失败/,
  );
  const malformed = plugin(
    () => ({ status: 200, body: '{"errno":0,"data":{}}' }),
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    malformed.source.favorites.loadFolders("80825"),
    /订阅状态格式异常/,
  );
  await assert.rejects(
    malformed.source.favorites.loadComics(1, "0"),
    /列表格式异常/,
  );
});

test("logged-in details reflect subscription state without blocking public reading on failure", async () => {
  const { source } = plugin(
    (url) =>
      url.includes("/checkIsSub")
        ? { status: 200, body: '{"errno":0,"data":{"isSub":true}}' }
        : undefined,
    { secrets: { session: "test-session" } },
  );
  assert.equal((await source.comic.loadInfo("80825")).isFavorite, true);
  const failed = plugin(
    (url) =>
      url.includes("/checkIsSub")
        ? { status: 503, body: "maintenance" }
        : undefined,
    { secrets: { session: "test-session" } },
  );
  const detail = await failed.source.comic.loadInfo("80825");
  assert.equal(detail.isFavorite, undefined);
  assert.equal(detail.chapters.size, 29);
  assert.equal(failed.logs.length, 1);
});

// Constructed account records using the public detail response and the account
// center's history renderer field names. No real account history is captured.
function readingRecord(changes = {}) {
  return {
    biz_id: 80825,
    chapter_id: 170150,
    record: 3,
    viewing_time: 1790607951,
    total_num: 999,
    title: "测试漫画",
    cover: "//images.zaimanhua.com/test-cover.jpg",
    chapter_name: "第01话",
    ...changes,
  };
}

function readingDetail(record) {
  const response = fixture("detail");
  response.data.readingRecord = record;
  return { status: 200, body: JSON.stringify(response) };
}

test("website progress loads the exact comic and preserves original image page numbers", async () => {
  const { source, requests, writes } = plugin(
    () =>
      readingDetail(
        readingRecord({
          chapter_id: "170152",
          record: "7",
          viewing_time: "1790607951",
        }),
      ),
    { secrets: { session: "test-session" } },
  );
  const progress = await source.comic.loadReadingProgress("80825");
  assert.deepEqual(plain(progress), {
    chapterId: "170152",
    page: 7,
    updatedAtMs: 1790607951000,
  });
  assert.equal(
    progress.totalPages,
    undefined,
    "unverified total_num must not clamp a position",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url.pathname, "/api/v1/comic2/comic/detail");
  assert.equal(requests[0].url.searchParams.get("id"), "80825");
  assert.equal(requests[0].headers.Authorization, "Bearer test-session");
  assert.deepEqual(
    writes,
    [],
    "a cloud-read runtime must not write persistent state",
  );
});

test("website progress re-reads the server on every call and does not use old local positions", async () => {
  let current = readingRecord({ record: 7 });
  const { source, requests, writes } = plugin(() => readingDetail(current), {
    secrets: { session: "test-session" },
    storage: { readingProgress: { chapterId: "999", page: 99 } },
  });
  assert.equal((await source.comic.loadReadingProgress("80825")).page, 7);
  current = readingRecord({ chapter_id: 170152, record: 2 });
  assert.deepEqual(plain(await source.comic.loadReadingProgress("80825")), {
    chapterId: "170152",
    page: 2,
    updatedAtMs: 1790607951000,
  });
  current = { biz_id: 0, chapter_id: 0, record: 0, viewing_time: 0 };
  assert.equal(await source.comic.loadReadingProgress("80825"), null);
  assert.equal(requests.length, 3);
  assert.deepEqual(writes, []);
});

test("only an explicit missing website record returns null", async () => {
  for (const record of [
    null,
    { biz_id: 0, chapter_id: 0, record: 0 },
    { biz_id: 80825, chapter_id: "0", record: "0" },
  ]) {
    const { source } = plugin(() => readingDetail(record), {
      secrets: { session: "test-session" },
    });
    assert.equal(await source.comic.loadReadingProgress("80825"), null);
  }
  for (const record of [
    undefined,
    {},
    [],
    "invalid",
    readingRecord({ biz_id: 1 }),
    readingRecord({ chapter_id: 0 }),
    readingRecord({ chapter_id: "bad" }),
    readingRecord({ record: 0 }),
    readingRecord({ record: 1.5 }),
    readingRecord({ record: "9007199254740992" }),
  ]) {
    const { source } = plugin(() => readingDetail(record), {
      secrets: { session: "test-session" },
    });
    await assert.rejects(source.comic.loadReadingProgress("80825"), /阅读进度/);
  }
  const response = fixture("detail");
  response.data.comicInfo.id = 1;
  const mismatched = plugin(
    () => ({ status: 200, body: JSON.stringify(response) }),
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    mismatched.source.comic.loadReadingProgress("80825"),
    /阅读进度/,
  );
});

test("cloud history uses pageSize and continues past short pages until the server is empty", async () => {
  const { source, requests, writes } = plugin(
    (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        status: 200,
        body: JSON.stringify({
          errno: 0,
          data: {
            recordList:
              page === 1
                ? [readingRecord()]
                : page === 2
                  ? [
                      readingRecord({
                        biz_id: 63911,
                        title: "另一部漫画",
                        chapter_id: 23,
                        record: 8,
                      }),
                    ]
                  : null,
          },
        }),
      };
    },
    { secrets: { session: "test-session" } },
  );
  const imported = [];
  for (let page = 1; ; page++) {
    const result = await source.comic.loadReadingHistory(page);
    assert.equal(result.maxPage, undefined);
    if (!result.items.length) break;
    imported.push(...result.items);
  }
  assert.deepEqual(plain(imported[0]), {
    comic: {
      id: "80825",
      title: "测试漫画",
      cover: "https://images.zaimanhua.com/test-cover.jpg",
      subTitle: "第01话",
    },
    progress: { chapterId: "170150", page: 3, updatedAtMs: 1790607951000 },
  });
  assert.equal(imported[1].comic.id, "63911");
  assert.equal(imported[1].progress.page, 8);
  assert.equal(requests.length, 3);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.method, "GET");
    assert.equal(request.url.pathname, "/app/v1/readingRecord/list");
    assert.equal(request.url.searchParams.get("source"), "mh");
    assert.equal(request.url.searchParams.get("page"), String(index + 1));
    assert.equal(request.url.searchParams.get("pageSize"), "20");
    assert.equal(request.url.searchParams.has("size"), false);
    assert.equal(request.headers.Authorization, "Bearer test-session");
  }
  assert.deepEqual(writes, []);
});

test("history accepts an empty list but rejects broken pages instead of silently truncating import", async () => {
  for (const recordList of [[], null]) {
    const { source } = plugin(
      () => ({
        status: 200,
        body: JSON.stringify({ errno: 0, data: { recordList } }),
      }),
      { secrets: { session: "test-session" } },
    );
    assert.deepEqual(plain(await source.comic.loadReadingHistory(1)), {
      items: [],
    });
  }
  for (const recordList of [
    undefined,
    {},
    [null],
    ["invalid"],
    [readingRecord({ title: "" })],
    [readingRecord({ biz_id: 0 })],
    [readingRecord({ chapter_id: 0, record: 0 })],
    [readingRecord({ record: -1 })],
  ]) {
    const { source } = plugin(
      () => ({
        status: 200,
        body: JSON.stringify({ errno: 0, data: { recordList } }),
      }),
      { secrets: { session: "test-session" } },
    );
    await assert.rejects(source.comic.loadReadingHistory(1));
  }
});

test("cloud progress and history require login and propagate network/authentication failures", async () => {
  const anonymous = plugin();
  await assert.rejects(
    anonymous.source.comic.loadReadingProgress("80825"),
    (error) => error.code === "AUTH_EXPIRED",
  );
  await assert.rejects(
    anonymous.source.comic.loadReadingHistory(1),
    (error) => error.code === "AUTH_EXPIRED",
  );
  assert.equal(anonymous.requests.length, 0);
  for (const response of [
    { status: 200, body: '{"errno":99,"errmsg":"请先登录"}' },
    { status: 503, body: "maintenance" },
    { status: 200, body: "<html>blocked</html>" },
  ]) {
    const { source, writes } = plugin(() => response, {
      secrets: { session: "test-session" },
    });
    await assert.rejects(source.comic.loadReadingProgress("80825"));
    await assert.rejects(source.comic.loadReadingHistory(1));
    assert.deepEqual(writes, []);
  }
});

test("account changes and logout cannot reuse another account's cloud position", async () => {
  const { source, secrets, requests } = plugin(
    (_url, headers) =>
      readingDetail(
        readingRecord({
          record: headers.Authorization === "Bearer first-session" ? 3 : 9,
        }),
      ),
    { secrets: { session: "first-session" } },
  );
  assert.equal((await source.comic.loadReadingProgress("80825")).page, 3);
  secrets.set("session", "second-session");
  assert.equal((await source.comic.loadReadingProgress("80825")).page, 9);
  secrets.delete("session");
  await assert.rejects(
    source.comic.loadReadingProgress("80825"),
    (error) => error.code === "AUTH_EXPIRED",
  );
  assert.equal(requests.length, 2);
});
