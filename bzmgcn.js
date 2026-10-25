/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

/*
 * Original Hazuki API v1 source for 包子漫画 (https://cn.bzmgcn.com/).
 * Written for this repository under GPL-3.0; see LICENSE. No site scripts copied.
 * Uses public AMP pages, /api/bzmhq/amp_comic_list and /api/bui/signin.
 */

const bzmgcnOrigin = "https://cn.bzmgcn.com";
const bzmgcnCoverOrigin = "https://static-tw.bzmgcn.com";
/** @type {Map<string, Promise<void>>} */
const bzmgcnVerifications = new Map();

const bzmgcnThemes = [
  ["all", "全部"],
  ["lianai", "恋爱"],
  ["chunai", "纯爱"],
  ["gufeng", "古风"],
  ["yineng", "异能"],
  ["xuanyi", "悬疑"],
  ["juqing", "剧情"],
  ["kehuan", "科幻"],
  ["qihuan", "奇幻"],
  ["xuanhuan", "玄幻"],
  ["chuanyue", "穿越"],
  ["mouxian", "冒险"],
  ["tuili", "推理"],
  ["wuxia", "武侠"],
  ["gedou", "格斗"],
  ["zhanzheng", "战争"],
  ["rexie", "热血"],
  ["gaoxiao", "搞笑"],
  ["danuzhu", "大女主"],
  ["dushi", "都市"],
  ["zongcai", "总裁"],
  ["hougong", "后宫"],
  ["richang", "日常"],
  ["hanman", "韩漫"],
  ["shaonian", "少年"],
  ["qita", "其它"],
];
const bzmgcnRegions = [
  ["all", "全部地区"],
  ["cn", "国漫"],
  ["jp", "日本"],
  ["kr", "韩国"],
  ["en", "欧美"],
];

/** @param {string} value */
function bzmgcnDecode(value) {
  // The host HTML parser decodes entities; this also covers href query strings.
  return value.replace(/&amp;/g, "&");
}

/** @param {string} value @param {string} [origin] */
function bzmgcnAbsolute(value, origin = bzmgcnOrigin) {
  const url = bzmgcnDecode(value.trim());
  if (url.startsWith("//")) return "https:" + url;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? origin + url : "";
}

/** @param {string} id */
function bzmgcnComicId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("包子漫画：无效的漫画 ID");
  return id;
}

