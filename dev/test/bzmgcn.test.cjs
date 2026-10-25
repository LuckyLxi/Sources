const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { HtmlDocument } = require("./helpers/mini_dom.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://cn.bzmgcn.com";
const LONG_COMIC = "huoyingrenzhe-anbenqishi";
const COMIC = "yaoshenji-taxuedongman";
const SHILI_IDS = [
  "shilizhishangxiaoyuan-handongweiidaoxi",
  "huanyinglaidaoshilizhishangzhuyidejiaoshi-yilizhangwuyinaiyuyu",
  "huanyinglaidaoshilizhishangzhuyidejiaoshi2nianjipian-yilizhangwushayinsia",
];
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures/bzmgcn", name), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const ok = (body) => ({ status: 200, body, headers: {} });
const blocked = () => ({
  status: 403,
  body: '{"error":"challenge_required","challenge_url":"/__gatekeeper_challenge/start?return=%2F"}',
  headers: {},
});

function serve(url) {
  const route = new URL(url);
  if (route.pathname === "/") return ok(fixture("home.html"));
  if (route.pathname === "/list/new") return ok(fixture("new.html"));
  if (route.pathname === "/search") {
    if (route.searchParams.get("q") === "实力至上")
      return ok(fixture("search-shili.html"));
    const name =
      route.searchParams.get("q") === "我"
        ? "search-many"
        : route.searchParams.get("q") === "无结果"
          ? "search-empty"
          : "search";
    return ok(fixture(name + ".html"));
  }
  const shili = SHILI_IDS.findIndex((id) => route.pathname === "/comic/" + id);
  if (shili >= 0) return ok(fixture("detail-shili" + (shili + 1) + ".html"));
  for (const n of [2, 3]) {
    if (route.pathname === "/comic/chapter/" + SHILI_IDS[n - 1] + "/0_0.html")
      return ok(fixture("reader-shili" + n + ".html"));
  }
  if (route.pathname === "/api/bzmhq/amp_comic_list") {
    if (
      route.searchParams.get("type") === "lianai" &&
      route.searchParams.get("region") === "jp"
    )
      return ok(
        fixture(
          "catalog-romance-jp" +
            (route.searchParams.get("page") === "2" ? "2" : "1") +
            ".json",
        ),
      );
    if (
      route.searchParams.get("type") === "mouxian" &&
      route.searchParams.get("region") === "jp" &&
      route.searchParams.get("state") === "pub" &&
      route.searchParams.get("filter") === "ABCD"
    )
      return ok(fixture("catalog-empty.json"));
    return ok(
      fixture(
        route.searchParams.get("filter") === "XYZ"
          ? "catalog-empty.json"
          : route.searchParams.get("page") === "2"
            ? "catalog2.json"
            : "catalog.json",
      ),
    );
  }
  if (route.pathname === "/comic/" + COMIC) return ok(fixture("detail.html"));
  if (route.pathname === "/comic/" + LONG_COMIC)
    return ok(fixture("detail2.html"));
  if (route.pathname === "/comic/chapter/" + COMIC + "/0_994.html")
    return ok(fixture("reader.html"));
  if (route.pathname === "/comic/chapter/" + COMIC + "/0_0.html")
    return ok(fixture("reader-old.html"));
  if (route.pathname === "/comic/chapter/" + LONG_COMIC + "/0_0.html")
    return ok(fixture("reader-long.html"));
  if (route.pathname === "/comic/chapter/" + LONG_COMIC + "/0_0_2.html")
    return ok(fixture("reader-long2.html"));
  throw new Error("Unrouted request: " + url);
}

function plugin({
  respond = serve,
  ui,
  cookies = [],
  storage = new Map(),
} = {}) {
  let source;
  const requests = [];
  const documents = [];
  const cookieWrites = [];
  const request = async (method, url, headers, body) => {
    requests.push({ method, url, headers, body });
    return respond(url, headers, body, method);
  };
  const context = vm.createContext({
    Hazuki: {
      registerSource: (value) => {
        source = value;
      },
      http: {
        get: (url, headers) => request("GET", url, headers),
        post: (url, headers, body) => request("POST", url, headers, body),
      },
      cookies: {
        get: async () =>
          cookies.filter(
            (cookie) =>
              cookie.expiresAt == null || cookie.expiresAt > Date.now(),
          ),
        set: async (url, values) => {
          cookieWrites.push({ url, values });
          for (const value of values) {
            const index = cookies.findIndex(
              (cookie) =>
                cookie.name === value.name &&
                cookie.domain === value.domain &&
                cookie.path === value.path,
            );
            if (index >= 0) cookies.splice(index, 1);
            if (value.expiresAt == null || value.expiresAt > Date.now())
              cookies.push(value);
          }
        },
      },
      storage: {
        get: (key) => storage.get(key),
        set: async (key, value) => {
          storage.set(key, value);
        },
        delete: async (key) => {
          storage.delete(key);
        },
      },
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
      ui,
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "bzmgcn.js"), "utf8"),
    context,
  );
  // Model the documented isolated login transaction: only successful attempts
  // commit cookie/storage writes; rejected attempts retain the old session.
  const login = async (account, password) => {
    const oldCookies = [...cookies];
    const oldStorage = [...storage];
    try {
      return await source.account.login(account, password, {
        method: "password",
      });
    } catch (error) {
      cookies.splice(0, cookies.length, ...oldCookies);
      storage.clear();
      for (const [key, value] of oldStorage) storage.set(key, value);
      throw error;
    }
  };
  return { source, requests, documents, cookies, cookieWrites, storage, login };
}

test("homepage preserves all seven website sections and uses original covers", async () => {
  const { source, documents } = plugin();
  assert.equal(source.id, "bzmgcn");
  assert.equal(source.version, "1.3.0");
  const sections = await source.explore[0].load(1);
  assert.deepEqual(
    plain(sections.map((item) => [item.title, item.comics.length])),
    [
      ["热门漫画", 12],
      ["推荐国漫", 12],
      ["推荐韩漫", 12],
      ["推荐日漫", 12],
      ["热血漫画", 12],
      ["最新上架", 12],
      ["最近更新", 36],
    ],
  );
  const comic = sections[0].comics[0];
  assert.equal(
    comic.id,
    "silingfashiwojishitianzai-mantudezhuyuanzhuheiniaoshe_rjogsq",
  );
  assert.ok(comic.cover.includes("heiniaoshe.jpg?w=285&h=375&q=100"));
  assert.ok(!comic.cover.includes("default_cover"));
  assert.equal(comic.subTitle, "更新至 285 大军撤退");
  assert.ok(documents.every((doc) => doc.disposed));
});

test("homepage view-more routes open the website's full lists and paginate beyond previews", async () => {
  const { source, requests } = plugin();
  const sections = await source.explore[0].load(1);
  for (const section of sections.slice(0, 5)) {
    assert.equal(section.viewMore, "category:" + section.title + "@catalog");
    const [category, param] = section.viewMore
      .slice("category:".length)
      .split("@");
    const first = await source.categoryComics.load(category, param, [], 1);
    const second = await source.categoryComics.load(category, param, [], 2);
    assert.equal(first.comics.length, 36);
    assert.equal(second.comics.length, 36);
    assert.notEqual(first.comics[0].id, second.comics[0].id);
    assert.equal(first.maxPage, undefined);
    const query = new URL(requests.at(-1).url).searchParams;
    assert.equal(query.get("type"), "all");
    assert.equal(
      query.get("region"),
      "all",
      "website more links do not preselect a section's region",
    );
    assert.equal(query.get("page"), "2");
  }
  const recent = sections.find((section) => section.title === "最新上架");
  assert.equal(recent.viewMore, "explore:1");
  const explore =
    source.explore[Number(recent.viewMore.slice("explore:".length))];
  assert.equal((await explore.load(1)).comics.length, 48);
  assert.equal(
    sections.find((section) => section.title === "最近更新").viewMore,
    undefined,
    "the website has no more link for this section",
  );
});

test("view-more catalog supports theme, region, state and initial-letter filters together", async () => {
  const { source, requests } = plugin();
  const section = (await source.explore[0].load(1))[0];
  const [category, param] = section.viewMore
    .slice("category:".length)
    .split("@");
  const groups = source.categoryComics.optionList;
  assert.deepEqual(plain(groups.map((group) => group.label)), [
    "地区",
    "状态",
    "首字母",
    "题材",
  ]);
  const options = groups.map((group) => group.options[0].split("-")[0]);
  const select = (label, selected) => {
    options[groups.findIndex((group) => group.label === label)] = selected;
  };
  select("地区", "jp");
  select("题材", "lianai");
  const first = await source.categoryComics.load(category, param, options, 1);
  const second = await source.categoryComics.load(category, param, options, 2);
  assert.equal(first.comics.length, 36);
  assert.equal(second.comics.length, 36);
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(second.comics[0].title, "黑色但纯白");
  assert.deepEqual(
    Object.fromEntries(new URL(requests.at(-1).url).searchParams),
    {
      type: "lianai",
      region: "jp",
      state: "all",
      filter: "*",
      page: "2",
      limit: "36",
      language: "cn",
    },
  );
  select("题材", "mouxian");
  select("状态", "pub");
  select("首字母", "ABCD");
  assert.deepEqual(
    plain(await source.categoryComics.load(category, param, options, 1)),
    { comics: [], maxPage: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(new URL(requests.at(-1).url).searchParams),
    {
      type: "mouxian",
      region: "jp",
      state: "pub",
      filter: "ABCD",
      page: "1",
      limit: "36",
      language: "cn",
    },
  );
  await source.categoryComics.load(
    "全部",
    "type:all",
    ["all", "all", "*", "rexie"],
    1,
  );
  assert.equal(new URL(requests.at(-1).url).searchParams.get("type"), "rexie");
  await source.categoryComics.load(
    "国漫",
    "region:cn",
    ["all", "serial", "*", "gufeng"],
    1,
  );
  const regionQuery = new URL(requests.at(-1).url).searchParams;
  assert.equal(regionQuery.get("region"), "cn");
  assert.equal(regionQuery.get("type"), "gufeng");
  await source.categoryComics.load(
    "冒险",
    "type:mouxian",
    ["all", "all", "*", "lianai"],
    1,
  );
  assert.equal(
    new URL(requests.at(-1).url).searchParams.get("type"),
    "mouxian",
    "fixed theme categories retain their theme",
  );
});

test("related tab uses the website's comic recommendations in display order with original covers", async () => {
  const { source, documents, requests } = plugin();
  assert.ok(
    source.presentation.buttons.some(
      (button) =>
        button.id === "relatedComics" && button.location === "comicDetailTabs",
    ),
  );
  const detail = await source.comic.loadInfo(COMIC);
  assert.deepEqual(
    plain(detail.recommend.map((comic) => [comic.id, comic.title])),
    [
      ["yaersilanzhanji-huangchuanhongtianzhongfangshu", "亚尔斯兰战记"],
      [
        "chuancaichushiyuyishijiedeyongzheshaonumen-danqingyinghua",
        "川菜厨师与异世界的勇者少女们",
      ],
      ["moxiangzhiwang-weitianchuanmei", "万相之王"],
      ["baihexiongfengbao-sendaomingziikunigomakinako", "百合熊风暴"],
      ["zaijianmiaoxiaojie-junengwan", "再见喵小姐"],
      ["mingyunzhishen-zhouyuanerubo", "命运之神"],
    ],
  );
  assert.equal(
    detail.recommend[0].cover,
    "https://static-tw.bzmgcn.com/cover/yaersilanzhanji-huangchuanhongtianzhongfangshu.jpg?w=90&h=120&q=100",
  );
  const other = await source.comic.loadInfo(LONG_COMIC);
  assert.equal(
    other.recommend.length,
    6,
    "exclude five cartoons and five novels",
  );
  assert.equal(other.recommend[0].id, "bailianchengshen-fengxingzhe");
  assert.equal(other.recommend.at(-1).title, "住在附近的菜菜子小姐");
  assert.ok(
    [...detail.recommend, ...other.recommend].every(
      (comic) =>
        comic.id && comic.cover && !comic.cover.includes("default_cover"),
    ),
  );
  assert.equal(
    requests.length,
    2,
    "reuse the detail responses without additional recommendation requests",
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("search returns the full website result set once, including 85-result searches", async () => {
  const { source, requests } = plugin();
  const search = await source.search.load("火影 & +", [], 1);
  assert.equal(search.comics.length, 15);
  assert.equal(search.comics[0].id, LONG_COMIC);
  assert.equal(
    search.comics[0].subTitle,
    undefined,
    "author must not become a subtitle",
  );
  assert.equal(new URL(requests[0].url).searchParams.get("q"), "火影 & +");
  assert.equal((await source.search.load("我", [], 1)).comics.length, 85);
  assert.deepEqual(plain(await source.search.load("无结果", [], 1)), {
    comics: [],
    maxPage: 1,
  });
  const count = requests.length;
  assert.deepEqual(plain(await source.search.load("我", [], 2)), {
    comics: [],
    maxPage: 1,
  });
  assert.equal(
    requests.length,
    count,
    "do not repeat the same search on later pages",
  );
});

test("new arrivals return all 48 entries without repeating later pages", async () => {
  const { source, requests } = plugin();
  assert.equal((await source.explore[1].load(1)).comics.length, 48);
  assert.deepEqual(plain(await source.explore[1].load(2)), {
    comics: [],
    maxPage: 1,
  });
  assert.equal(requests.length, 1);
});

test("catalog uses real API pagination and combines category filters", async () => {
  const { source, requests } = plugin();
  const first = await source.explore[2].load(1);
  const second = await source.explore[2].load(2);
  assert.equal(first.comics.length, 36);
  assert.equal(second.comics.length, 36);
  assert.equal(first.maxPage, undefined);
  assert.notEqual(first.comics[0].id, second.comics[0].id);
  assert.equal(first.comics[0].title, "大奉打更人");
  assert.equal(
    first.comics[0].cover,
    "https://static-tw.bzmgcn.com/cover/dafengdagengren-chuyingshe.jpg?w=285&h=375&q=100",
  );
  assert.deepEqual(plain(first.comics[0].tags), ["穿越", "古风"]);
  await source.categoryComics.load(
    "冒险",
    "type:mouxian",
    ["jp", "pub", "digits"],
    2,
  );
  const route = new URL(requests.at(-1).url);
  assert.deepEqual(Object.fromEntries(route.searchParams), {
    type: "mouxian",
    region: "jp",
    state: "pub",
    filter: "0-9",
    page: "2",
    limit: "36",
    language: "cn",
  });
  await source.categoryComics.load(
    "欧美",
    "region:en",
    ["all", "serial", "ABCD"],
    1,
  );
  assert.equal(new URL(requests.at(-1).url).searchParams.get("region"), "en");
  const end = await source.categoryComics.load(
    "推理",
    "type:tuili",
    ["en", "pub", "XYZ"],
    3,
  );
  assert.deepEqual(plain(end), { comics: [], maxPage: 3 });
});

test("details include hidden chapters in reading order and keep author in info fields", async () => {
  const { source, documents } = plugin();
  const detail = await source.comic.loadInfo(COMIC);
  const chapters = Object.entries(detail.chapters);
  assert.equal(detail.title, "妖神记");
  assert.equal(chapters.length, 995);
  assert.deepEqual(chapters[0], ["0_0", "第1话 重生"]);
  assert.deepEqual(chapters.at(-1), ["0_994", "第535话 黑炎塔之战（下）"]);
  assert.equal(detail.infoFields[0].values, "踏雪动漫");
  assert.equal(detail.subTitle, undefined);
  assert.deepEqual(plain(detail.tags["题材"]), ["热血", "冒险"]);
  assert.equal(detail.updateTime, "今天 更新");
  const other = await source.comic.loadInfo(LONG_COMIC);
  assert.equal(Object.keys(other.chapters).length, 360);
  assert.equal(other.chapters["0_359"], "外传第11话 满月照亮之路");
  assert.ok(documents.every((doc) => doc.disposed));
});

test("multi-page chapters merge overlapping images and stop before the next chapter", async () => {
  const { source, requests, documents } = plugin();
  const { images } = await source.comic.loadEp(LONG_COMIC, "0_0");
  assert.equal(images.length, 96, "pages 47..50 overlap on the website");
  for (let i = 0; i < images.length; i++)
    assert.equal(
      images[i],
      `https://s1.bzcdn.net/scomic/${LONG_COMIC}/0/0-zcqo/${i + 1}.jpg`,
    );
  assert.deepEqual(
    requests.map((r) => r.url),
    [
      `${ORIGIN}/comic/chapter/${LONG_COMIC}/0_0.html`,
      `https://www.twbzmg.com/comic/chapter/${LONG_COMIC}/0_0_2.html`,
    ],
  );
  assert.equal(
    source.comic.onImageLoad(images[0]).headers.Referer,
    "https://www.twbzmg.com/",
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("single-page and final chapters exclude recommendation art and noscript duplicates", async () => {
  const { source, requests } = plugin();
  assert.equal((await source.comic.loadEp(COMIC, "0_0")).images.length, 14);
  assert.equal((await source.comic.loadEp(COMIC, "0_994")).images.length, 9);
  assert.equal(requests.length, 2);
});

test("HTTP failures and changed markup are reported instead of returning empty success", async () => {
  const { source, documents } = plugin({
    respond: (url) =>
      url.includes("/search")
        ? { status: 503, body: "unavailable" }
        : ok("<html>maintenance</html>"),
  });
  await assert.rejects(source.search.load("火影", [], 1), /HTTP 503/);
  await assert.rejects(source.explore[0].load(1), /首页格式/);
  await assert.rejects(source.explore[1].load(1), /列表页面格式/);
  await assert.rejects(source.comic.loadInfo(COMIC), /未找到漫画详情/);
  await assert.rejects(source.comic.loadEp(COMIC, "0_0"), /未找到章节图片/);
  await assert.rejects(source.explore[2].load(1), /JSON/);
  assert.ok(documents.every((doc) => doc.disposed));
});

test("invalid IDs fail before making requests", async () => {
  const { source, requests } = plugin();
  await assert.rejects(
    source.comic.loadInfo("../search?q=test"),
    /无效的漫画 ID/,
  );
  await assert.rejects(
    source.comic.loadEp(COMIC, "0_0/../../"),
    /无效的章节 ID/,
  );
  assert.equal(requests.length, 0);
});

test("continuation loops fail and dispose the current HTML document", async () => {
  const body = fixture("reader-long.html");
  const { source, documents } = plugin({ respond: () => ok(body) });
  await assert.rejects(source.comic.loadEp(LONG_COMIC, "0_0"), /分页发生循环/);
  assert.ok(documents.every((doc) => doc.disposed));
});

function verificationPlugin({
  result = { status: "completed", url: ORIGIN },
  oldHost = false,
  stillBlocked = false,
  existingCookies = false,
} = {}) {
  let authorized = false;
  const views = [];
  const value = plugin({
    cookies: existingCookies
      ? [{ name: "__Host-gk_browser_ab12", value: "synthetic" }]
      : [],
    ui: oldHost
      ? undefined
      : {
          openWebView: async (options) => {
            views.push(options);
            await Promise.resolve();
            authorized = result.status === "completed";
            return result;
          },
        },
    respond: (url) => {
      if (url.includes("/__gatekeeper_challenge/start"))
        return {
          status: 200,
          body: "<html>verification</html>",
          headers: existingCookies
            ? {}
            : {
                "Set-Cookie": [
                  "__Host-gk_browser_ab12=synthetic; Path=/; Secure; HttpOnly",
                ],
              },
        };
      return authorized && !stillBlocked ? serve(url) : blocked();
    },
  });
  return { ...value, views };
}

test("concurrent challenged requests share one browser verification and retry their original URLs", async () => {
  const { source, requests, views } = verificationPlugin();
  const results = await Promise.all([
    source.search.load("火影", [], 1),
    source.explore[1].load(1),
  ]);
  assert.deepEqual(
    results.map((r) => r.comics.length),
    [15, 48],
  );
  assert.equal(views.length, 1);
  assert.equal(
    views[0].url,
    ORIGIN + "/__gatekeeper_challenge/start?return=%2F",
  );
  assert.equal(views[0].completion, "manual");
  assert.deepEqual(plain(views[0].cookieScopes), [
    {
      url: ORIGIN + "/",
      names: ["__Host-gk_browser_ab12", "__Host-gk_clearance_ab12"],
    },
  ]);
  assert.equal(
    requests.filter((r) => r.url.includes("/__gatekeeper")).length,
    1,
  );
});

test("verification discovers cookie names from an existing cookie jar too", async () => {
  const { source, views } = verificationPlugin({ existingCookies: true });
  await source.actions.verify();
  assert.equal(views.length, 1);
  assert.equal(views[0].cookieScopes[0].names[1], "__Host-gk_clearance_ab12");
});

test("closed or timed-out verification fails without retrying and allows a fresh attempt", async () => {
  for (const result of [
    { status: "timeout" },
    { status: "closed", reason: "plugin" },
  ]) {
    const { source, requests, views } = verificationPlugin({ result });
    await assert.rejects(source.search.load("火影", [], 1), /验证未完成/);
    assert.equal(requests.filter((r) => r.url.includes("/search")).length, 1);
    await assert.rejects(source.search.load("火影", [], 1), /验证未完成/);
    assert.equal(views.length, 2);
  }
});

test("browser completion alone is insufficient when the website still rejects HTTP access", async () => {
  const { source, views } = verificationPlugin({ stillBlocked: true });
  await assert.rejects(source.search.load("火影", [], 1), /验证后仍无法访问/);
  assert.equal(views.length, 1);
});

test("older hosts fail with a clear upgrade message when browser verification is required", async () => {
  const { source, requests } = verificationPlugin({ oldHost: true });
  await assert.rejects(source.search.load("火影", [], 1), /升级.*宿主版本/);
  assert.equal(requests.length, 1);
});

test("email/password login persists a validated TSID session and survives runtime recreation", async () => {
  const cookies = [];
  const storage = new Map();
  const respond = (url, _headers, _body, method) => {
    if (method === "POST") return ok(fixture("signin-success.json"));
    assert.equal(url, ORIGIN + "/user/my_bookshelf");
    assert.equal(
      cookies.find((cookie) => cookie.name === "TSID")?.value,
      "synthetic-test-session",
    );
    return ok(fixture("bookshelf-signed-in.html"));
  };
  const value = plugin({ respond, cookies, storage });
  assert.deepEqual(plain(value.source.account.loginMethods), [
    {
      id: "password",
      title: "邮箱密码登录",
      input: "credentials",
    },
  ]);
  const password = " +p&=字 密码 ";
  const profile = await value.login(" test+tag@example.invalid ", password);
  assert.deepEqual(plain(profile), { displayName: "test+tag@example.invalid" });
  const post = value.requests[0];
  assert.equal(post.method, "POST");
  assert.equal(post.url, ORIGIN + "/api/bui/signin");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(post.body)), {
    username: "test+tag@example.invalid",
    password,
  });
  assert.match(
    post.headers["Content-Type"],
    /^application\/x-www-form-urlencoded/,
  );
  const session = cookies.find((cookie) => cookie.name === "TSID");
  assert.equal(session.domain, ".bzmgcn.com");
  assert.equal(session.path, "/");
  assert.equal(session.secure, true);
  assert.equal(session.hostOnly, false);
  assert.ok(session.expiresAt > Date.now() + 364 * 24 * 60 * 60 * 1000);
  assert.deepEqual(
    [...storage],
    [["accountEmail", "test+tag@example.invalid"]],
    "do not save the password or a second copy of TSID in ordinary storage",
  );
  const restored = plugin({ respond, cookies, storage });
  assert.deepEqual(
    plain(await restored.source.account.loadProfile()),
    plain(profile),
  );
  assert.ok(
    [...value.documents, ...restored.documents].every((doc) => doc.disposed),
  );
});

test("invalid credentials and malformed successful responses cannot create an account session", async () => {
  for (const [body, message] of [
    [fixture("signin-invalid.json"), /邮箱或密码错误/],
    ['{"result":true,"data":""}', /未返回有效会话/],
    ['{"result":true,"data":{"token":"synthetic"}}', /未返回有效会话/],
    ['{"result":"true","data":"synthetic"}', /登录失败/],
    ['{"result":false,"code":"UNKNOWN"}', /登录失败/],
    ["<html>maintenance</html>", /返回格式异常/],
  ]) {
    const value = plugin({ respond: () => ok(body) });
    await assert.rejects(
      value.login("test@example.invalid", "synthetic-password"),
      message,
    );
    assert.equal(value.requests.length, 1);
    assert.equal(value.cookieWrites.length, 0);
    assert.equal(value.storage.size, 0);
  }
});

test("login validates inputs before sending credentials and requires an isolated login method", async () => {
  const value = plugin();
  await assert.rejects(value.login(" ", "password"), /请输入邮箱/);
  await assert.rejects(value.login("test@example.invalid", ""), /请输入密码/);
  await assert.rejects(
    value.source.account.login("test@example.invalid", "password"),
    /登录入口/,
  );
  assert.equal(value.requests.length, 0);
});

test("protected-page rejection rolls the isolated attempt back to the previous account", async () => {
  const previous = {
    name: "TSID",
    value: "old-synthetic-session",
    domain: ".bzmgcn.com",
    path: "/",
  };
  const value = plugin({
    cookies: [previous],
    storage: new Map([["accountEmail", "old@example.invalid"]]),
    respond: (_url, _headers, _body, method) =>
      ok(fixture(method === "POST" ? "signin-success.json" : "signin.html")),
  });
  await assert.rejects(
    value.login("new@example.invalid", "synthetic-password"),
    { code: "AUTH_EXPIRED" },
  );
  assert.equal(
    value.cookieWrites[0].values[0].value,
    "synthetic-test-session",
    "the new session must be checked before commit",
  );
  assert.deepEqual(value.cookies, [previous]);
  assert.equal(value.storage.get("accountEmail"), "old@example.invalid");
  assert.ok(value.documents.every((doc) => doc.disposed));
});

test("profile rejects missing, expired and anonymous sessions and reports changed pages separately", async () => {
  const missing = plugin();
  await assert.rejects(missing.source.account.loadProfile(), {
    code: "AUTH_EXPIRED",
  });
  assert.equal(missing.requests.length, 0);
  const expired = plugin({
    cookies: [{ name: "TSID", value: "expired", expiresAt: 1 }],
  });
  await assert.rejects(expired.source.account.loadProfile(), {
    code: "AUTH_EXPIRED",
  });
  assert.equal(expired.requests.length, 0);
  for (const body of [
    fixture("signin.html"),
    '<div class="bookshelf"><a href="/user/signin">专属书架</a></div>',
  ]) {
    const value = plugin({
      cookies: [{ name: "TSID", value: "synthetic" }],
      respond: () => ok(body),
    });
    await assert.rejects(value.source.account.loadProfile(), {
      code: "AUTH_EXPIRED",
    });
    assert.ok(value.documents.every((doc) => doc.disposed));
  }
  const changed = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: () => ok("<html>maintenance</html>"),
  });
  await assert.rejects(changed.source.account.loadProfile(), /页面格式已变化/);
  const unavailable = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: () => ({ status: 503, body: "unavailable" }),
  });
  await assert.rejects(unavailable.source.account.loadProfile(), /HTTP 503/);
});

test("login retries a challenged POST only after verification and then validates the imported session", async () => {
  let authorized = false;
  let views = 0;
  const value = plugin({
    ui: {
      openWebView: async () => {
        authorized = true;
        views++;
        return { status: "completed", url: ORIGIN };
      },
    },
    respond: (url, _headers, _body, method) => {
      if (url.includes("/__gatekeeper_challenge/start"))
        return {
          status: 200,
          body: "verification",
          headers: {
            "set-cookie": "__Host-gk_browser_ab12=synthetic; Path=/; Secure",
          },
        };
      if (!authorized) return blocked();
      if (method === "POST") return ok(fixture("signin-success.json"));
      if (url.endsWith("/user/my_bookshelf"))
        return ok(fixture("bookshelf-signed-in.html"));
      return serve(url);
    },
  });
  await value.login("test@example.invalid", "synthetic-password");
  assert.equal(views, 1);
  const posts = value.requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body, posts[1].body);
  assert.ok(
    posts.every((request) => request.url === ORIGIN + "/api/bui/signin"),
  );
  assert.equal(value.requests.at(-1).url, ORIGIN + "/user/my_bookshelf");
});

test("cancelled verification and HTTP login failures never commit credentials", async () => {
  const cancelled = plugin({
    ui: { openWebView: async () => ({ status: "timeout" }) },
    respond: (url) =>
      url.includes("/__gatekeeper_challenge/start")
        ? {
            status: 200,
            body: "verification",
            headers: {
              "set-cookie": "__Host-gk_browser_ab12=synthetic; Path=/; Secure",
            },
          }
        : blocked(),
  });
  await assert.rejects(
    cancelled.login("test@example.invalid", "synthetic-password"),
    /验证未完成/,
  );
  assert.equal(
    cancelled.requests.filter((request) => request.method === "POST").length,
    1,
  );
  assert.equal(cancelled.cookieWrites.length, 0);
  const failed = plugin({
    respond: () => ({ status: 500, body: "unavailable" }),
  });
  await assert.rejects(
    failed.login("test@example.invalid", "synthetic-password"),
    /HTTP 500/,
  );
  assert.equal(failed.cookieWrites.length, 0);
});

test("local logout removes all TSID cookie scopes while retaining website verification cookies", async () => {
  const clearance = {
    name: "__Host-gk_clearance_ab12",
    value: "synthetic-clearance",
    path: "/",
  };
  const value = plugin({
    cookies: [
      { name: "TSID", value: "synthetic", domain: ".bzmgcn.com", path: "/" },
      {
        name: "TSID",
        value: "other-synthetic",
        domain: "cn.bzmgcn.com",
        path: "/",
      },
      clearance,
    ],
    storage: new Map([["accountEmail", "test@example.invalid"]]),
  });
  await value.source.account.logout();
  assert.deepEqual(value.cookies, [clearance]);
  assert.equal(value.storage.has("accountEmail"), false);
  assert.equal(value.requests.length, 0);
  await value.source.account.logout();
  await assert.rejects(value.source.account.loadProfile(), {
    code: "AUTH_EXPIRED",
  });
});

test("实力至上 search results open all three details, including the short reverse-only directory", async () => {
  const { source, documents } = plugin();
  const { comics } = await source.search.load("实力至上", [], 1);
  assert.deepEqual(plain(comics.map((comic) => comic.id)), SHILI_IDS);
  const counts = [230, 65, 18];
  for (let i = 0; i < comics.length; i++) {
    const detail = await source.comic.loadInfo(comics[i].id);
    assert.equal(Object.keys(detail.chapters).length, counts[i]);
    assert.equal(detail.title, comics[i].title);
    assert.equal(
      detail.cover,
      comics[i].cover,
      "retain the website's actual cover URL; this does not assert CDN delivery",
    );
  }
  const detail = await source.comic.loadInfo(SHILI_IDS[2]);
  assert.deepEqual(Object.entries(detail.chapters).slice(0, 2), [
    ["0_0", "第1话"],
    ["0_1", "第2话"],
  ]);
  assert.equal(detail.chapters["0_6"], "2年级篇_动画出第二季");
  assert.equal(detail.chapters["0_9"], "第8.5话");
  assert.deepEqual(Object.entries(detail.chapters).at(-1), ["0_17", "第17话"]);
  assert.equal(
    (await source.comic.loadEp(SHILI_IDS[1], "0_0")).images.length,
    33,
  );
  assert.equal(
    (await source.comic.loadEp(SHILI_IDS[2], "0_0")).images.length,
    45,
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("renamed search slugs follow canonical continuation pages without losing later images", async () => {
  const renamed = LONG_COMIC + "_renamed";
  const prefix = `https://www.twbzmg.com/comic/chapter/${renamed}/0_0`;
  const { source, requests } = plugin({
    respond: (url) => {
      if (url === `${ORIGIN}/comic/chapter/${LONG_COMIC}/0_0.html`)
        return ok(
          `<link rel="canonical" href="${prefix}.html">` +
            fixture("reader-long.html").replaceAll(LONG_COMIC, renamed),
        );
      if (url === prefix + "_2.html")
        return ok(
          `<link rel="canonical" href="${prefix}_2.html">` +
            fixture("reader-long2.html").replaceAll(LONG_COMIC, renamed),
        );
      throw new Error("unexpected continuation: " + url);
    },
  });
  const result = await source.comic.loadEp(LONG_COMIC, "0_0");
  assert.equal(result.images.length, 96);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, prefix + "_2.html");
});

test("cover requests use the catalog origin referer while reader images retain the reading origin", async () => {
  const { source } = plugin();
  const { comics } = await source.search.load("实力至上", [], 1);
  assert.equal(
    source.comic.onImageLoad(comics[2].cover).headers.Referer,
    ORIGIN + "/",
  );
  const { images } = await source.comic.loadEp(SHILI_IDS[2], "0_0");
  assert.equal(
    source.comic.onImageLoad(images[0]).headers.Referer,
    "https://www.twbzmg.com/",
  );
});

test("website favorites list and folder membership use shelf rows and exclude recommendations", async () => {
  const { source, requests, documents } = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: () => ok(fixture("bookshelf-populated.html")),
  });
  assert.equal(source.presentation.refreshCloudFavorites, true);
  assert.equal(source.favorites.singleFolderForSingleComic, true);
  assert.deepEqual(plain(await source.favorites.loadFolders(null)), {
    folders: { shelf: "网站书架" },
  });
  assert.equal(requests.length, 0);
  const page = await source.favorites.loadComics(1, "shelf");
  assert.equal(page.maxPage, 1);
  assert.deepEqual(plain(page.comics.map((comic) => [comic.id, comic.title])), [
    [COMIC, "妖神记"],
    [SHILI_IDS[2], "欢迎来到实力至上主义的教室 2年级篇"],
  ]);
  assert.equal(
    page.comics[0].cover,
    "https://static-tw.bzmgcn.com/cover/yaoshenji-taxuedongman.jpg?w=285&h=375&q=100",
  );
  assert.equal(page.comics[0].subTitle, undefined);
  assert.deepEqual(
    plain((await source.favorites.loadFolders(COMIC)).favorited),
    ["shelf"],
  );
  assert.deepEqual(
    plain((await source.favorites.loadFolders(LONG_COMIC)).favorited),
    [],
  );
  const count = requests.length;
  assert.deepEqual(plain(await source.favorites.loadComics(2, "shelf")), {
    comics: [],
    maxPage: 1,
  });
  assert.equal(requests.length, count);
  assert.ok(
    requests.every((request) => request.url === ORIGIN + "/user/my_bookshelf"),
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("website favorites distinguish a confirmed empty shelf from missing login and changed markup", async () => {
  const missing = plugin();
  await assert.rejects(missing.source.favorites.loadComics(1, "shelf"), {
    code: "AUTH_EXPIRED",
  });
  assert.equal(missing.requests.length, 0);
  const empty = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: () => ok(fixture("bookshelf-signed-in.html")),
  });
  assert.deepEqual(plain(await empty.source.favorites.loadComics(1, "shelf")), {
    comics: [],
    maxPage: 1,
  });
  for (const [body, error] of [
    [fixture("signin.html"), /登录已失效/],
    [
      '<div class="bookshelf"><div class="pure-menu-selected">临时书架(0)</div></div>',
      /登录已失效/,
    ],
    [
      '<div class="bookshelf">Unexpected new layout</div>',
      /无法确认收藏是否为空/,
    ],
    [
      '<div class="bookshelf"><div class="bookshelf-items"><h4>Changed</h4></div></div>',
      /书架条目格式已变化/,
    ],
  ]) {
    const value = plugin({
      cookies: [{ name: "TSID", value: "synthetic" }],
      respond: () => ok(body),
    });
    await assert.rejects(value.source.favorites.loadComics(1, "shelf"), error);
    assert.ok(value.documents.every((doc) => doc.disposed));
  }
});

function shelfHtml(ids) {
  const rows = [...ids]
    .map(
      (id) =>
        `<div class="bookshelf-items"><amp-img src="https://static-tw.bzmgcn.com/cover/${id}.jpg"></amp-img><div class="info"><h4><a href="/comic/${id}">Synthetic comic</a></h4></div></div>`,
    )
    .join("");
  return `<div class="bookshelf"><div class="pure-menu-selected">专属书架</div>${rows || "当前没有追任何漫画"}</div>`;
}

test("favorite mutations use the website operation routes and confirm the resulting shelf state", async () => {
  const ids = new Set([SHILI_IDS[2]]);
  const { source, requests } = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: (url, _headers, _body, method) => {
      assert.equal(method, "GET");
      const route = new URL(url);
      if (route.pathname === "/user/my_bookshelf") return ok(shelfHtml(ids));
      assert.equal(route.pathname, "/user/operation_v2");
      assert.equal(route.searchParams.get("comic_id"), COMIC);
      if (route.searchParams.get("op") === "set_bookmark") {
        assert.equal(route.searchParams.get("chapter_slot"), "0");
        ids.add(COMIC);
      } else {
        assert.equal(route.searchParams.get("op"), "del_bookmark");
        assert.equal(route.searchParams.has("chapter_slot"), false);
        ids.delete(COMIC);
      }
      return ok("operation complete");
    },
  });
  await source.favorites.addOrDelFavorite(COMIC, "shelf", true);
  assert.ok(ids.has(COMIC));
  assert.ok(ids.has(SHILI_IDS[2]));
  await source.favorites.addOrDelFavorite(COMIC, "shelf", false);
  assert.equal(ids.has(COMIC), false);
  assert.ok(ids.has(SHILI_IDS[2]));
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [
      "/user/my_bookshelf",
      "/user/operation_v2",
      "/user/my_bookshelf",
      "/user/my_bookshelf",
      "/user/operation_v2",
      "/user/my_bookshelf",
    ],
  );
});

