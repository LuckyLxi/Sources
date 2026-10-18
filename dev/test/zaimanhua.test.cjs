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
  if (route.pathname === "/lpi/v1/sms/send") return ok({});
  if (route.pathname === "/lpi/v1/task/list")
    return ok({ task: { signInfo: { currentSign: true } } });
  if (route.pathname === "/app/v1/comment/list") {
    const name =
      route.searchParams.get("objId") === "999999999"
        ? "comments-empty"
        : route.searchParams.get("sortBy") === "2"
          ? route.searchParams.get("page") === "2"
            ? "comments-hot2"
            : "comments-hot"
          : route.searchParams.get("page") === "2"
            ? "comments2"
            : "comments";
    return { status: 200, body: JSON.stringify(fixture(name)) };
  }
  if (
    ["/app/v1/comment/create", "/app/v1/comment/addLike"].includes(
      route.pathname,
    )
  )
    return ok(null);
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
  if (
    route.pathname === "/api/v1/comic2/comic/detail" &&
    route.searchParams.get("id") !== "80825"
  ) {
    const info = fixture("banner-comics")[route.searchParams.get("id")];
    if (info) return ok({ comicInfo: info });
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
  assert.equal(entry.version, "1.4.2");
  assert.equal(source.apiVersion, 1);
  assert.equal(source.comic.onReadingProgress, undefined);
  assert.equal(source.comic.loadReadingProgress, undefined);
  assert.equal(source.comic.loadReadingHistory, undefined);
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
  assert.equal(source.presentation.showComments, true);
  assert.deepEqual(plain(source.presentation.commentOrders), {
    1: "最新",
    2: "热门",
  });
  assert.equal(source.presentation.commentDefaultOrder, "1");
  assert.equal(source.presentation.dailyCheckIn, true);
  for (const [id, location] of [
    ["checkIn", "homeProfile"],
    ["autoCheckIn", "other"],
  ])
    assert.ok(
      source.presentation.buttons.some(
        (button) => button.id === id && button.location === location,
      ),
    );
  assert.equal(typeof source.account.checkInStatus, "function");
  assert.equal(typeof source.account.checkIn, "function");
  assert.notEqual(source.presentation.commentReplies, true);
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

// Constructed task data using the website's observed boolean currentSign field.
const taskResponse = (currentSign) => ({
  status: 200,
  body: JSON.stringify({
    errno: 0,
    data: { task: { signInfo: { currentSign } } },
  }),
});
const signResponse = (errno = 0, errmsg = "") => ({
  status: 200,
  body: JSON.stringify({ errno, errmsg, data: null }),
});

test("check-in without a session is skipped without any request", async () => {
  const { source, requests } = plugin();
  assert.equal(await source.account.checkInStatus(), null);
  assert.deepEqual(plain(await source.account.checkIn()), {
    status: "skipped",
  });
  assert.equal(requests.length, 0);
});

test("check-in status comes from the website and completed days never post", async () => {
  let signed = false;
  const { source, requests } = plugin(() => taskResponse(signed), {
    secrets: { session: "test-session" },
    storage: { uid: 42, lastCheckInDate: "2026-10-18" },
  });
  assert.equal(await source.account.checkInStatus(), false);
  signed = true;
  assert.equal(await source.account.checkInStatus(), true);
  assert.equal((await source.account.checkIn()).status, "alreadyCheckedIn");
  assert.ok(
    requests.every(
      (request) =>
        request.method === "GET" &&
        request.url.pathname === "/lpi/v1/task/list",
    ),
  );
  signed = false;
  assert.equal(
    await source.account.checkInStatus(),
    false,
    "a new server day must not reuse a cached local day",
  );
});

test("check-in posts once to the public user-center route and verifies completion", async () => {
  let signed = false;
  const { source, requests } = plugin(
    (url) => {
      if (new URL(url).pathname === "/lpi/v1/task/list")
        return taskResponse(signed);
      if (new URL(url).pathname === "/lpi/v1/task/sign_in") {
        signed = true;
        return signResponse();
      }
    },
    { secrets: { session: "test-session" }, storage: { uid: 42 } },
  );
  assert.deepEqual(plain(await source.account.checkIn()), {
    status: "success",
    message: "签到成功",
  });
  assert.deepEqual(
    requests.map((request) => [request.method, request.url.pathname]),
    [
      ["GET", "/lpi/v1/task/list"],
      ["POST", "/lpi/v1/task/sign_in"],
      ["GET", "/lpi/v1/task/list"],
    ],
  );
  for (const request of requests) {
    assert.equal(request.url.origin, "https://i.zaimanhua.com");
    assert.equal(request.url.search, "");
    assert.equal(request.headers.Referer, "https://i.zaimanhua.com/");
    assert.equal(request.headers.Platform, "pc");
    assert.equal(request.headers.Authorization, "Bearer test-session");
    assert.equal(request.body, undefined);
  }
  assert.equal((await source.account.checkIn()).status, "alreadyCheckedIn");
  assert.equal(
    requests.filter((request) => request.method === "POST").length,
    1,
  );
});

test("invalid task status fails before check-in can be submitted", async () => {
  for (const value of [undefined, null, 0, 1, "false", "true", {}]) {
    const { source, requests } = plugin(() => taskResponse(value), {
      secrets: { session: "test-session" },
    });
    await assert.rejects(source.account.checkIn(), /签到状态格式异常/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
  }
});

test("failed check-ins do not report success or retain a pending failed attempt", async () => {
  let attempt = 0;
  let signed = false;
  const { source, requests } = plugin(
    (url) => {
      if (new URL(url).pathname.endsWith("/list")) return taskResponse(signed);
      attempt++;
      if (attempt === 1) return signResponse(5, "签到失败");
      signed = true;
      return signResponse();
    },
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(source.account.checkIn(), /签到失败/);
  assert.equal((await source.account.checkIn()).status, "success");
  assert.equal(
    requests.filter((request) => request.method === "POST").length,
    2,
  );
  const unconfirmed = plugin(
    (url) =>
      new URL(url).pathname.endsWith("/list")
        ? taskResponse(false)
        : signResponse(),
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    unconfirmed.source.account.checkIn(),
    /网站尚未确认签到成功/,
  );
});

test("duplicate check-in responses require server confirmation", async () => {
  for (const confirmed of [true, false]) {
    let posted = false;
    const { source } = plugin(
      (url) => {
        if (new URL(url).pathname.endsWith("/list"))
          return taskResponse(posted && confirmed);
        posted = true;
        return signResponse(5, "今日已经签到，请勿重复签到");
      },
      { secrets: { session: "test-session" } },
    );
    if (confirmed)
      assert.equal((await source.account.checkIn()).status, "alreadyCheckedIn");
    else await assert.rejects(source.account.checkIn(), /今日已经签到/);
  }
});

test("simultaneous manual and automatic check-ins share one server write", async () => {
  let ready;
  let release;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let signed = false;
  const { source, requests } = plugin(
    async (url) => {
      if (new URL(url).pathname.endsWith("/list")) {
        if (!signed) {
          ready();
          await gate;
        }
        return taskResponse(signed);
      }
      signed = true;
      return signResponse();
    },
    { secrets: { session: "test-session" } },
  );
  const first = source.account.checkIn();
  await started;
  const second = source.account.checkIn();
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.status === "success"));
  assert.equal(
    requests.filter((request) => request.method === "POST").length,
    1,
  );
});

test("check-in handles expired sessions and does not post after an account change", async () => {
  for (const failure of [
    { status: 401, body: "" },
    signResponse(99, "请先登录"),
  ]) {
    const { source, requests } = plugin(() => failure, {
      secrets: { session: "test-session" },
    });
    await assert.rejects(
      source.account.checkIn(),
      (error) => error.code === "AUTH_EXPIRED",
    );
    assert.equal(requests.length, 1);
  }
  let state;
  state = plugin(
    () => {
      state.secrets.set("session", "test-other-session");
      return taskResponse(false);
    },
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    state.source.account.checkIn(),
    (error) => error.code === "AUTH_EXPIRED",
  );
  assert.equal(state.requests.length, 1);
});

test("public comments preserve the site's page order and quoted ancestors", async () => {
  const { source, requests } = plugin();
  const raw = fixture("comments").data;
  const result = await source.comic.loadComments("80825", null, 1, null);
  assert.equal(result.comments.length, 16);
  assert.deepEqual(
    Array.from(result.comments, (row) => row.id),
    raw.commentIdList.map((chain) => chain.split(",")[0]),
  );
  const chain = raw.commentIdList
    .find((value) => value.includes(","))
    .split(",");
  const current = raw.commentList[chain[0]];
  const parent = raw.commentList[chain[1]];
  const comment = result.comments.find((row) => row.id === chain[0]);
  assert.equal(
    comment.userName,
    current.author.nickname + " 👉 " + parent.author.nickname,
  );
  assert.ok(comment.content.endsWith(current.content));
  assert.ok(comment.content.includes(parent.content));
  assert.equal(
    comment.time,
    new Date(current.create_time * 1000).toISOString(),
  );
  assert.equal(comment.score, current.stats.like_amount);
  assert.equal(comment.isLiked, current.stats.is_like);
  assert.equal(result.maxPage, 2);
  const request = requests[0];
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, undefined);
  for (const [key, value] of Object.entries({
    objId: "80825",
    type: "4",
    sortBy: "1",
    size: "16",
    page: "1",
    top_status: "0",
    is_goods: "0",
  }))
    assert.equal(request.url.searchParams.get(key), value);
});

