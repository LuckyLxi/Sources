// Regression tests for the relamanhua (热辣漫画 / manga2026.com) source plugin.
//
// The fixtures under test/fixtures/relamanhua are live responses or documented
// catalogue excerpts, so these tests run offline and without an account while
// still exercising the real page shapes, including the AES-encrypted chapter
// and page payloads. The expected image list is produced independently with
// node:crypto, so a broken bundled AES implementation cannot pass.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { HtmlDocument } = require("./helpers/mini_dom.cjs");

const PLUGIN_ID = "relamanhua";
const PLUGIN_PATH = path.join(__dirname, "..", "..", `${PLUGIN_ID}.js`);
const FIXTURES = path.join(__dirname, "fixtures", PLUGIN_ID);

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

/** Serve the captured fixtures by URL, mirroring the live routing. */
function serve(url) {
  const ok = (body) => ({ status: 200, body });
  if (url.includes("/api/v3/ranks")) {
    return ok(
      /offset=20/.test(url) ? fixture("ranks2.json") : fixture("ranks.json"),
    );
  }
  // The live site ships no comment service: every comments/roasts route answers
  // its 404 upgrade page, so that is what the fixture holds.
  if (url.includes("/api/v3/comments") || url.includes("/api/v3/roasts")) {
    return { status: 404, body: fixture("comments404.html") };
  }
  if (/\/api\/v3\/comic\/yokubounohako$/.test(url))
    return ok(fixture("comic_locked.json"));
  // comic_collected.json is a constructed sample: the live site only returns a
  // non-null `collect` for a real account, so only those fields were edited.
  if (/\/api\/v3\/comic\/naoodngxueshenghui$/.test(url))
    return ok(fixture("comic_collected.json"));
  if (/\/api\/v3\/comic\/[^/?]+$/.test(url)) return ok(fixture("comic.json"));
  if (url.includes("/api/v3/member/collect/comics")) {
    // The rack payload nests each comic, as the site's own rendering code shows
    // (dataList[0].comic). The live response needs an account, so this reuses
    // captured ranking items rather than a captured rack response.
    const list = JSON.parse(fixture("ranks.json")).results.list.slice(0, 3);
    return ok(
      JSON.stringify({
        code: 200,
        message: "请求成功",
        results: { list, total: 3, limit: 30, offset: 0 },
      }),
    );
  }
  if (url.includes("/api/v3/search/comic")) {
    return ok(
      /offset=12/.test(url) ? fixture("search2.json") : fixture("search.json"),
    );
  }
  if (url.includes("/comicdetail/")) return ok(fixture("chapters.json"));
  if (/\/comic\/[^/]+\/chapter\//.test(url)) {
    if (/fd1b3104-c2d4-11f1-b213-fa163e02432f/.test(url))
      return ok(fixture("reader.html"));
    if (/8ecacd4c-1be0-11e9-89fb-024352452ce0/.test(url))
      return ok(fixture("reader2.html"));
    // Unknown chapter: the live site answers with a page that has no contentKey.
    return ok(fixture("detail.html"));
  }
  if (/\/comic\/[^/?]+$/.test(url)) {
    return ok(
      /skirtnonakawakedamonodeshita/.test(url)
        ? fixture("detail2.html")
        : fixture("detail.html"),
    );
  }
  if (/\/recommend\?/.test(url)) {
    return ok(
      fixture(
        /offset=60(?:&|$)/.test(url) ? "recommend2.html" : "recommend.html",
      ),
    );
  }
  if (/\/comics\?type=2(?:&|$)/.test(url)) {
    return ok(
      fixture(
        /offset=50(?:&|$)/.test(url) ? "comics_paid2.html" : "comics_paid.html",
      ),
    );
  }
  if (/\/comics\?/.test(url)) return ok(fixture("comics.html"));
  if (/\/rank$/.test(url)) return ok(fixture("rank.html"));
  if (/manga2026\.com\/$/.test(url)) return ok(fixture("home.html"));
  throw new Error("unrouted fixture request: " + url);
}

/** Account endpoints answer {code, results} on success, {detail} on failure. */
function respondPost(url, options) {
  if (url.includes("/api/v1/login")) {
    if (options.login) return options.login;
    return {
      status: 200,
      body: JSON.stringify({
        code: 200,
        message: "请求成功",
        results: {
          token: "test-token",
          nickname: "Hazuki 測試",
          avatar: "/user/cover/9d480f50/1652459942.jpg",
          user_id: "9d480f50",
          vip: 0,
        },
      }),
    };
  }
  // Collect and comment posts are member routes: 401 without a token.
  if (url.includes("/api/v3/member/")) {
    if (options.postWithoutToken) {
      return { status: 401, body: '{"detail":"身份认证信息未提供。"}' };
    }
    if (url.includes("/member/comment") || url.includes("/member/roast")) {
      // No comment service is deployed, so the live site answers the 404 page.
      return { status: 404, body: fixture("comments404.html") };
    }
    return {
      status: 200,
      body: JSON.stringify({ code: 200, message: "请求成功", results: [] }),
    };
  }
  return { status: 200, body: JSON.stringify({ code: 200, results: [] }) };
}