test("existing favorites are not re-added or reset to chapter zero", async () => {
  const value = plugin({
    cookies: [{ name: "TSID", value: "synthetic" }],
    respond: () => ok(shelfHtml([COMIC])),
  });
  await value.source.favorites.addOrDelFavorite(COMIC, "shelf", true);
  await value.source.favorites.addOrDelFavorite(LONG_COMIC, "shelf", false);
  assert.equal(value.requests.length, 2);
  assert.ok(
    value.requests.every((request) =>
      request.url.endsWith("/user/my_bookshelf"),
    ),
  );
});

test("unsuccessful and ambiguous favorite writes are reported and never blindly replayed", async () => {
  for (const failNetwork of [false, true]) {
    let writes = 0;
    const value = plugin({
      cookies: [{ name: "TSID", value: "synthetic" }],
      respond: (url) => {
        if (url.includes("/user/operation_v2")) {
          writes++;
          if (failNetwork) throw new Error("network timeout");
          return ok(shelfHtml([COMIC])); // A success-looking response is insufficient.
        }
        return ok(shelfHtml([]));
      },
    });
    await assert.rejects(
      value.source.favorites.addOrDelFavorite(COMIC, "shelf", true),
      failNetwork ? /network timeout/ : /同步未生效/,
    );
    assert.equal(writes, 1);
  }
});