/** @param {string} url */
function bzmgcnUrlOrigin(url) {
  const match = /^https:\/\/[^/?#]+/.exec(url);
  if (!match) throw new Error("包子漫画：无效的网站地址");
  return match[0];
}

/** @param {SourceHttpResponse<string>} response */
function bzmgcnIsChallenge(response) {
  return /"error"\s*:\s*"challenge_required"|window\.gatekeeperChallenge/.test(
    response.body,
  );
}

/** Import only the website's verification cookies and its browser UA.
 * @param {string} origin
 */
async function bzmgcnVerify(origin) {
  const pending = bzmgcnVerifications.get(origin);
  if (pending) return pending;
  const verification = (async () => {
    if (typeof Hazuki.ui?.openWebView !== "function")
      throw new Error("包子漫画需要浏览器验证，请升级到支持网页验证的宿主版本");
    const url = origin + "/__gatekeeper_challenge/start?return=%2F";
    const challenge = await Hazuki.http.get(url);
    const cookies = await Hazuki.cookies.get(origin + "/");
    const cookieHeaders = Object.entries(challenge.headers || {})
      .filter(([key]) => key.toLowerCase() === "set-cookie")
      .map(([, value]) => (Array.isArray(value) ? value.join(";") : value))
      .join(";");
    const match = /__Host-gk_browser_([a-f0-9]+)/.exec(
      cookieHeaders + ";" + cookies.map((cookie) => cookie.name).join(";"),
    );
    if (!match) throw new Error("包子漫画：无法读取网站验证 Cookie 名称");
    const result = await Hazuki.ui.openWebView({
      title: "包子漫画：验证通过后点击完成",
      url,
      completion: "manual",
      cookieScopes: [
        {
          url: origin + "/",
          names: [
            "__Host-gk_browser_" + match[1],
            "__Host-gk_clearance_" + match[1],
          ],
        },
      ],
    });
    if (result.status !== "completed")
      throw new Error("包子漫画：网站验证未完成，请重试");
    const response = await Hazuki.http.get(origin + "/");
    if (bzmgcnIsChallenge(response) || response.status !== 200)
      throw new Error("包子漫画：验证后仍无法访问网站，请重新验证");
  })();
  bzmgcnVerifications.set(origin, verification);
  try {
    await verification;
  } finally {
    bzmgcnVerifications.delete(origin);
  }
}

/** @param {string} url */
async function bzmgcnGet(url) {
  const headers = { Referer: bzmgcnOrigin + "/" };
  let response = await Hazuki.http.get(url, headers);
  if (bzmgcnIsChallenge(response)) {
    await bzmgcnVerify(bzmgcnUrlOrigin(url));
    response = await Hazuki.http.get(url, headers);
  }
  if (bzmgcnIsChallenge(response))
    throw new Error("包子漫画：网站验证已失效，请重试");
  if (response.status !== 200)
    throw new Error("包子漫画：请求失败（HTTP " + response.status + "）");
  return response.body;
}

/** Read the account's protected bookshelf, never the visitor's temporary shelf.
 * @returns {Promise<SourceComic[]>}
 */
async function bzmgcnLoadShelf() {
  const cookies = await Hazuki.cookies.get(bzmgcnOrigin + "/");
  if (!cookies.some((cookie) => cookie.name === "TSID" && cookie.value))
    throw Hazuki.error(
      "AUTH_EXPIRED",
      "包子漫画：未登录或会话已失效，请重新登录",
    );
  const doc = Hazuki.html.parse(
    await bzmgcnGet(bzmgcnOrigin + "/user/my_bookshelf"),
  );
  try {
    // An unauthenticated request redirects to /user/signin (HTTP 200 after
    // following the redirect). A temporary bookshelf is not a logged-in session.
    const signin = doc.querySelector("#mail") && doc.querySelector("#password");
    const anonymous = doc
      .querySelectorAll(".bookshelf a")
      .some((link) =>
        /\/user\/signin(?:[?#]|$)/.test(link.attributes.href || ""),
      );
    const temporary = /临时书架|臨時書架/.test(
      bzmgcnText(doc, ".bookshelf .pure-menu-selected"),
    );
    if (signin || anonymous || temporary)
      throw Hazuki.error("AUTH_EXPIRED", "包子漫画：登录已失效，请重新登录");
    const shelf = doc.querySelector(".bookshelf");
    if (!shelf)
      throw new Error("包子漫画：无法确认账号状态，书架页面格式已变化");
    const rows = shelf.querySelectorAll(".bookshelf-items");
    const comics = rows.map((row) => {
      const link = row.querySelector("h4 a");
      const match = /\/comic\/([a-zA-Z0-9_-]+)$/.exec(
        link?.attributes.href || "",
      );
      const title = (link?.text || "").replace(/\s+/g, " ").trim();
      const image = row.querySelector("amp-img");
      const cover = bzmgcnAbsolute(
        image?.attributes["data-src"] || image?.attributes.src || "",
      );
      if (!match || !title || !cover)
        throw new Error("包子漫画：书架条目格式已变化，无法读取收藏");
      return { id: match[1], title, cover };
    });
    if (!rows.length && !/没有追任何漫画|沒有追任何漫畫/.test(shelf.text))
      throw new Error("包子漫画：书架页面格式已变化，无法确认收藏是否为空");
    return comics;
  } finally {
    doc.dispose();
  }
}

/** @returns {Promise<SourceProfile>} */
async function bzmgcnLoadProfile() {
  await bzmgcnLoadShelf();
  const email = Hazuki.storage.get("accountEmail");
  return typeof email === "string" ? { displayName: email } : {};
}

/** @param {string} id @param {boolean} adding */
async function bzmgcnSetFavorite(id, adding) {
  bzmgcnComicId(id);
  // Repeating set_bookmark resets the site's reading position to chapter zero.
  const before = await bzmgcnLoadShelf();
  if (before.some((comic) => comic.id === id) === adding) return;
  await bzmgcnGet(
    bzmgcnOrigin +
      "/user/operation_v2?op=" +
      (adding ? "set_bookmark" : "del_bookmark") +
      "&comic_id=" +
      encodeURIComponent(id) +
      (adding ? "&chapter_slot=0" : ""),
  );
  const after = await bzmgcnLoadShelf();
  if (after.some((comic) => comic.id === id) !== adding)
    throw new Error("包子漫画：网站书架同步未生效，请刷新收藏后重试");
}

/** The site's signin script posts a form and stores result.data as TSID.
 * Explicit loginMethods ensure cookie writes are staged by the host until
 * protected-page validation succeeds; failures roll back the whole attempt.
 * @param {string} account @param {string} password
 * @param {SourceLoginContext | undefined} context
 * @returns {Promise<SourceProfile>}
 */
async function bzmgcnLogin(account, password, context) {
  if (!context || context.method !== "password")
    throw new Error("包子漫画：请从邮箱密码登录入口重新登录");
  const email = account.trim();
  if (!email) throw new Error("包子漫画：请输入邮箱");
  if (!password) throw new Error("包子漫画：请输入密码");
  const body =
    "username=" +
    encodeURIComponent(email) +
    "&password=" +
    encodeURIComponent(password);
  const send = () =>
    Hazuki.http.post(
      bzmgcnOrigin + "/api/bui/signin",
      {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: bzmgcnOrigin + "/user/signin",
        Origin: bzmgcnOrigin,
      },
      body,
    );
  let response = await send();
  if (bzmgcnIsChallenge(response)) {
    await bzmgcnVerify(bzmgcnOrigin);
    response = await send();
  }
  if (bzmgcnIsChallenge(response))
    throw new Error("包子漫画：网站验证已失效，请重试");
  if (response.status !== 200)
    throw new Error("包子漫画：登录请求失败（HTTP " + response.status + "）");
  /** @type {{result?: boolean; data?: unknown; code?: string}} */
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error("包子漫画：登录接口返回格式异常");
  }
  if (!data || data.result !== true) {
    /** @type {Record<string, string>} */
    const messages = {
      ERR_MAIL: "请输入正确的邮箱",
      ERR_PASSWORD: "密码错误",
      ERR_SIGNIN_NAME_OR_PASSWORD: "邮箱或密码错误",
      ERR_SIGNIN_VERIFY_CODE: "验证码错误，请前往网站确认账号状态",
      ERR_SIGNIN: "登录失败，请稍后重试",
    };
    throw new Error(
      "包子漫画：" + (messages[data?.code || ""] || "登录失败，请稍后重试"),
    );
  }
  if (typeof data.data !== "string" || !data.data.trim())
    throw new Error("包子漫画：登录接口未返回有效会话");
  await Hazuki.cookies.set(bzmgcnOrigin + "/", [
    {
      name: "TSID",
      value: data.data,
      domain: ".bzmgcn.com",
      path: "/",
      hostOnly: false,
      secure: true,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    },
  ]);
  await bzmgcnLoadProfile();
  await Hazuki.storage.set("accountEmail", email);
  return { displayName: email };
}

/** End the local account session without clearing website verification. */
async function bzmgcnLogout() {
  const cookies = await Hazuki.cookies.get(bzmgcnOrigin + "/");
  const sessions = cookies.filter((cookie) => cookie.name === "TSID");
  if (sessions.length)
    await Hazuki.cookies.set(
      bzmgcnOrigin + "/",
      sessions.map((cookie) => ({
        ...cookie,
        value: "",
        expiresAt: 0,
      })),
    );
  await Hazuki.storage.delete("accountEmail");
}

/** @param {HtmlDocument | HtmlElement} node @param {string} selector */
function bzmgcnText(node, selector) {
  return (node.querySelector(selector)?.text || "").replace(/\s+/g, " ").trim();
}

/** @param {HtmlDocument | HtmlElement} node @returns {SourceComic[]} */
function bzmgcnCards(node) {
  /** @type {SourceComic[]} */
  const comics = [];
  for (const card of node.querySelectorAll(".comics-card")) {
    const link = card.querySelector(".comics-card__poster");
    const match = /\/comic\/([a-zA-Z0-9_-]+)$/.exec(
      link?.attributes.href || "",
    );
    if (!match) continue; // Excludes the AMP mustache template.
    const title = bzmgcnText(card, ".comics-card__title");
    const cover = bzmgcnAbsolute(
      card.querySelector("amp-img")?.attributes.src || "",
    );
    if (!title || !cover) continue;
    const tags = card
      .querySelectorAll(".tab")
      .map((tag) => tag.text.trim())
      .filter(Boolean);
    /** @type {SourceComic} */
    const comic = { id: match[1], title, cover, tags };
    const subtitle = bzmgcnText(card, ".comics-card__info .tags");
    if (/^更新至/.test(subtitle)) comic.subTitle = subtitle;
    comics.push(comic);
  }
  return comics;
}

/** @param {HtmlDocument} doc @returns {SourceComic[]} */
function bzmgcnRecommendations(doc) {
  /** @type {SourceComic[]} */
  const comics = [];
  for (const card of doc.querySelectorAll(".recommend--item")) {
    if (!card.querySelector(".tag-comic")) continue;
    const link = card.querySelector("a");
    const match =
      /^https:\/\/(?:cn|www)\.bzmgcn\.com\/comic\/([a-zA-Z0-9_-]+)$/.exec(
        bzmgcnAbsolute(link?.attributes.href || ""),
      );
    const title = (link?.attributes.title || bzmgcnText(card, "span")).trim();
    const cover = bzmgcnAbsolute(
      card.querySelector("amp-img")?.attributes.src || "",
    );
    if (match && title && cover) comics.push({ id: match[1], title, cover });
  }
  return comics;
}

/** @param {string} html */
function bzmgcnHome(html) {
  const doc = Hazuki.html.parse(html);
  try {
    const sections = doc
      .querySelectorAll(".index-recommend-items")
      .map((node) => {
        /** @type {SourceExploreSection} */
        const section = {
          title: bzmgcnText(node, ".catalog-title"),
          comics: bzmgcnCards(node),
        };
        const more = node.querySelector(".catalog-head .more")?.attributes.href;
        if (more === "/classify")
          section.viewMore = "category:" + section.title + "@catalog";
        else if (more === "/list/new") section.viewMore = "explore:1";
        return section;
      })
      .filter((section) => section.title && section.comics.length);
    if (!sections.length) throw new Error("包子漫画：首页格式已变化");
    return sections;
  } finally {
    doc.dispose();
  }
}

/** @param {string} path @param {number} page @returns {Promise<ComicPage>} */
async function bzmgcnSingleList(path, page) {
  // Search and new arrivals render their entire result set in one response.
  if (page > 1) return { comics: [], maxPage: 1 };
  const doc = Hazuki.html.parse(await bzmgcnGet(bzmgcnOrigin + path));
  try {
    if (
      !doc.querySelector(".search") &&
      !doc.querySelector(".index-recommend-items")
    )
      throw new Error("包子漫画：列表页面格式已变化");
    return { comics: bzmgcnCards(doc), maxPage: 1 };
  } finally {
    doc.dispose();
  }
}

/** @param {string | null} param @param {string[]} options @param {number} page
 * @returns {Promise<ComicPage>}
 */
async function bzmgcnCatalog(param, options, page) {
  const [kind, value] = (param || "type:all").split(":");
  const type = kind === "type" && value !== "all" ? value : options[3] || "all";
  const region = kind === "region" ? value : options[0] || "all";
  const state = options[1] || "all";
  const filter = options[2] === "digits" ? "0-9" : options[2] || "*";
  const query = Object.entries({
    type,
    region,
    state,
    filter,
    page,
    limit: 36,
    language: "cn",
  })
    .map(([key, entry]) => key + "=" + encodeURIComponent(entry))
    .join("&");
  const body = await bzmgcnGet(
    bzmgcnOrigin + "/api/bzmhq/amp_comic_list?" + query,
  );
  /** @type {{items?: {comic_id: string; name: string; topic_img: string; type_names?: string[]}[]; next?: string}} */
  const data = JSON.parse(body);
  if (!Array.isArray(data.items)) throw new Error("包子漫画：分类数据格式异常");
  const comics = data.items.map((item) => ({
    id: item.comic_id,
    title: item.name,
    cover:
      bzmgcnAbsolute("/cover/" + item.topic_img, bzmgcnCoverOrigin) +
      "?w=285&h=375&q=100",
    tags: item.type_names || [],
  }));
  return data.next ? { comics } : { comics, maxPage: page };
}

/** @param {string} id @returns {Promise<SourceComicDetails>} */
async function bzmgcnLoadInfo(id) {
  const doc = Hazuki.html.parse(
    await bzmgcnGet(bzmgcnOrigin + "/comic/" + bzmgcnComicId(id)),
  );
  try {
    const title = bzmgcnText(doc, ".comics-detail__title");
    if (!title) throw new Error("包子漫画：未找到漫画详情");
    /** @type {Record<string, string>} */
    const chapters = {};
    // Long series have a forward directory plus a hidden continuation. Short
    // series only have the latest-chapters list, displayed in reverse order.
    let chapterLinks = [
      ...doc.querySelectorAll("#chapter-items .comics-chapters__item"),
      ...doc.querySelectorAll("#chapters_other_list .comics-chapters__item"),
    ];
    if (!chapterLinks.length)
      chapterLinks = doc.querySelectorAll(".comics-chapters__item").reverse();
    for (const chapter of chapterLinks) {
      const href = bzmgcnDecode(chapter.attributes.href || "");
      const section = /[?&]section_slot=(\d+)/.exec(href);
      const slot = /[?&]chapter_slot=(\d+)/.exec(href);
      if (section && slot)
        chapters[section[1] + "_" + slot[1]] = chapter.text.trim();
    }
    if (!Object.keys(chapters).length)
      throw new Error("包子漫画：未找到章节目录");
    const tags = doc
      .querySelectorAll(".tag-list .tag")
      .map((tag) => tag.text.trim())
      .filter(Boolean);
    const author = bzmgcnText(doc, ".comics-detail__author");
    const status = tags[0] || "";
    const region = tags[1] || "";
    const themes = tags.slice(2);
    return {
      id,
      title,
      cover: bzmgcnAbsolute(
        doc.querySelector(".de-info__box amp-img")?.attributes.src || "",
      ),
      description: bzmgcnText(doc, ".comics-detail__desc"),
      updateTime: bzmgcnText(doc, ".supporting-text em")
        .replace(/^\(|\)$/g, "")
        .trim(),
      chapters,
      recommend: bzmgcnRecommendations(doc),
      tags: {
        作者: author ? [author] : [],
        状态: status ? [status] : [],
        地区: region ? [region] : [],
        题材: themes,
      },
      headerStats: status ? [{ text: status }] : [],
      infoFields: [
        { label: "作者", values: author, action: "search" },
        { label: "状态", values: status },
        { label: "地区", values: region },
        { label: "题材", values: themes },
      ],
    };
  } finally {
    doc.dispose();
  }
}

/** @param {string} comicId @param {string} chapterId */
async function bzmgcnLoadEp(comicId, chapterId) {
  bzmgcnComicId(comicId);
  if (!/^\d+_\d+$/.test(chapterId)) throw new Error("包子漫画：无效的章节 ID");
  const chapterPath = "/comic/chapter/" + comicId + "/" + chapterId;
  let url = bzmgcnOrigin + chapterPath + ".html";
  const visited = new Set();
  const images = new Set();
  while (url) {
    if (visited.has(url)) throw new Error("包子漫画：章节分页发生循环");
    visited.add(url);
    const doc = Hazuki.html.parse(await bzmgcnGet(url));
    try {
      // Old search slugs can redirect to a renamed comic. Its continuation links
      // use the canonical slug, so compare against the actual reader page path.
      const canonical =
        doc
          .querySelectorAll("link")
          .find((link) => link.attributes.rel === "canonical")?.attributes
          .href || "";
      const canonicalPath =
        /^https:\/\/[^/]+(\/comic\/chapter\/[a-zA-Z0-9_-]+\/\d+_\d+)(?:_\d+)?\.html$/.exec(
          canonical,
        )?.[1];
      const currentChapterPath = canonicalPath?.endsWith("/" + chapterId)
        ? canonicalPath
        : chapterPath;
      const nodes = doc.querySelectorAll(".comic-contain .comic-contain__item");
      if (!nodes.length) throw new Error("包子漫画：未找到章节图片");
      for (const node of nodes) {
        const image = bzmgcnAbsolute(
          node.attributes["data-src"] || node.attributes.src || "",
        );
        if (!image) throw new Error("包子漫画：章节图片地址缺失");
        images.add(image);
      }
      url = "";
      // Follow only continuations of this chapter, never the next chapter or
      // the "previous page" link ending in #bottom on the final continuation.
      for (const link of doc.querySelectorAll(".next_chapter a")) {
        const next = bzmgcnAbsolute(link.attributes.href || "");
        const path = next.replace(/^https?:\/\/[^/]+/, "");
        if (
          path.startsWith(currentChapterPath + "_") &&
          /^_\d+\.html$/.test(path.slice(currentChapterPath.length))
        ) {
          url = next;
          break;
        }
      }
    } finally {
      doc.dispose();
    }
  }
  return { images: [...images] };
}

Hazuki.registerSource({
  id: "bzmgcn",
  name: "包子漫画",
  version: "1.3.0",
  apiVersion: 1,
  presentation: {
    buttons: [{ id: "relatedComics", location: "comicDetailTabs" }],
    listTagGroups: ["题材"],
    showTags: true,
    showComicStatus: true,
    refreshCloudFavorites: true,
    actions: [{ id: "verify", title: "重新进行网站验证" }],
  },
  actions: { verify: () => bzmgcnVerify(bzmgcnOrigin) },
  account: {
    loginMethods: [
      { id: "password", title: "邮箱密码登录", input: "credentials" },
    ],
    login: bzmgcnLogin,
    loadProfile: bzmgcnLoadProfile,
    logout: bzmgcnLogout,
  },
  favorites: {
    singleFolderForSingleComic: true,
    loadComics: async (page) => ({
      comics: page > 1 ? [] : await bzmgcnLoadShelf(),
      maxPage: 1,
    }),
    loadFolders: async (comicId) => {
      const folders = { shelf: "网站书架" };
      if (comicId === null) return { folders };
      const comics = await bzmgcnLoadShelf();
      return {
        folders,
        favorited: comics.some((comic) => comic.id === comicId)
          ? ["shelf"]
          : [],
      };
    },
    addOrDelFavorite: (comicId, _folderId, adding) =>
      bzmgcnSetFavorite(comicId, adding),
  },
  explore: [
    {
      title: "推荐",
      type: "multiPartPage",
      load: async () => bzmgcnHome(await bzmgcnGet(bzmgcnOrigin + "/")),
    },
    {
      title: "最新上架",
      type: "multiPageComicList",
      load: (page) => bzmgcnSingleList("/list/new", page),
    },
    {
      title: "漫画库",
      type: "multiPageComicList",
      load: (page) => bzmgcnCatalog("type:all", [], page),
    },
  ],
  category: {
    title: "分类",
    parts: [
      {
        name: "题材",
        itemType: "category",
        categories: bzmgcnThemes.map((item) => item[1]),
        categoryParams: bzmgcnThemes.map((item) => "type:" + item[0]),
      },
      {
        name: "地区",
        itemType: "category",
        categories: bzmgcnRegions.slice(1).map((item) => item[1]),
        categoryParams: bzmgcnRegions
          .slice(1)
          .map((item) => "region:" + item[0]),
      },
    ],
  },
  categoryComics: {
    optionList: [
      {
        label: "地区",
        options: bzmgcnRegions.map((item) => item.join("-")),
        notShowWhen: bzmgcnRegions.slice(1).map((item) => "region:" + item[0]),
      },
      {
        label: "状态",
        options: ["all-全部状态", "serial-连载中", "pub-已完结"],
      },
      {
        label: "首字母",
        options: [
          "*-全部",
          ...["ABCD", "EFGH", "IJKL", "MNOP", "QRST", "UVW", "XYZ"],
          "digits-0-9",
        ],
      },
      {
        label: "题材",
        options: bzmgcnThemes.map((item) => item.join("-")),
        notShowWhen: bzmgcnThemes.slice(1).map((item) => "type:" + item[0]),
      },
    ],
    load: (_category, param, options, page) =>
      bzmgcnCatalog(param, options, page),
  },
  search: {
    load: (keyword, _options, page) =>
      bzmgcnSingleList("/search?q=" + encodeURIComponent(keyword), page),
  },
  comic: {
    loadInfo: bzmgcnLoadInfo,
    loadEp: bzmgcnLoadEp,
    onImageLoad: (url) => ({
      headers: {
        Referer: url.startsWith(bzmgcnCoverOrigin + "/cover/")
          ? bzmgcnOrigin + "/"
          : "https://www.twbzmg.com/",
      },
    }),
  },
});