function plugin(options = {}) {
  const settings = options.settings || {};
  const requests = [];
  const requestHeaders = [];
  const posts = [];
  const stored = new Map(Object.entries(settings));
  let source;
  const api = {
    apiVersion: 1,
    registerSource(value) {
      assert.equal(source, undefined, "register exactly once");
      source = value;
    },
    settings: {
      get: (key) =>
        stored.has(key)
          ? stored.get(key)
          : source && source.settings && source.settings[key]
            ? source.settings[key].default
            : undefined,
      set: async (key, value) => {
        stored.set(key, value);
      },
    },
    storage: {
      get: (key) => stored.get(key),
      set: async (key, value) => {
        stored.set(key, value);
      },
      delete: async (key) => {
        stored.delete(key);
      },
    },
    http: {
      get: async (url, headers) => {
        requests.push(url);
        requestHeaders.push(headers || {});
        const authorized = /Token\s+\S+/.test(
          headers ? String(headers.Authorization || "") : "",
        );
        // Simulate an expired stored token so the anonymous fallback gets exercised.
        if (
          options.staleToken &&
          authorized &&
          !url.includes("/api/v1/login")
        ) {
          return {
            status: 401,
            headers: {},
            body: '{"detail":"Invalid token header. Please login again."}',
          };
        }
        // Member routes answer 401 without a token, exactly as the live site does.
        if (url.includes("/api/v3/member/") && !authorized) {
          return {
            status: 401,
            headers: {},
            body: '{"detail":"身份认证信息未提供。"}',
          };
        }
        if (url.includes("/api/v2/web/user/info")) {
          const profile = options.profile;
          if (profile)
            return { status: profile.status, headers: {}, body: profile.body };
          // Without a token the live site answers 401 with a DRF detail object.
          if (!authorized) {
            return {
              status: 401,
              headers: {},
              body: '{"detail":"身份认证信息未提供。"}',
            };
          }
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              code: 200,
              message: "请求成功",
              results: {
                nickname: "Hazuki 測試",
                avatar: "/user/cover/9d480f50/1652459942.jpg",
              },
            }),
          };
        }
        const reply = serve(url);
        return { status: reply.status, headers: {}, body: reply.body };
      },
      post: async (url, headers, body) => {
        posts.push({ url, headers, body });
        if (options.logoutThrows && url.includes("/api/v1/logout")) {
          throw new Error("network down");
        }
        const reply = respondPost(url, options);
        return { status: reply.status, headers: {}, body: reply.body };
      },
    },
    html: { parse: (html) => new HtmlDocument(html) },
    images: { reverseVerticalTiles: (segments) => ({ segments }) },
    delay: async () => {},
    log: () => {},
    error: (code, message) => new Error(code + ": " + message),
  };
  // Only API v1 globals are exposed, matching the real isolated engine.
  if (options.noStorage) delete api.storage;
  const context = vm.createContext({ Hazuki: api });
  vm.runInContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context);
  return { source, requests, requestHeaders, posts, storage: stored };
}