test("popular comments use server order and retain that order while paging", async () => {
  const { source, requests } = plugin();
  const newest = await source.comic.loadComments("80825", null, 1, null, "1");
  const popular = await source.comic.loadComments("80825", null, 1, null, "2");
  const more = await source.comic.loadComments("80825", null, 2, null, "2");
  const latestAgain = await source.comic.loadComments(
    "80825",
    null,
    1,
    null,
    "1",
  );
  assert.notEqual(newest.comments[0].id, popular.comments[0].id);
  for (const [result, name] of [
    [popular, "comments-hot"],
    [more, "comments-hot2"],
  ]) {
    assert.equal(result.comments.length, 16);
    assert.deepEqual(
      Array.from(result.comments, (comment) => comment.id),
      fixture(name).data.commentIdList.map((chain) => chain.split(",")[0]),
    );
  }
  assert.equal(more.maxPage, 3);
  assert.deepEqual(plain(latestAgain), plain(newest));
  assert.deepEqual(
    requests.map((request) => [
      request.url.searchParams.get("sortBy"),
      request.url.searchParams.get("page"),
    ]),
    [
      ["1", "1"],
      ["2", "1"],
      ["2", "2"],
      ["1", "1"],
    ],
  );
});

test("empty comment order retains newest compatibility and unknown codes fail before requesting", async () => {
  const { source, requests } = plugin();
  await source.comic.loadComments("80825", null, 1, null, "");
  assert.equal(requests[0].url.searchParams.get("sortBy"), "1");
  await assert.rejects(
    source.comic.loadComments("80825", null, 1, null, "unknown"),
    /未知的评论排序/,
  );
  assert.equal(requests.length, 1);
});

