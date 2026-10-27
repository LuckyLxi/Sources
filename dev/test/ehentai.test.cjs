const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { HtmlDocument } = require("./helpers/mini_dom.cjs");

const ROOT = path.resolve(__dirname, "../..");
const EH = "https://e-hentai.org";
const EX = "https://exhentai.org";
const FORUM = "https://forums.e-hentai.org";
const ID = "12345/abcdef1234";
const fixture = (name) =>
  fs.readFileSync(
    path.join(__dirname, "fixtures/ehentai", name + ".html"),
    "utf8",
  );
const plain = (value) => JSON.parse(JSON.stringify(value));
const response = (body, status = 200) => ({ body, status, headers: {} });

function plugin(respond = () => response(fixture("list"))) {
  let source;
  let now = 0;
  const requests = [];
  const documents = [];
  const jar = new Map();
  const settings = new Map();
  class PluginDate extends Date {
    static now() {
      return now;
    }
  }
  const cookieApi = {
    get: async (url) => jar.get(new URL(url).origin) || [],
    set: async (url, cookies) => {
      const origin = new URL(url).origin;
      const saved = jar.get(origin) || [];
      jar.set(origin, [
        ...saved.filter(
          (cookie) => !cookies.some((c) => c.name === cookie.name),
        ),
        ...cookies,
      ]);
    },
    delete: async (url) => {
      jar.delete(new URL(url).origin);
    },
  };
  const context = vm.createContext({
    Date: PluginDate,
    Hazuki: {
      registerSource: (value) => {
        source = value;
      },
      settings: { get: (key) => settings.get(key) },
      cookies: cookieApi,
      error: (code, message) => Object.assign(new Error(message), { code }),
      delay: async (ms) => {
        now += ms;
      },
      http: {
        get: async (url, headers) => {
          const entry = { method: "GET", url, headers, startedAt: now };
          requests.push(entry);
          return { ...(await respond(entry)), url };
        },
        post: async (url, headers, body, extra) => {
          const entry = {
            method: "POST",
            url,
            headers,
            body,
            extra,
            startedAt: now,
          };
          requests.push(entry);
          return { ...(await respond(entry)), url };
        },
      },
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
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "ehentai.js"), "utf8"),
    context,
  );
  return {
    source,
    requests,
    documents,
    settings,
    jar,
    cookieApi,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("imports without host data access or networking; direct lookup requires a token", () => {
  const { source, requests } = plugin();
  assert.equal(source.id, "ehentai");
  assert.equal(source.version, "1.0.1");
  assert.equal(source.apiVersion, 1);
  assert.equal(requests.length, 0);
  const patterns = source.presentation.directComicIdRules.patterns.map(
    (p) => new RegExp(p, "i"),
  );
  for (const input of [
    ID,
    EH + "/g/" + ID + "/",
    EX + "/g/" + ID + "/?p=2#top",
  ])
    assert.equal(patterns.map((p) => p.exec(input)?.[1]).find(Boolean), ID);
  for (const input of [
    "12345",
    "https://evil.test/g/" + ID + "/",
    EH + ".evil.test/g/" + ID + "/",
  ])
    assert.ok(patterns.every((p) => !p.test(input)));
});

test("initializes only website preference cookies and preserves credentials", async () => {
  const { source, requests, jar, cookieApi } = plugin();
  await cookieApi.set(EH, [{ name: "ipb_member_id", value: "42" }]);
  await source.init();
  assert.equal(jar.get(EH).find((c) => c.name === "ipb_member_id").value, "42");
  for (const origin of [EH, EX]) {
    assert.equal(jar.get(origin).find((c) => c.name === "nw").value, "1");
    assert.equal(jar.get(origin).find((c) => c.name === "datatags").value, "1");
  }
  assert.equal(requests.length, 0);
});

test("search extracts list metadata, lazy covers and tags and uses next-gid pagination", async () => {
  const { source, requests, documents } = plugin(({ url }) =>
    response(
      fixture(new URL(url).searchParams.has("next") ? "list-next" : "list"),
    ),
  );
  const first = await source.search.load(
    'language:"english$" test & sample',
    [],
    1,
  );
  assert.equal(first.maxPage, null);
  assert.deepEqual(plain(first.comics[0]), {
    id: ID,
    title: "Sample Gallery",
    cover: "https://ehgt.org/test-cover.jpg",
    subTitle: "Non-H",
    tags: ["Non-H", "language:english", "artist:sample artist"],
  });
  const route = new URL(requests[0].url);
  assert.equal(
    route.searchParams.get("f_search"),
    'language:"english$" test & sample',
  );
  assert.equal(route.searchParams.get("inline_set"), "dm_e");
  const second = await source.search.load(
    'language:"english$" test & sample',
    [],
    2,
  );
  assert.equal(second.maxPage, 2);
  assert.equal(second.comics[0].id, "12340/123456abcd");
  assert.equal(new URL(requests[1].url).searchParams.get("next"), "12344");
  assert.equal(new URL(requests[1].url).searchParams.has("page"), false);
  assert.deepEqual(
    plain(await source.search.load('language:"english$" test & sample', [], 3)),
    { comics: [], maxPage: 2 },
  );
  assert.equal(requests.length, 2);
  assert.ok(documents.every((doc) => doc.disposed));
  assert.ok(requests[1].startedAt - requests[0].startedAt >= 500);
});

test("cursor state is isolated by query and site; jumping reconstructs missing cursors", async () => {
  const { source, settings, requests } = plugin(({ url }) =>
    response(
      fixture(new URL(url).searchParams.has("next") ? "list-next" : "list"),
    ),
  );
  const result = await source.search.load("jump", [], 2);
  assert.equal(result.comics[0].title, "Next Gallery");
  assert.equal(requests.length, 2);
  await source.search.load("different", [], 2);
  assert.equal(requests.length, 4);
  settings.set("site", "ex");
  await source.search.load("jump", [], 2);
  assert.equal(requests.length, 6);
  assert.equal(new URL(requests[4].url).origin, EX);
  assert.equal(new URL(requests[4].url).searchParams.has("next"), false);
});

test("refresh discards stale cursors and terminal state", async () => {
  let end = false;
  const { source, requests } = plugin(({ url }) =>
    response(
      fixture(
        end || new URL(url).searchParams.has("next") ? "list-next" : "list",
      ),
    ),
  );
  await source.search.load("sample", [], 2);
  end = true;
  assert.equal((await source.search.load("sample", [], 1)).maxPage, 1);
  assert.deepEqual(plain(await source.search.load("sample", [], 2)), {
    comics: [],
    maxPage: 1,
  });
  assert.equal(requests.length, 3);
});

for (const layout of ["minimal", "compact", "thumbnails"]) {
  test("parses website " + layout + " list layout", async () => {
    const { source } = plugin(() => response(fixture("list-" + layout)));
    const result = await source.explore[0].load(1);
    assert.equal(result.maxPage, 1);
    assert.equal(result.comics[0].id, ID);
    assert.equal(result.comics[0].title, "Sample Gallery");
    assert.equal(result.comics[0].cover, "https://ehgt.org/test-cover.jpg");
    assert.equal(result.comics[0].subTitle, "Non-H");
  });
}

test("empty results are distinct from blocked or changed pages", async () => {
  for (const html of [
    "<html><body>No hits found</body></html>",
    '<html><body><table class="itg"></table>No unfiltered results found</body></html>',
  ]) {
    const { source } = plugin(() => response(html));
    assert.deepEqual(plain(await source.search.load("empty", [], 1)), {
      comics: [],
      maxPage: 1,
    });
  }
  const { source, documents } = plugin(() =>
    response("<html><body>Please log in</body></html>"),
  );
  await assert.rejects(
    source.search.load("blocked", [], 1),
    /访问权限或登录状态/,
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("category filters exclude other category bits and popular uses its own path", async () => {
  const { source, requests } = plugin(() => response(fixture("list-next")));
  await source.categoryComics.load("非成人", "256", [], 1);
  assert.equal(new URL(requests[0].url).searchParams.get("f_cats"), "767");
  await source.explore[1].load(1);
  assert.equal(new URL(requests[1].url).pathname, "/popular");
  assert.throws(
    () => source.categoryComics.load("unknown", "9999", [], 1),
    /无效的分类/,
  );
});

test("details expose metadata and namespaced search expressions without author subtitles", async () => {
  const { source, requests, documents } = plugin(() =>
    response(fixture("detail")),
  );
  const detail = await source.comic.loadInfo(EH + "/g/" + ID + "/?p=1");
  assert.equal(detail.id, ID);
  assert.equal(detail.title, "Sample Gallery");
  assert.equal(detail.cover, "https://ehgt.org/test-cover.jpg");
  assert.equal(detail.pageCount, 4);
  assert.equal(detail.updateTime, "2026-10-01 12:00");
  assert.equal(detail.uploader, "Sample Uploader");
  assert.equal(detail.subTitle, undefined);
  assert.deepEqual(plain(detail.chapters), { [ID]: "画廊（4 页）" });
  assert.deepEqual(plain(detail.tags), {
    language: ["english"],
    artist: ["sample artist"],
    temp: ["sample tag"],
  });
  assert.deepEqual(plain(detail.infoFields.find((f) => f.label === "artist")), {
    label: "artist",
    values: ['artist:"sample artist$"'],
    action: "search",
  });
  assert.deepEqual(plain(detail.headerStats), [
    { text: "4 页" },
    { text: "Average: 4.50" },
  ]);
  assert.equal(requests[0].url, EH + "/g/" + ID + "/");
  assert.ok(documents.every((doc) => doc.disposed));
});

test("reader gathers all thumbnail pages in numeric order without requesting image pages", async () => {
  const { source, requests, documents } = plugin(({ url }) =>
    response(
      fixture(
        new URL(url).searchParams.get("p") === "1" ? "detail-next" : "detail",
      ),
    ),
  );
  const result = await source.comic.loadEp(ID, ID);
  assert.deepEqual(plain(result.images), [
    EH + "/s/aaaaaaaaaa/12345-1",
    EH + "/s/cccccccccc/12345-2",
    EH + "/s/dddddddddd/12345-3",
    EH + "/s/eeeeeeeeee/12345-4",
  ]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => !r.url.includes("/s/")));
  assert.ok(documents.every((doc) => doc.disposed));
});

test("reader rejects missing, duplicated and foreign image indices instead of returning partial chapters", async () => {
  for (const html of [
    fixture("detail-next").replace("12345-4", "12345-3"),
    fixture("detail-next").replace("12345-4", "99999-4"),
  ]) {
    const { source, documents } = plugin(({ url }) =>
      response(
        new URL(url).searchParams.get("p") === "1" ? html : fixture("detail"),
      ),
    );
    await assert.rejects(
      source.comic.loadEp(ID, ID),
      /索引不完整|索引与画廊不匹配/,
    );
    assert.ok(documents.every((doc) => doc.disposed));
  }
  const { source, requests } = plugin();
  await assert.rejects(
    source.comic.loadEp(ID, "99999/abcdef1234"),
    /章节与画廊不匹配/,
  );
  await assert.rejects(source.comic.loadInfo("12345"), /包含 token/);
  assert.equal(requests.length, 0);
});

test("image hook resolves on demand, reuses host rechecks and refreshes expiring URLs", async () => {
  const { source, requests, documents, advance } = plugin(() =>
    response(
      fixture("image").replace(
        "actual-page.jpg",
        "actual-" + requests.length + ".jpg",
      ),
    ),
  );
  const page = EH + "/s/aaaaaaaaaa/12345-1";
  const image = await source.comic.onImageLoad(page, ID, ID);
  assert.deepEqual(plain(image), {
    url: "https://image.example.test/h/actual-1.jpg",
    headers: { Referer: page },
  });
  assert.equal((await source.comic.onImageLoad(page, ID, ID)).url, image.url);
  assert.equal(requests.length, 1);
  advance(60001);
  assert.equal(
    (await source.comic.onImageLoad(page, ID, ID)).url,
    "https://image.example.test/h/actual-2.jpg",
  );
  assert.deepEqual(
    plain(
      await source.comic.onImageLoad("https://ehgt.org/test-cover.jpg", "", ""),
    ),
    { headers: { Referer: EH + "/" } },
  );
  assert.equal(requests.length, 2);
  await assert.rejects(
    source.comic.onImageLoad(page, "99999/abcdef1234", ID),
    /图片链接与画廊不匹配/,
  );
  assert.ok(documents.every((doc) => doc.disposed));
});

test("quota images, multipage viewer and website failures produce actionable errors", async () => {
  for (const [body, status, message] of [
    [
      fixture("image").replace(
        "https://image.example.test/h/actual-page.jpg",
        "https://ehgt.org/g/509.gif",
      ),
      200,
      /配额/,
    ],
    [
      '<html><body><div id="pane_images"></div></body></html>',
      200,
      /关闭多页查看器/,
    ],
    ["You have exceeded your image viewing limits", 200, /配额/],
    ["Your IP address has been temporarily banned", 200, /IP/],
    ["", 509, /配额/],
    ["Access denied", 403, /HTTP 403/],
  ]) {
    const { source, documents } = plugin(() => response(body, status));
    await assert.rejects(
      source.comic.onImageLoad(EH + "/s/aaaaaaaaaa/12345-1", ID, ID),
      message,
    );
    assert.ok(documents.every((doc) => doc.disposed));
  }
});

test("Cookie login uses the host cookie jar and verifies the authenticated forum identity", async () => {
  const { source, jar, requests } = plugin(() => response(fixture("profile")));
  const profile = await source.account.login("", "", {
    method: "cookie",
    requestText: async () =>
      "ipb_member_id=42; ipb_pass_hash=synthetic-test-hash; igneous=synthetic-test-igneous; irrelevant=discard",
  });
  assert.deepEqual(plain(profile), { displayName: "Sample Nickname" });
  assert.equal(requests[0].url, FORUM + "/index.php?showuser=42");
  assert.equal(
    jar.get(EX).find((c) => c.name === "igneous").value,
    "synthetic-test-igneous",
  );
  assert.ok(
    !jar.get(EH).some((c) => c.name === "igneous" || c.name === "irrelevant"),
  );
  assert.equal(jar.get(FORUM).length, 2);
  await source.account.logout();
  assert.ok(!jar.has(FORUM));
  assert.ok(jar.get(EH).every((c) => c.name === "nw" || c.name === "datatags"));
  await assert.rejects(source.account.loadProfile(), { code: "AUTH_EXPIRED" });
});

test("browser login explicitly imports website credentials and still validates the session", async () => {
  const { source, cookieApi, documents } = plugin(() =>
    response(fixture("profile")),
  );
  let options;
  const profile = await source.account.login("", "", {
    method: "browser",
    requestBrowserAuthorization: async (value) => {
      options = value;
      await cookieApi.set(EH, [
        { name: "ipb_member_id", value: "42" },
        { name: "ipb_pass_hash", value: "synthetic-test-hash" },
      ]);
      return { status: "completed", url: EH + "/" };
    },
  });
  assert.equal(profile.displayName, "Sample Nickname");
  assert.equal(options.url, EH + "/home.php");
  assert.equal(options.completion, "manual");
  assert.deepEqual(plain(options.cookieScopes), [
    { url: EH + "/", names: ["ipb_member_id", "ipb_pass_hash"] },
  ]);
  assert.ok(documents.every((doc) => doc.disposed));
});

test("password login uses native credentials, live hidden fields and the forum POST endpoint", async () => {
  let cookieApi;
  const harness = plugin(async ({ method, url, body, headers, extra }) => {
    if (method === "POST") {
      assert.equal(url, FORUM + "/index.php?act=Login&CODE=01");
      const fields = new URLSearchParams(body);
      assert.equal(fields.get("UserName"), "test & 账号+");
      assert.equal(fields.get("PassWord"), "synthetic-p&a=ss+");
      assert.equal(fields.get("CookieDate"), "1");
      assert.equal(fields.get("b"), "d");
      assert.equal(fields.get("bt"), "1-1");
      assert.equal(fields.get("ipb_login_submit"), "Login!");
      assert.equal(
        headers["Content-Type"],
        "application/x-www-form-urlencoded",
      );
      assert.equal(headers.Referer, EH + "/home.php");
      assert.equal(extra.followRedirects, false);
      // Emulate the host saving the response Set-Cookie headers before returning.
      await cookieApi.set(FORUM, [
        { name: "ipb_member_id", value: "42" },
        { name: "ipb_pass_hash", value: "synthetic-test-hash" },
      ]);
      return response("", 302);
    }
    return response(
      fixture(new URL(url).pathname === "/home.php" ? "login-form" : "profile"),
    );
  });
  cookieApi = harness.cookieApi;
  assert.equal(harness.source.account.loginMethods[0].id, "password");
  assert.equal(harness.source.account.loginMethods[0].input, "credentials");
  const profile = await harness.source.account.login(
    "test & 账号+",
    "synthetic-p&a=ss+",
    { method: "password" },
  );
  assert.equal(profile.displayName, "Sample Nickname");
  assert.equal(harness.requests.length, 3);
  for (const origin of [EH, EX])
    assert.equal(
      harness.jar.get(origin).find((c) => c.name === "ipb_member_id").value,
      "42",
    );
  assert.ok(harness.documents.every((doc) => doc.disposed));
});

test("password login never reports success just because the HTTP POST succeeded", async () => {
  for (const [result, message] of [
    [response("Invalid username or password"), /账号登录失败/],
    [response("The captcha was not entered correctly"), /验证码/],
    [
      response(
        '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/"></script></html>',
        403,
      ),
      /Cloudflare/,
    ],
  ]) {
    const { source, requests } = plugin(({ method }) =>
      method === "POST" ? result : response(fixture("login-form")),
    );
    await assert.rejects(
      source.account.login("test", "synthetic-test-password", {
        method: "password",
      }),
      message,
    );
    assert.equal(requests.filter((r) => r.method === "POST").length, 1);
    assert.ok(
      requests.every((r) => !r.url.includes("synthetic-test-password")),
    );
  }
});

test("password login rejects missing inputs and changed form actions before submitting credentials", async () => {
  const { source, requests, documents } = plugin(() =>
    response(fixture("login-form").replace(FORUM, "https://untrusted.example")),
  );
  await assert.rejects(
    source.account.login("", "synthetic-test-password", { method: "password" }),
    /请输入账号和密码/,
  );
  assert.equal(requests.length, 0);
  await assert.rejects(
    source.account.login("test", "synthetic-test-password", {
      method: "password",
    }),
    /无法识别账号登录表单/,
  );
  assert.equal(requests.filter((r) => r.method === "POST").length, 0);
  assert.ok(documents.every((doc) => doc.disposed));
});

test("account changes remove old ExHentai credentials instead of mixing two sessions", async () => {
  const { source, jar, cookieApi } = plugin(() => response(fixture("profile")));
  await cookieApi.set(EX, [
    { name: "ipb_member_id", value: "99" },
    { name: "ipb_pass_hash", value: "synthetic-old-account" },
    { name: "igneous", value: "synthetic-old-igneous" },
  ]);
  await source.account.login("", "", {
    method: "cookie",
    requestText: async () =>
      "ipb_member_id=42; ipb_pass_hash=synthetic-new-account",
  });
  assert.equal(jar.get(EX).find((c) => c.name === "ipb_member_id").value, "42");
  assert.ok(!jar.get(EX).some((c) => c.name === "igneous"));
});

test("changing site invalidates recently resolved image URLs", async () => {
  let imageRequests = 0;
  const { source, requests } = plugin(() => {
    imageRequests++;
    return response(fixture("image"));
  });
  const page = EH + "/s/aaaaaaaaaa/12345-1";
  await source.comic.onImageLoad(page, ID, ID);
  await source.settings.site.onChanged("ex");
  await source.comic.onImageLoad(page, ID, ID);
  assert.equal(imageRequests, 2);
  assert.equal(requests.length, 2);
});

test("bad cookies, expired or mismatched sessions and browser timeouts fail login", async () => {
  const invalid = plugin();
  await assert.rejects(
    invalid.source.account.login("", "", {
      method: "cookie",
      requestText: async () => "ipb_member_id=42",
    }),
    /缺少有效/,
  );
  assert.equal(invalid.requests.length, 0);
  for (const body of [
    "<html><body>Log in</body></html>",
    fixture("profile").replace("showuser=42", "showuser=43"),
  ]) {
    const { source, documents } = plugin(() => response(body));
    await assert.rejects(
      source.account.login("", "", {
        method: "cookie",
        requestText: async () =>
          "ipb_member_id=42; ipb_pass_hash=synthetic-test-hash",
      }),
      { code: "AUTH_EXPIRED" },
    );
    assert.ok(documents.every((doc) => doc.disposed));
  }
  await assert.rejects(
    invalid.source.account.login("", "", {
      method: "browser",
      requestBrowserAuthorization: async () => ({ status: "timeout" }),
    }),
    /超时/,
  );
});