/** Independent AES-128-CBC oracle. */
function oracleDecrypt(blob, keyText) {
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(keyText, "utf8"),
    Buffer.from(blob.substring(0, 16), "utf8"),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(blob.substring(16), "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Values created inside the vm realm have a foreign Array prototype. */
function sameValues(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

test("relamanhua registers API v1 without legacy globals or import-time I/O", () => {
  const app = plugin();
  assert.equal(app.source.id, PLUGIN_ID);
  assert.equal(app.source.apiVersion, 1);
  assert.equal(app.requests.length, 0, "import must not perform I/O");
  for (const setting of Object.values(app.source.settings)) {
    assert.ok(["input", "select", "switch", "bool"].includes(setting.type));
  }
  assert.equal(typeof app.source.search.load, "function");
  assert.equal(typeof app.source.comic.loadInfo, "function");
  assert.equal(typeof app.source.comic.loadEp, "function");
});

test("relamanhua search pages the JSON API and reports maxPage", async () => {
  const app = plugin();
  const first = await app.source.search.load("一拳超人", [], 1);
  assert.equal(first.comics.length, 11);
  assert.equal(first.maxPage, 1, "total 11 over a limit of 12 is one page");
  assert.equal(first.comics[0].id, "yiquanchaorenmaoer");
  assert.equal(first.comics[0].title, "一拳超人 貓耳");
  assert.ok(first.comics.every((comic) => comic.subTitle === undefined));
  assert.match(first.comics[0].cover, /^https:\/\/sy\.mangafunb\.fun\//);
  assert.match(app.requests[0], /free_type=1/);
  assert.match(app.requests[0], /platform=2/);
  assert.match(app.requests[0], /limit=12/);

  const second = await app.source.search.load("一拳超人", [], 2);
  assert.match(app.requests[1], /offset=12/);
  assert.equal(second.comics.length, 0);
  assert.equal(second.maxPage, 1);

  await app.source.search.load("一拳超人", ["charge"], 1);
  assert.match(
    app.requests[2],
    /free_type=2/,
    "the charge order selects paid comics",
  );
});

test("relamanhua loadInfo parses the detail page in both label scripts", async () => {
  const app = plugin();
  const details = await app.source.comic.loadInfo("yiquanchaoren");
  assert.equal(details.id, "yiquanchaoren");
  assert.equal(details.title, "一拳超人");
  assert.match(
    details.cover,
    /^https:\/\/sy\.mangafunb\.fun\/y\/yiquanchaoren\/cover\//,
  );
  assert.equal(details.subTitle, undefined);
  sameValues(
    details.tags["作者"],
    ["村田雄介", "ONE"],
    "authors belong in tags",
  );
  assert.equal(details.updateTime, "2026-10-08");
  sameValues(
    details.infoFields.map((row) => row.label.en),
    ["Author", "Themes", "Tags", "Aliases", "Status"],
    "plugin row order",
  );
  sameValues(
    details.infoFields[4].values,
    ["連載中"],
    "status has its own row",
  );
  assert.equal(details.infoFields[3].action, "copy");
  assert.equal(details.infoFields[4].action, undefined);
  assert.equal(details.headerStats[0].text, "連載中");
  assert.ok(details.description.length > 50, "description should be captured");
  sameValues(
    details.tags["题材"],
    ["格鬥", "歡樂向", "冒險"],
    "题材 tag group",
  );
  sameValues(details.tags["状态"], ["連載中"], "状态 tag group");
  sameValues(
    details.tags["别名"],
    ["一击男", "one punch man", "秃头披风侠", "一擊男"],
    "别名 group",
  );
});

test("relamanhua decrypts the encrypted chapter list and keeps group names", async () => {
  const app = plugin();
  const details = await app.source.comic.loadInfo("yiquanchaoren");
  const ids = Object.keys(details.chapters);
  assert.equal(
    ids.length,
    490,
    "305 default chapters plus 185 other-series chapters",
  );
  assert.equal(
    details.chapters["2c814b6a-4f03-11e9-8b1c-024352452ce0"],
    "第01卷",
  );
  assert.equal(
    details.chapters["fd1b3104-c2d4-11f1-b213-fa163e02432f"],
    "第286话",
  );
  assert.equal(
    details.chapters["9d740e5b-81ac-11f1-ae2a-fa163e02432f"],
    "其他系列 · 原作版160",
    "non-default groups are prefixed so ids stay unique",
  );
});

test("relamanhua loadEp matches an independent AES-128-CBC implementation", async () => {
  const app = plugin();
  const chapterId = "fd1b3104-c2d4-11f1-b213-fa163e02432f";
  const result = await app.source.comic.loadEp("yiquanchaoren", chapterId);
  assert.equal(result.images.length, 14);

  const html = fixture("reader.html");
  const blob = /var contentKey\s*=\s*'([^']+)'/.exec(html)[1];
  const key = /var cct\s*=\s*'([^']*)'/.exec(html)[1];
  const expected = JSON.parse(oracleDecrypt(blob, key)).map(
    (entry) => entry.url,
  );
  sameValues(result.images, expected, "bundled AES must match node:crypto");
  assert.match(result.images[0], /\.h1500x\.jpg$/);
});

test("relamanhua imageQuality swaps the CDN render suffix", async () => {
  const app = plugin({ settings: { imageQuality: "webp" } });
  const result = await app.source.comic.loadEp(
    "yiquanchaoren",
    "fd1b3104-c2d4-11f1-b213-fa163e02432f",
  );
  assert.equal(result.images.length, 14);
  for (const image of result.images) assert.match(image, /\.h1500x\.webp$/);
  assert.match(
    result.images[0],
    /^https:\/\/sy\.mangafunb\.fun\/y\/yiquanchaoren\/782db\//,
  );
});

test("relamanhua handles a png-sourced chapter and reports a missing payload", async () => {
  const app = plugin();
  const result = await app.source.comic.loadEp(
    "skirtnonakawakedamonodeshita",
    "8ecacd4c-1be0-11e9-89fb-024352452ce0",
  );
  assert.equal(result.images.length, 5);
  assert.match(result.images[0], /\.h1500x\.jpg$/);

  await assert.rejects(
    () => app.source.comic.loadEp("yiquanchaoren", "not-a-real-chapter"),
    /没有可解密的数据/,
  );
  await assert.rejects(
    () => app.source.comic.loadEp("", ""),
    /缺少漫画或章节 ID/,
  );
  await assert.rejects(() => app.source.comic.loadInfo(""), /缺少漫画 ID/);
});