test("comments continue past the server's incorrect zero total on page two", async () => {
  const { source, requests } = plugin();
  const second = await source.comic.loadComments("80825", null, 2, null);
  assert.equal(fixture("comments2").data.total, 0);
  assert.equal(second.comments.length, 16);
  assert.equal(second.maxPage, 3);
  assert.equal(requests[0].url.searchParams.get("page"), "2");
  const empty = await source.comic.loadComments("999999999", null, 1, null);
  assert.deepEqual(plain(empty), { comments: [], maxPage: 1 });
  const end = plugin(() => ({
    status: 200,
    body: JSON.stringify(fixture("comments-empty")),
  }));
  assert.equal(
    (await end.source.comic.loadComments("80825", null, 3, null)).maxPage,
    3,
  );
});

test("comments retain HTML images and escape quoted author names", async () => {
  const raw = fixture("comments");
  const chain = raw.data.commentIdList
    .find((value) => value.includes(","))
    .split(",");
  raw.data.commentIdList = [chain.join(","), chain.join(",")];
  raw.data.commentList[chain[0]].content =
    '<p>你好 &amp; 世界</p><img src="https://images.zaimanhua.com/test.png">';
  raw.data.commentList[chain[0]].stats = {
    like_amount: 3,
    is_like: "1",
    reply_amount: 2,
  };
  raw.data.commentList[chain[1]].author.nickname = "<引用者>&";
  const { source } = plugin(() => ({ status: 200, body: JSON.stringify(raw) }));
  const result = await source.comic.loadComments("80825", null, 1, null);
  assert.equal(result.comments.length, 1);
  assert.ok(result.comments[0].content.includes("&lt;引用者&gt;&amp;"));
  assert.ok(
    result.comments[0].content.endsWith(raw.data.commentList[chain[0]].content),
  );
  assert.equal(result.comments[0].score, 3);
  assert.equal(result.comments[0].isLiked, true);
  assert.equal(result.comments[0].replyCount, 2);
});

test("malformed comment data fails rather than appearing as an empty page", async () => {
  for (const mutate of [
    (data) => {
      delete data.commentIdList;
    },
    (data) => {
      data.commentList = null;
    },
    (data) => {
      data.commentIdList = ["123"];
    },
    (data) => {
      data.commentList[data.commentIdList[0].split(",")[0]].obj_id = 1;
    },
  ]) {
    const raw = fixture("comments");
    mutate(raw.data);
    const { source } = plugin(() => ({
      status: 200,
      body: JSON.stringify(raw),
    }));
    await assert.rejects(
      source.comic.loadComments("80825", null, 1, null),
      /评论/,
    );
  }
  const { source, requests } = plugin();
  await assert.rejects(
    source.comic.loadComments("80825", null, 1, "533819"),
    /独立回复列表/,
  );
  assert.equal(requests.length, 0);
});

test("comment creation and replies use the observed JSON API and exact parent ID", async () => {
  const { source, requests } = plugin(null, {
    secrets: { session: "test-session" },
    storage: { clientId: "test-client", uid: 42 },
  });
  const text = '中文 &?# + "换行"\n<img> 😀';
  await source.comic.sendComment("80825", null, "  " + text + "  ", null);
  await source.comic.sendComment("80825", null, text, "533819");
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.method, "POST");
    assert.equal(request.url.origin, "https://v4api.zaimanhua.com");
    assert.equal(request.url.pathname, "/app/v1/comment/create");
    assert.equal(request.url.search, "");
    assert.equal(request.headers.Authorization, "Bearer test-session");
    assert.equal(request.headers["X-Client-ID"], "test-client");
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(request.body), {
      obj_id: 80825,
      content: text,
      to_comment_id: index ? 533819 : 0,
      type: 4,
      mentions: [],
    });
  }
});

test("comment posting rejects absent login and invalid input before requesting", async () => {
  const { source, requests } = plugin();
  await assert.rejects(
    source.comic.sendComment("80825", null, "hello", null),
    (error) => error.code === "AUTH_EXPIRED",
  );
  for (const [id, text, replyTo] of [
    ["80825", " ", null],
    ["80825", "a".repeat(1001), null],
    ["9007199254740993", "hello", null],
    ["80825", "hello", "no-id"],
  ])
    await assert.rejects(source.comic.sendComment(id, null, text, replyTo));
  assert.equal(requests.length, 0);
});

test("comment posting acquires a missing client ID and propagates rejected writes", async () => {
  const { source, requests, storage } = plugin(
    (url) => {
      if (new URL(url).pathname === "/app/v1/comment/create")
        return {
          status: 200,
          body: JSON.stringify({ errno: 400, errmsg: "发送过于频繁" }),
        };
    },
    { secrets: { session: "test-session" } },
  );
  await assert.rejects(
    source.comic.sendComment("80825", null, "hello", null),
    /发送过于频繁/,
  );
  assert.equal(storage.get("clientId"), "test-client");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests[1].headers["X-Client-ID"], "test-client");
  for (const failure of [
    { status: 401, body: "" },
    { status: 200, body: JSON.stringify({ errno: 99, errmsg: "expired" }) },
  ]) {
    const expired = plugin(() => failure, {
      secrets: { session: "test-session" },
      storage: { clientId: "test-client" },
    });
    await assert.rejects(
      expired.source.comic.sendComment("80825", null, "hello", null),
      (error) => error.code === "AUTH_EXPIRED",
    );
  }
});