test("relamanhua explore 推薦 keeps only cover-bearing comic rails", async () => {
  const app = plugin();
  const tabs = app.source.explore.map((entry) => entry.title);
  sameValues(tabs, ["推薦", "排行榜", "漫畫庫", "付費漫畫"], "explore tabs");

  const sections = await app.source.explore[0].load(null);
  const titles = sections.map((section) => section.title);
  // 熱門更新 and the anime rails carry no cover, so they must not appear.
  sameValues(titles, ["漫畫推薦", "付費漫畫"], "homepage section titles");
  const recommended = sections[0];
  assert.equal(recommended.viewMore, "category:漫畫推薦@recommend");
  assert.equal(recommended.comics.length, 6);
  assert.equal(recommended.comics[0].id, "yuushanoisshuukanmuramusumehen");
  assert.equal(recommended.comics[0].title, "勇者の一週間 村娘編");
  assert.match(
    recommended.comics[0].cover,
    /^https:\/\/sy\.mangafunb\.fun\/y\//,
  );
  const paid = sections[1];
  assert.equal(paid.viewMore, "category:付費漫畫@2");
  assert.equal(paid.comics.length, 12);
  for (const comic of paid.comics) {
    assert.ok(comic.id && comic.title, "id and title required");
    assert.match(comic.cover, /^https:\/\//, "cover must be absolute");
  }
});

test("relamanhua homepage view-more links load distinct pages from their own lists", async () => {
  const app = plugin();
  const sections = await app.source.explore[0].load(null);
  for (const [index, endpoint, type, limit, total] of [
    [0, "/recommend", "1200102", 60, 30],
    [1, "/comics", "2", 50, 1419],
  ]) {
    const section = sections[index];
    assert.ok(
      section.viewMore.startsWith("category:"),
      "more must invoke the paged category loader",
    );
    const [category, param] = section.viewMore
      .slice("category:".length)
      .split("@");
    const pages = [];
    for (const page of [1, 2]) {
      const result = await app.source.categoryComics.load(
        category,
        param,
        [],
        page,
      );
      const request = new URL(app.requests.at(-1));
      assert.equal(request.pathname, endpoint);
      assert.equal(request.searchParams.get("type"), type);
      assert.equal(
        request.searchParams.get("offset"),
        String((page - 1) * limit),
      );
      assert.equal(request.searchParams.get("limit"), String(limit));
      // Each fixture keeps two complete cards from the real paginated page.
      assert.equal(result.comics.length, 2);
      assert.equal(result.maxPage, total);
      pages.push(result);
    }
    const firstIds = new Set(pages[0].comics.map((comic) => comic.id));
    assert.ok(
      pages[1].comics.every((comic) => !firstIds.has(comic.id)),
      "page 2 must not repeat page 1",
    );
    const previewIds = new Set(section.comics.map((comic) => comic.id));
    assert.ok(
      pages[1].comics.every((comic) => !previewIds.has(comic.id)),
      "more must go beyond the homepage preview",
    );
  }
});

test("relamanhua recommendations omit catalogue filters and normalize invalid pages", async () => {
  const app = plugin();
  const keys = ["漫畫推薦", "recommend"];
  const visibleGroups = app.source.categoryComics.optionList.filter(
    (group) =>
      (!group.showWhen || keys.some((key) => group.showWhen.includes(key))) &&
      (!group.notShowWhen ||
        !keys.some((key) => group.notShowWhen.includes(key))),
  );
  assert.equal(
    visibleGroups.length,
    0,
    "the recommendation list has no catalogue filters",
  );
  await app.source.categoryComics.load(
    "漫畫推薦",
    "recommend",
    ["gedou", "popular"],
    0,
  );
  const request = new URL(app.requests.at(-1));
  assert.equal(request.pathname, "/recommend");
  assert.equal(request.searchParams.get("offset"), "0");
  assert.equal(request.searchParams.has("theme"), false);
  assert.equal(request.searchParams.has("ordering"), false);
});

test("relamanhua explore 排行榜 reads every comic ranking tab", async () => {
  const app = plugin();
  const sections = await app.source.explore[1].load(null);
  const titles = sections.map((section) => section.title);
  assert.equal(
    titles.length,
    12,
    "free/pay/korea tabs for day/week/month/overall",
  );
  assert.ok(titles.includes("免費日榜"));
  assert.ok(titles.includes("韓漫總榜"));
  assert.ok(
    !titles.some((title) => title.includes("動畫")),
    "cartoon tabs hold no comics",
  );
  for (const section of sections) {
    assert.equal(
      section.comics.length,
      10,
      section.title + " should list 10 comics",
    );
    for (const comic of section.comics) {
      assert.ok(comic.id && comic.title, "id and title required");
      assert.match(
        comic.cover,
        /^https:\/\/s[a-z0-9]\.mangafunb\.fun\//,
        comic.cover,
      );
    }
  }
  assert.equal(sections[0].comics[0].id, "naoodngxueshenghui");
  assert.equal(sections[0].comics[0].title, "腦洞學生會");
});

test("relamanhua catalog pages by 50 and reports the total", async () => {
  const app = plugin();
  const first = await app.source.explore[2].load(1);
  assert.equal(first.comics.length, 50);
  assert.equal(first.maxPage, 1117);
  assert.equal(first.comics[0].id, "duoruheianyongzhede");
  assert.equal(first.comics[0].title, "墮入黑暗勇者的背信直播");
  assert.match(first.comics[0].cover, /^https:\/\//);
  assert.match(
    app.requests[0],
    /\/comics\?type=1&ordering=-datetime_updated&offset=0&limit=50/,
  );

  const second = await app.source.explore[2].load(2);
  assert.match(app.requests[1], /offset=50&limit=50/);
  void second;

  await app.source.explore[3].load(1);
  assert.match(app.requests[2], /type=2/, "the paid rail requests paid comics");
});

test("relamanhua categoryComics forwards type, theme and ordering", async () => {
  const app = plugin();
  const category = app.source.category;
  assert.equal(category.parts[0].itemType, "category");
  sameValues(category.parts[0].categoryParams, ["1", "2"], "type params");

  const groups = app.source.categoryComics.optionList;
  assert.equal(groups.length, 4);
  assert.equal(groups[0].options[0], "-全部題材");
  assert.ok(
    groups[0].options.includes("gedou-格鬥"),
    "theme options carry slug and label",
  );

  const result = await app.source.categoryComics.load(
    "付費漫畫",
    "2",
    ["gedou", "popular"],
    3,
  );
  assert.match(app.requests[0], /type=2/);
  assert.match(app.requests[0], /theme=gedou/);
  assert.match(app.requests[0], /ordering=-popular/);
  assert.match(
    app.requests[0],
    /offset=100&limit=50/,
    "page 3 starts at offset 100",
  );
  assert.equal(
    result.comics.length,
    2,
    "paid catalogue fixture keeps two cards",
  );
});

test("relamanhua exposes the active paid comic tags with host-safe option values", () => {
  const groups = plugin().source.categoryComics.optionList;
  const female = groups[2];
  const male = groups[3];
  // Counts and representative slugs were checked against /filter?point=1/2.
  assert.equal(female.options.length, 399, "398 active female tags plus all");
  assert.equal(male.options.length, 250, "249 active male tags plus all");
  assert.equal(female.options[0], "-全部女性標簽");
  assert.equal(male.options[0], "-全部男性標簽");
  assert.ok(female.options.includes("female_big_breasts-大胸(女)"));
  assert.ok(male.options.includes("male_glasses-眼鏡(男)"));
  assert.ok(female.options.includes("eye%2Doveringbang-遮眼劉海(女)"));
  assert.ok(female.options.includes("female%20garter%20belt-吊襪帶(女)"));
  for (const group of [female, male]) {
    sameValues(
      group.showWhen,
      ["付費漫畫", "2"],
      "tags only appear for paid comics",
    );
    const values = group.options.slice(1).map((option) => {
      const separator = option.indexOf("-");
      assert.ok(separator > 0 && separator < option.length - 1);
      const value = option.slice(0, separator);
      assert.doesNotThrow(() => decodeURIComponent(value));
      return value;
    });
    assert.equal(new Set(values).size, values.length, "tag options are unique");
    assert.ok(!group.options.some((option) => option.startsWith("undefined-")));
  }
});

test("relamanhua paid tag filters preserve theme, ordering and pagination", async () => {
  const app = plugin();
  await app.source.categoryComics.load(
    "付費漫畫",
    "2",
    ["COLOR", "popular", "eye%2Doveringbang", "male%20garter%20belt"],
    2,
  );
  const query = new URL(app.requests[0]).searchParams;
  assert.equal(query.get("type"), "2");
  assert.equal(query.get("theme"), "COLOR");
  assert.equal(query.get("ordering"), "-popular");
  assert.equal(query.get("offset"), "50");
  assert.equal(query.get("limit"), "50");
  assert.equal(query.get("female"), "eye-overingbang");
  assert.equal(query.get("male"), "male garter belt");

  await app.source.categoryComics.load(
    "付費漫畫",
    "2",
    ["", "", "female garter belt", ""],
    1,
  );
  const femaleOnly = new URL(app.requests[1]).searchParams;
  assert.equal(femaleOnly.get("female"), "female garter belt");
  assert.equal(femaleOnly.has("male"), false);

  await app.source.categoryComics.load(
    "付費漫畫",
    "2",
    ["", "", "", "male_glasses"],
    1,
  );
  const maleOnly = new URL(app.requests[2]).searchParams;
  assert.equal(maleOnly.has("female"), false);
  assert.equal(maleOnly.get("male"), "male_glasses");
});

test("relamanhua empty, unknown and inapplicable tag filters do not reach the site", async () => {
  const app = plugin();
  for (const [type, options] of [
    ["2", []],
    ["2", ["", "updated", "", ""]],
    ["2", ["", "updated", "unknown", "%broken"]],
    ["1", ["gedou", "updated", "female_glasses", "male_glasses"]],
  ]) {
    await app.source.categoryComics.load("", type, options, 1);
    const query = new URL(app.requests.at(-1)).searchParams;
    assert.equal(query.has("female"), false);
    assert.equal(query.has("male"), false);
  }
});

test("relamanhua login sends the documented payload and stores the token", async () => {
  const app = plugin();
  const profile = await app.source.account.login("hazuki-user", "p@ss word");

  assert.equal(app.posts.length, 1);
  const post = app.posts[0];
  assert.match(post.url, /\/api\/v1\/login$/);
  assert.match(
    post.headers["Content-Type"],
    /application\/x-www-form-urlencoded/,
  );

  const params = new URLSearchParams(post.body);
  assert.equal(params.get("username"), "hazuki-user");
  assert.equal(params.get("platform"), "2");
  assert.equal(params.get("version"), "2025.12.10");
  const salt = params.get("salt");
  assert.match(
    salt,
    /^\d{6}$/,
    "a six digit salt is sent alongside the password",
  );
  // The site signs in with Base64(password + "-" + salt).
  assert.equal(
    Buffer.from(params.get("password"), "base64").toString("utf8"),
    "p@ss word-" + salt,
  );

  assert.equal(app.storage.get("token"), "test-token");
  assert.equal(profile.token, "test-token");
  assert.equal(profile.displayName, "Hazuki 測試");
  // A relative avatar path is resolved against the asset host.
  assert.equal(
    profile.avatarUrl,
    "https://s3.mangafunb.fun/user/cover/9d480f50/1652459942.jpg",
  );
});

test("relamanhua login surfaces the server message and keeps no token", async () => {
  const app = plugin({
    login: { status: 400, body: '{"detail":"錯誤的密碼."}' },
  });
  await assert.rejects(
    () => app.source.account.login("someone", "wrong"),
    /登录失败：錯誤的密碼\./,
  );
  assert.equal(app.storage.get("token"), undefined);
  await assert.rejects(() => app.source.account.login("", "x"), /请输入账号/);
  await assert.rejects(
    () => app.source.account.login("user", ""),
    /请输入密码/,
  );
});

test("relamanhua loadProfile uses the token and clears it on logout", async () => {
  const app = plugin();
  sameValues(
    await app.source.account.loadProfile(),
    {},
    "no token means no profile",
  );

  await app.source.account.login("hazuki-user", "secret");
  const profile = await app.source.account.loadProfile();
  assert.equal(profile.displayName, "Hazuki 測試");
  assert.equal(
    profile.avatarUrl,
    "https://s3.mangafunb.fun/user/cover/9d480f50/1652459942.jpg",
  );
  const infoRequest = app.requests.find((url) =>
    url.includes("/api/v2/web/user/info"),
  );
  assert.ok(infoRequest, "profile request must be issued");

  await app.source.account.logout();
  assert.equal(app.storage.get("token"), undefined);
  assert.match(app.posts[1].url, /\/api\/v1\/logout$/);
});

test("relamanhua logout clears the token even when the server call fails", async () => {
  const app = plugin({ logoutThrows: true });
  await app.source.account.login("hazuki-user", "secret");
  assert.equal(app.storage.get("token"), "test-token");
  await app.source.account.logout();
  assert.equal(
    app.storage.get("token"),
    undefined,
    "local sign-out must still succeed",
  );
});

const COMIC_UUID = "4caadd62-4efd-11e9-8b1c-024352452ce0";
const CHAPTER_UUID = "fd1b3104-c2d4-11f1-b213-fa163e02432f";

test("relamanhua ranking pages the JSON ranks API", async () => {
  const app = plugin();
  const ranking = app.source.categoryComics.ranking;
  assert.equal(ranking.options.length, 8, "free/paid by day/week/month/total");
  // The host splits each option on the first dash into value and label, so a
  // value must never contain one.
  for (const option of ranking.options) {
    const value = option.slice(0, option.indexOf("-"));
    assert.ok(
      value && !value.includes("-"),
      "unusable option value: " + option,
    );
  }
  sameValues(
    ranking.options.slice(0, 2),
    ["1d-免費日榜", "1w-免費週榜"],
    "rank option encoding",
  );

  const first = await ranking.load("1d", 1);
  assert.equal(first.comics.length, 20);
  assert.ok(first.comics.every((comic) => comic.subTitle === undefined));
  assert.ok(
    first.maxPage > 1,
    "the ranking must paginate, got maxPage=" + first.maxPage,
  );
  assert.equal(first.comics[0].id, "naoodngxueshenghui");
  assert.equal(first.comics[0].title, "腦洞學生會");
  assert.match(first.comics[0].cover, /^https:\/\//);
  assert.match(
    app.requests[0],
    /\/api\/v3\/ranks\?type=1&date_type=day&limit=20&offset=0/,
  );

  await ranking.load("1d", 2);
  assert.match(app.requests[1], /offset=20/);

  await ranking.load("2t", 1);
  assert.match(app.requests[2], /type=2&date_type=total/);
});

test("relamanhua catalogue sort aliases survive the host's dash split", async () => {
  const app = plugin();
  const sortGroup = app.source.categoryComics.optionList[1];
  for (const option of sortGroup.options) {
    const value = option.slice(0, option.indexOf("-"));
    assert.ok(
      ["updated", "popular", "oldest"].includes(value),
      "sort option must carry a dash-free alias, got: " + option,
    );
  }

  await app.source.categoryComics.load(undefined, "1", ["gedou", "popular"], 1);
  assert.match(
    app.requests[0],
    /ordering=-popular/,
    "the chosen sort must reach the site",
  );
  assert.match(app.requests[0], /theme=gedou/);

  await app.source.categoryComics.load(undefined, "1", ["", "oldest"], 1);
  assert.match(app.requests[1], /ordering=datetime_updated/);
});

test("relamanhua favorites list the shelf and toggle a comic", async () => {
  const app = plugin();
  await app.source.account.login("hazuki-user", "secret");

  const page = await app.source.favorites.loadComics(1);
  assert.equal(page.comics.length, 3, "rack items nest their comic object");
  assert.equal(page.comics[0].id, "naoodngxueshenghui");
  assert.match(page.comics[0].cover, /^https:\/\//);
  assert.equal(page.maxPage, 1);
  assert.match(
    app.requests.at(-1),
    /\/api\/v3\/member\/collect\/comics\?free_type=1&limit=30&offset=0/,
  );

  await app.source.favorites.addOrDelFavorite("yiquanchaoren", null, true);
  const added = app.posts.at(-1);
  assert.match(added.url, /\/api\/v3\/member\/collect\/comic$/);
  assert.match(added.headers["Content-Type"], /x-www-form-urlencoded/);
  const addParams = new URLSearchParams(added.body);
  assert.equal(
    addParams.get("comic_id"),
    COMIC_UUID,
    "collect keys on the comic uuid",
  );
  assert.equal(addParams.get("is_collect"), "1");

  await app.source.favorites.addOrDelFavorite("yiquanchaoren", null, false);
  assert.equal(
    new URLSearchParams(app.posts.at(-1).body).get("is_collect"),
    "0",
  );

  // The path_word -> uuid lookup is resolved once and then remembered.
  const lookups = app.requests.filter((url) =>
    /\/api\/v3\/comic\/yiquanchaoren$/.test(url),
  );
  assert.equal(
    lookups.length,
    1,
    "the uuid must be cached, saw " + lookups.length + " lookups",
  );
});

test("relamanhua favorites need a session", async () => {
  const app = plugin();
  await assert.rejects(
    () => app.source.favorites.loadComics(1),
    /请先登录账号/,
  );
  await assert.rejects(
    () => app.source.favorites.addOrDelFavorite("yiquanchaoren", null, true),
    /请先登录账号/,
  );
});

test("relamanhua comments degrade to an empty list when the route is absent", async () => {
  const app = plugin();
  await app.source.account.login("hazuki-user", "secret");

  const comments = await app.source.comic.loadComments(
    "yiquanchaoren",
    null,
    1,
    null,
  );
  sameValues(
    comments,
    { comments: [], maxPage: 1 },
    "absent comment route yields an empty page",
  );
  assert.match(
    app.requests.at(-1),
    new RegExp("/api/v3/comments\\?comic_id=" + COMIC_UUID),
  );

  const roasts = await app.source.comic.loadChapterComments(
    "yiquanchaoren",
    CHAPTER_UUID,
    1,
    null,
  );
  sameValues(
    roasts,
    { comments: [], maxPage: 1 },
    "absent roast route yields an empty page",
  );
  assert.match(
    app.requests.at(-1),
    new RegExp("/api/v3/roasts\\?chapter_id=" + CHAPTER_UUID),
  );

  await assert.rejects(
    () => app.source.comic.sendComment("yiquanchaoren", null, "hello", null),
    /暂未开放发表评论功能/,
  );
  await assert.rejects(
    () =>
      app.source.comic.sendChapterComment(
        "yiquanchaoren",
        CHAPTER_UUID,
        "hello",
      ),
    /暂未开放发表评论功能/,
  );
});

test("relamanhua comments read without a session but posting needs one", async () => {
  const app = plugin();
  // Reading is public: no token, the route is absent, so the page stays empty.
  const comments = await app.source.comic.loadComments(
    "yiquanchaoren",
    null,
    1,
    null,
  );
  sameValues(
    comments,
    { comments: [], maxPage: 1 },
    "an anonymous reader must not be blocked or crashed",
  );

  await assert.rejects(
    () => app.source.comic.sendComment("yiquanchaoren", null, "hello", null),
    /请先登录账号/,
  );
  await assert.rejects(
    () => app.source.comic.sendComment("", null, "", null),
    /评论内容不能为空/,
  );
});

test("relamanhua sends the session token on reads so paid unlocks apply", async () => {
  const app = plugin();
  await app.source.account.login("hazuki-user", "secret");

  await app.source.comic.loadEp("yiquanchaoren", CHAPTER_UUID);
  const readerIndex = app.requests.findIndex((url) =>
    /\/comic\/yiquanchaoren\/chapter\//.test(url),
  );
  assert.ok(readerIndex >= 0, "the reader must be requested");
  assert.match(
    String(app.requestHeaders[readerIndex].Authorization),
    /^Token test-token$/,
    "the reader request must carry the session, otherwise the site serves the guest trial",
  );

  await app.source.comic.loadInfo("yiquanchaoren");
  const detailIndex = app.requests.findIndex((url) =>
    /\/comic\/yiquanchaoren$/.test(url),
  );
  assert.ok(detailIndex >= 0);
  assert.match(
    String(app.requestHeaders[detailIndex].Authorization),
    /^Token test-token$/,
  );
});

test("relamanhua falls back to an anonymous read when the token is stale", async () => {
  const app = plugin({ staleToken: true });
  await app.source.account.login("hazuki-user", "secret");
  const result = await app.source.comic.loadEp("yiquanchaoren", CHAPTER_UUID);
  assert.equal(
    result.images.length,
    14,
    "the anonymous retry must still load the chapter",
  );
  const readerCalls = app.requests.filter((url) =>
    /\/comic\/yiquanchaoren\/chapter\//.test(url),
  );
  assert.equal(
    readerCalls.length,
    2,
    "one authenticated attempt, then the anonymous retry",
  );
});

test("relamanhua loadInfo reports the collect state and the trial lock", async () => {
  // Only the /api/v3/comic/<id> response differs per title here; the rendered
  // page and chapter fixtures are shared.
  const plain = plugin();
  const info = await plain.source.comic.loadInfo("yiquanchaoren");
  assert.equal(
    info.isFavorite,
    false,
    "an uncollected comic must report false",
  );
  assert.ok(!(info.tags["状态"] || []).includes("付費試看"));
  assert.ok(!info.infoFields[4].values.includes("付費試看"));

  const collected = plugin();
  const collectedInfo =
    await collected.source.comic.loadInfo("naoodngxueshenghui");
  assert.equal(
    collectedInfo.isFavorite,
    true,
    "a collected comic must report true",
  );

  const locked = plugin();
  const lockedInfo = await locked.source.comic.loadInfo("yokubounohako");
  assert.ok(
    (lockedInfo.tags["状态"] || []).includes("付費試看"),
    "a title the site locks to a trial must be flagged",
  );
  assert.ok(lockedInfo.infoFields[4].values.includes("付費試看"));
  assert.ok(lockedInfo.headerStats[0].text.includes("付費試看"));
});

test("relamanhua toggling updates the cached favourite state", async () => {
  const app = plugin();
  await app.source.account.login("hazuki-user", "secret");

  const before = await app.source.comic.loadInfo("yiquanchaoren");
  assert.equal(before.isFavorite, false);

  await app.source.favorites.addOrDelFavorite("yiquanchaoren", "shelf", true);
  const after = await app.source.comic.loadInfo("yiquanchaoren");
  assert.equal(
    after.isFavorite,
    true,
    "the detail page must reflect the new state",
  );

  const folders = await app.source.favorites.loadFolders("yiquanchaoren");
  sameValues(
    folders.favorited,
    ["shelf"],
    "membership follows the toggle using the plugin folder ID",
  );

  await app.source.favorites.addOrDelFavorite("yiquanchaoren", "shelf", false);
  const removed = await app.source.favorites.loadFolders("yiquanchaoren");
  sameValues(
    removed.favorited,
    [],
    "removing from the shelf clears membership",
  );
  assert.equal(
    (await app.source.comic.loadInfo("yiquanchaoren")).isFavorite,
    false,
  );
});

test("relamanhua loadFolders uses a plugin folder ID and reports membership", async () => {
  const app = plugin();
  sameValues(
    await app.source.favorites.loadFolders(null),
    { folders: { shelf: "書架" } },
    "no comic means folders only",
  );

  const member = await app.source.favorites.loadFolders("naoodngxueshenghui");
  sameValues(
    member.favorited,
    ["shelf"],
    "a collected comic reports the plugin folder ID",
  );

  const outsider = await app.source.favorites.loadFolders("yiquanchaoren");
  assert.equal(
    outsider.favorited.length,
    0,
    "an uncollected comic reports no folder",
  );
});

test("relamanhua reads still work when the host offers no storage", async () => {
  // Reading must degrade to anonymous rather than fail on an optional token.
  const app = plugin({ noStorage: true });
  const search = await app.source.search.load("一拳超人", [], 1);
  assert.equal(search.comics.length, 11);
  const chapter = await app.source.comic.loadEp("yiquanchaoren", CHAPTER_UUID);
  assert.equal(chapter.images.length, 14);
});