test("comment likes use addLike and never invent a cancellation request", async () => {
  const { source, requests } = plugin(null, {
    secrets: { session: "test-session" },
  });
  await source.comic.likeComment("80825", null, "533819", true);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url.pathname, "/app/v1/comment/addLike");
  assert.equal(requests[0].url.searchParams.get("commentId"), "533819");
  assert.equal(requests[0].url.searchParams.get("type"), "4");
  await assert.rejects(
    source.comic.likeComment("80825", null, "533819", false),
    /不支持取消点赞/,
  );
  assert.equal(requests.length, 1);
  const anonymous = plugin();
  await assert.rejects(
    anonymous.source.comic.likeComment("80825", null, "533819", true),
    (error) => error.code === "AUTH_EXPIRED",
  );
  assert.equal(anonymous.requests.length, 0);
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
  const comics = fixture("banner-comics");
  for (const [index, banner] of banners.entries()) {
    const original = home.bannerList[index];
    const id = String(original.obj_id);
    assert.deepEqual(plain(banner), {
      id,
      title: comics[id].title,
      cover: comics[id].cover,
      imageUrl: original.cover,
      bannerTitle: original.title,
      caption: original.sub_title,
    });
  }
  assert.notEqual(banners[0].title, banners[0].bannerTitle);
  assert.notEqual(banners[0].cover, banners[0].imageUrl);
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

test("banners preserve more than seven promotions and fetch each target only once", async () => {
  const home = fixture("home");
  home.data.data.bannerList = Array.from({ length: 10 }, (_, index) => ({
    type: 1,
    obj_id: 80825,
    title: `宣传语 ${index}`,
    sub_title: `说明 ${index}`,
    cover: `https://images.zaimanhua.com/tuijian/test-${index}.jpg`,
  }));
  home.data.data.bannerList.push(
    { type: 2, obj_id: 80825, title: "外部广告" },
    { type: 1, obj_id: "bad-id", title: "无效目标" },
  );
  const { source, requests } = plugin((url) =>
    new URL(url).pathname === "/api/v1/comic2/index"
      ? { status: 200, body: JSON.stringify(home) }
      : undefined,
  );
  const result = await source.dailyRecommendation.load();
  assert.equal(result.length, 10);
  assert.deepEqual(
    Array.from(result, (item) => item.bannerTitle),
    Array.from({ length: 10 }, (_, index) => `宣传语 ${index}`),
  );
  assert.ok(
    result.every(
      (item) => item.title === fixture("detail").data.comicInfo.title,
    ),
  );
  assert.equal(
    requests.filter(
      (request) => request.url.pathname === "/api/v1/comic2/comic/detail",
    ).length,
    1,
  );
  assert.equal(
    requests.length,
    2,
    "recommendations need only home and comic metadata, without related comics",
  );
});

test("banner image fallbacks keep promotional art out of comic metadata", async () => {
  for (const [cover, imageUrl] of [
    ["", "//images.zaimanhua.com/banner.jpg"],
    ["//images.zaimanhua.com/comic.jpg", ""],
  ]) {
    const home = fixture("home");
    home.data.data.bannerList = [
      { type: 1, obj_id: 80825, title: " ", sub_title: "", cover: imageUrl },
    ];
    const detail = fixture("detail");
    detail.data.comicInfo.cover = cover;
    const { source } = plugin((url) => ({
      status: 200,
      body: JSON.stringify(
        new URL(url).pathname === "/api/v1/comic2/index" ? home : detail,
      ),
    }));
    const [banner] = await source.dailyRecommendation.load();
    assert.equal(banner.title, detail.data.comicInfo.title);
    assert.equal(banner.bannerTitle, "");
    assert.equal(banner.cover, cover ? "https:" + cover : undefined);
    assert.equal(banner.imageUrl, imageUrl ? "https:" + imageUrl : undefined);
  }
});

test("empty banners skip details and invalid metadata errors propagate", async () => {
  const home = fixture("home");
  home.data.data.bannerList = [];
  const empty = plugin(() => ({ status: 200, body: JSON.stringify(home) }));
  assert.deepEqual(plain(await empty.source.dailyRecommendation.load()), []);
  assert.equal(empty.requests.length, 1);
  home.data.data.bannerList = [
    { type: 1, obj_id: 80825, title: "宣传语", cover: "" },
  ];
  for (const mutate of [
    (detail) => {
      detail.data.comicInfo.id = 1;
    },
    (detail) => {
      detail.data.comicInfo.title = " ";
    },
    (detail) => {
      detail.data.comicInfo.cover = "";
    },
    (detail) => {
      detail.errno = 1;
      detail.errmsg = "资料请求失败";
    },
  ]) {
    const detail = fixture("detail");
    mutate(detail);
    const { source } = plugin((url) => ({
      status: 200,
      body: JSON.stringify(
        new URL(url).pathname === "/api/v1/comic2/index" ? home : detail,
      ),
    }));
    await assert.rejects(source.dailyRecommendation.load(), /再漫画：/);
  }
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
  for (const label of ["题材", "读者"]) {
    assert.deepEqual(
      plain(info.infoFields.find((field) => field.label === label)),
      {
        label,
        values: plain(info.tags[label]),
        action: "search",
      },
    );
  }
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
