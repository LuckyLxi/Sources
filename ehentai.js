/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

/*
 * E-Hentai / ExHentai, Hazuki API v1. Original adaptation under GPL-3.0.
 * Request and HTML parsing rules adapted from JHenTai by JTMonster
 * (jiangtian616) and contributors, licensed under Apache-2.0:
 * https://github.com/jiangtian616/JHenTai
 * lib/src/network/eh_request.dart, lib/src/utils/eh_spider_parser.dart,
 * lib/src/model/search_config.dart, lib/src/network/eh_cookie_manager.dart.
 * Changes: ported to standalone JavaScript and Hazuki host APIs; numbered
 * host pages use website cursors; reader image URLs resolve on demand.
 * The upstream license is included at the end of this file.
 */

const ehOrigins = ["https://e-hentai.org", "https://exhentai.org"];
const ehForum = "https://forums.e-hentai.org";
const ehCategories = [
  ["同人志", 2],
  ["漫画", 4],
  ["画师 CG", 8],
  ["游戏 CG", 16],
  ["西方", 512],
  ["非成人", 256],
  ["图集", 32],
  ["Cosplay", 64],
  ["亚洲写真", 128],
  ["其他", 1],
];
/** @type {Map<string, {cursors: Map<number, string>, lastPage?: number}>} */
const ehLists = new Map();
/** @type {Map<string, {config: ImageLoadConfig, expiresAt: number}>} */
const ehImageCache = new Map();
let ehNextRequest = 0;

function ehOrigin() {
  return Hazuki.settings.get("site") === "ex" ? ehOrigins[1] : ehOrigins[0];
}

/** @param {string} value */
function ehAbsolute(value) {
  if (value.startsWith("//")) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? ehOrigin() + value : "";
}

/** @param {string} value */
function ehGalleryMatch(value) {
  return /^(?:https?:\/\/(?:e-hentai|exhentai)\.org)?\/g\/(\d+)\/([a-z0-9]{10})\/?(?:[?#].*)?$/i.exec(
    value,
  );
}

/** IDs include the token: a numeric gid alone cannot open a gallery.
 * @param {string} id
 */
function ehGallery(id) {
  const match = /^(\d+)\/([a-z0-9]{10})$/i.exec(id) || ehGalleryMatch(id);
  if (!match) throw new Error("E-Hentai：请使用包含 token 的完整画廊链接或 ID");
  return { gid: match[1], id: match[1] + "/" + match[2] };
}

/** @param {string} url @param {string} [body] */
async function ehGet(url, body) {
  const now = Date.now();
  const start = Math.max(now, ehNextRequest);
  ehNextRequest = start + 500;
  if (start > now) await Hazuki.delay(start - now);
  const headers = { Referer: ehOrigin() + "/", "User-Agent": "Mozilla/5.0" };
  const response =
    body === undefined
      ? await Hazuki.http.get(url, headers)
      : await Hazuki.http.post(
          url,
          {
            ...headers,
            Referer: ehOrigins[0] + "/home.php",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          { followRedirects: false },
        );
  if (
    (response.status === 403 || response.status === 503) &&
    /challenge-platform|cf-chl-/i.test(response.body)
  )
    throw new Error(
      "E-Hentai：请求被 Cloudflare 安全验证拦截，请使用浏览器登录完成验证",
    );
  if (
    response.status === 509 ||
    /You have exceeded your image (?:viewing )?limits|exceeded your image viewing limit/i.test(
      response.body,
    )
  )
    throw new Error("E-Hentai：图片配额已用尽，请稍后再试");
  if (/Your IP address has been temporarily banned/i.test(response.body))
    throw new Error("E-Hentai：当前 IP 被网站临时限制，请稍后再试");
  if (
    response.status !== 200 &&
    !(body !== undefined && response.status >= 300 && response.status < 400)
  )
    throw new Error("E-Hentai：请求失败（HTTP " + response.status + "）");
  return response.body;
}

async function ehInit() {
  for (const origin of ehOrigins) {
    await Hazuki.cookies.set(origin + "/", [
      { name: "nw", value: "1", path: "/" },
      { name: "datatags", value: "1", path: "/" },
    ]);
  }
}

/** @param {HtmlDocument} doc @returns {SourceComic[]} */
function ehComics(doc) {
  const list = doc.querySelector(".itg");
  if (!list) {
    if (
      /No hits found|No unfiltered results found/i.test(
        doc.querySelector("body")?.text || "",
      )
    )
      return [];
    throw new Error("E-Hentai：无法读取画廊列表，请检查网站访问权限或登录状态");
  }
  /** @type {SourceComic[]} */
  const comics = [];
  const seen = new Set();
  for (const titleNode of list.querySelectorAll(".glink")) {
    let row = titleNode.parent;
    while (row && row.localName !== "tr" && !row.classNames.includes("gl1t"))
      row = row.parent;
    if (!row) throw new Error("E-Hentai：无法识别画廊列表格式");
    const link = row
      .querySelectorAll("a")
      .find((a) => ehGalleryMatch(a.attributes.href || ""));
    const match = ehGalleryMatch(link?.attributes.href || "");
    if (!match) throw new Error("E-Hentai：画廊链接缺失");
    const id = match[1] + "/" + match[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const img = row.querySelector("img");
    const category =
      row.querySelector(".cn")?.text.trim() ||
      row.querySelector(".cs")?.text.trim() ||
      "";
    const tags = [".gt", ".gtl", ".gtw"].flatMap((selector) =>
      row
        .querySelectorAll(selector)
        .map((tag) => tag.attributes.title || tag.text.trim()),
    );
    comics.push({
      id,
      title: titleNode.text.trim(),
      cover: ehAbsolute(
        img?.attributes["data-src"] || img?.attributes.src || "",
      ),
      subTitle: category,
      tags: [...new Set([category, ...tags].filter(Boolean))],
    });
  }
  if (
    !comics.length &&
    !/No hits found|No unfiltered results found/i.test(
      doc.querySelector("body")?.text || list.text,
    )
  )
    throw new Error("E-Hentai：画廊列表格式可能已变化");
  return comics;
}

/** The website uses next-gid cursors rather than numeric page parameters.
 * @param {string} path @param {number} page @returns {Promise<ComicPage>}
 */
async function ehList(path, page) {
  const base =
    ehOrigin() + path + (path.includes("?") ? "&" : "?") + "inline_set=dm_e";
  let state = ehLists.get(base);
  if (page === 1 || !state) {
    state = { cursors: new Map([[1, ""]]) };
    ehLists.set(base, state);
  }
  if (state.lastPage !== undefined && page > state.lastPage)
    return { comics: [], maxPage: state.lastPage };
  let current = page;
  while (!state.cursors.has(current) && current > 1) current--;
  for (; current <= page; current++) {
    const doc = Hazuki.html.parse(
      await ehGet(base + (state.cursors.get(current) || "")),
    );
    try {
      const comics = ehComics(doc);
      const href = doc.querySelector("#unext")?.attributes.href || "";
      const cursor = /[?&]next=([\d-]+)(?:&|$)/.exec(href)?.[1];
      if (cursor) {
        const next = "&next=" + cursor;
        if (next === state.cursors.get(current))
          throw new Error("E-Hentai：列表分页游标未推进");
        state.cursors.set(current + 1, next);
      } else {
        state.lastPage = current;
      }
      if (current === page || !cursor)
        return {
          comics: current === page ? comics : [],
          maxPage: state.lastPage ?? null,
        };
    } finally {
      doc.dispose();
    }
  }
  throw new Error("E-Hentai：无法读取列表分页");
}

/** @param {HtmlDocument} doc @param {string} label */
function ehField(doc, label) {
  for (const row of doc.querySelectorAll("#gdd tr")) {
    if (row.children[0]?.text.trim().replace(/:$/, "") === label)
      return row.children[1]?.text.trim() || "";
  }
  return "";
}

/** @param {HtmlDocument} doc */
function ehPageCount(doc) {
  const count = Number(
    /^[\d,]+/.exec(ehField(doc, "Length"))?.[0].replace(/,/g, ""),
  );
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("E-Hentai：无法读取画廊页数，请检查访问权限或网站设置");
  return count;
}

/** @param {string} id @returns {Promise<SourceComicDetails>} */
async function ehLoadInfo(id) {
  const gallery = ehGallery(id);
  const doc = Hazuki.html.parse(
    await ehGet(ehOrigin() + "/g/" + gallery.id + "/"),
  );
  try {
    const title =
      doc.querySelector("#gn")?.text.trim() ||
      doc.querySelector("#gj")?.text.trim();
    if (!title)
      throw new Error("E-Hentai：画廊不可用，请检查访问权限或登录状态");
    const pageCount = ehPageCount(doc);
    const style = doc.querySelector("#gd1 div")?.attributes.style || "";
    const cover = ehAbsolute(
      /url\(["']?([^)'"\s]+)["']?\)/i.exec(style)?.[1] || "",
    );
    /** @type {Record<string, string[]>} */
    const tags = {};
    for (const node of doc.querySelectorAll("#taglist div")) {
      const match = /^td_(?:(\w+):)?(.+)$/.exec(node.id || "");
      if (!match) continue;
      const namespace = match[1] || "temp";
      (tags[namespace] ||= []).push(match[2].replace(/_/g, " "));
    }
    const uploader = doc.querySelector("#gdn a")?.text.trim() || "";
    const category = doc.querySelector("#gdc")?.text.trim() || "";
    const rating = doc.querySelector("#rating_label")?.text.trim() || "";
    return {
      id: gallery.id,
      title,
      cover,
      pageCount,
      uploader,
      updateTime: ehField(doc, "Posted"),
      chapters: { [gallery.id]: "画廊（" + pageCount + " 页）" },
      tags,
      infoFields: [
        {
          label: "日文标题",
          values: doc.querySelector("#gj")?.text.trim() || "",
        },
        { label: "分类", values: category },
        { label: "上传者", values: uploader },
        { label: "文件大小", values: ehField(doc, "File Size") },
        ...Object.entries(tags).map(([namespace, values]) => ({
          label: namespace,
          values: values.map((value) => namespace + ':"' + value + '$"'),
          action: /** @type {const} */ ("search"),
        })),
      ],
      headerStats: [
        { text: pageCount + " 页" },
        ...(rating ? [{ text: rating }] : []),
      ],
    };
  } finally {
    doc.dispose();
  }
}

/** Collect page links, not expiring image URLs. Resolve each only on demand.
 * @param {string} comicId @param {string} chapterId
 */
async function ehLoadEp(comicId, chapterId) {
  const gallery = ehGallery(comicId);
  if (ehGallery(chapterId).id !== gallery.id)
    throw new Error("E-Hentai：章节与画廊不匹配");
  /** @type {Map<number, string>} */
  const pages = new Map();
  let pageCount = 0;
  let thumbnailPages = 1;
  for (let page = 0; page < thumbnailPages; page++) {
    const doc = Hazuki.html.parse(
      await ehGet(ehOrigin() + "/g/" + gallery.id + "/?p=" + page),
    );
    try {
      if (page === 0) {
        pageCount = ehPageCount(doc);
        for (const link of doc.querySelectorAll(".ptt a")) {
          const p = /[?&]p=(\d+)(?:&|$)/.exec(link.attributes.href || "");
          if (p) thumbnailPages = Math.max(thumbnailPages, Number(p[1]) + 1);
        }
      }
      const links = doc.querySelectorAll("#gdt a");
      if (!links.length) throw new Error("E-Hentai：未找到画廊图片索引");
      for (const link of links) {
        const url = ehAbsolute(link.attributes.href || "");
        const match =
          /^https?:\/\/(?:e-hentai|exhentai)\.org\/s\/[a-z0-9]+\/(\d+)-(\d+)$/i.exec(
            url,
          );
        if (!match || match[1] !== gallery.gid)
          throw new Error("E-Hentai：图片索引与画廊不匹配");
        pages.set(Number(match[2]), url);
      }
    } finally {
      doc.dispose();
    }
  }
  if (
    pages.size !== pageCount ||
    Array.from({ length: pageCount }, (_, i) => i + 1).some(
      (p) => !pages.has(p),
    )
  )
    throw new Error("E-Hentai：图片索引不完整，请重新加载画廊");
  return {
    images: [...pages.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]),
  };
}

/** @param {string} url @param {string} comicId @returns {Promise<ImageLoadConfig>} */
async function ehImage(url, comicId) {
  if (!/^https?:\/\/(?:e-hentai|exhentai)\.org\/s\//i.test(url))
    return { headers: { Referer: ehOrigin() + "/" } };
  const gallery = ehGallery(comicId);
  const match = /\/s\/[a-z0-9]+\/(\d+)-(\d+)$/i.exec(url);
  if (!match || match[1] !== gallery.gid)
    throw new Error("E-Hentai：图片链接与画廊不匹配");
  // The host also calls this hook to inspect image segments after downloading.
  // Reuse recent resolutions so that call does not consume another page view.
  const cached = ehImageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const doc = Hazuki.html.parse(await ehGet(url));
  try {
    const image = ehAbsolute(doc.querySelector("#img")?.attributes.src || "");
    if (/\/(?:g|img)\/509\.gif(?:\?|$)/i.test(image))
      throw new Error("E-Hentai：图片配额已用尽，请稍后再试");
    if (!image) {
      if (doc.querySelector("#pane_images"))
        throw new Error("E-Hentai：请在网站设置中关闭多页查看器后重试");
      throw new Error("E-Hentai：无法读取图片地址，请检查网站访问权限");
    }
    const config = { url: image, headers: { Referer: url } };
    ehImageCache.delete(url);
    ehImageCache.set(url, { config, expiresAt: Date.now() + 60000 });
    if (ehImageCache.size > 64) {
      const oldest = ehImageCache.keys().next().value;
      if (oldest !== undefined) ehImageCache.delete(oldest);
    }
    return config;
  } finally {
    doc.dispose();
  }
}

/** @returns {Promise<SourceProfile>} */
async function ehProfile() {
  const cookies = await Hazuki.cookies.get(ehOrigins[0] + "/");
  const member = cookies.find((c) => c.name === "ipb_member_id")?.value || "";
  if (
    !/^\d+$/.test(member) ||
    !cookies.some((c) => c.name === "ipb_pass_hash" && c.value)
  )
    throw Hazuki.error("AUTH_EXPIRED", "E-Hentai：登录凭据缺失，请重新登录");
  const doc = Hazuki.html.parse(
    await ehGet(ehForum + "/index.php?showuser=" + member),
  );
  try {
    const user = doc.querySelector(".home b a");
    if (
      !user ||
      !new RegExp("[?&]showuser=" + member + "(?:&|$)").test(
        user.attributes.href || "",
      )
    )
      throw Hazuki.error(
        "AUTH_EXPIRED",
        "E-Hentai：登录凭据已失效，请重新登录",
      );
    return {
      displayName:
        doc.querySelector("#profilename")?.text.trim() || user.text.trim(),
    };
  } finally {
    doc.dispose();
  }
}

/** @param {string} account @param {string} password */
async function ehPasswordLogin(account, password) {
  const doc = Hazuki.html.parse(await ehGet(ehOrigins[0] + "/home.php"));
  const target = ehForum + "/index.php?act=Login&CODE=01";
  /** @type {Record<string, string>} */
  const fields = {};
  try {
    const form = doc
      .querySelectorAll("form")
      .find((node) => node.attributes.name === "ipb_login_form");
    if (!form || form.attributes.action !== target)
      throw new Error("E-Hentai：无法识别账号登录表单");
    for (const input of form.querySelectorAll("input")) {
      const name = input.attributes.name;
      if (["CookieDate", "b", "bt", "referer"].includes(name))
        fields[name] = input.attributes.value || "";
    }
    if (!["CookieDate", "b", "bt"].every((name) => name in fields))
      throw new Error("E-Hentai：账号登录表单字段缺失");
  } finally {
    doc.dispose();
  }
  fields.UserName = account;
  fields.PassWord = password;
  fields.ipb_login_submit = "Login!";
  const body = Object.entries(fields)
    .map(
      ([name, value]) =>
        encodeURIComponent(name) + "=" + encodeURIComponent(value),
    )
    .join("&");
  const result = await ehGet(target, body);
  if (/The captcha was not entered correctly/i.test(result))
    throw new Error("E-Hentai：网站要求验证码，请改用浏览器登录");
  const cookies = (await Hazuki.cookies.get(ehForum + "/")).filter(
    (cookie) =>
      cookie.name === "ipb_member_id" || cookie.name === "ipb_pass_hash",
  );
  if (
    !cookies.some((c) => c.name === "ipb_member_id" && /^\d+$/.test(c.value)) ||
    !cookies.some((c) => c.name === "ipb_pass_hash" && c.value)
  )
    throw new Error("E-Hentai：账号登录失败，请检查账号密码或改用浏览器登录");
  for (const origin of ehOrigins)
    await Hazuki.cookies.set(
      origin + "/",
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        expiresAt: c.expiresAt,
        path: "/",
        secure: true,
      })),
    );
}

/** @param {string} account @param {string} password @param {SourceLoginContext} [context] */
async function ehLogin(account, password, context) {
  if (!context) throw new Error("E-Hentai：请从登录入口完成授权");
  if (!["password", "browser", "cookie"].includes(context.method))
    throw new Error("E-Hentai：不支持的登录方式");
  if (context.method === "password" && (!account.trim() || !password))
    throw new Error("E-Hentai：请输入账号和密码");
  // Clear old sessions inside the host's login transaction. Otherwise a new EH
  // account could accidentally retain the previous account's ExHentai session.
  for (const origin of [...ehOrigins, ehForum])
    await Hazuki.cookies.delete(origin + "/");
  await ehInit();
  if (context.method === "password") {
    await ehPasswordLogin(account, password);
  } else if (context.method === "browser") {
    const result = await context.requestBrowserAuthorization({
      title: "登录 E-Hentai 后点击完成登录",
      url: ehOrigins[0] + "/home.php",
      completion: "manual",
      cookieScopes: [
        { url: ehOrigins[0] + "/", names: ["ipb_member_id", "ipb_pass_hash"] },
      ],
    });
    if (result.status !== "completed")
      throw new Error("E-Hentai：浏览器登录超时");
  } else if (context.method === "cookie") {
    const raw = await context.requestText({
      title: "输入 E-Hentai Cookie",
      message:
        "需要 ipb_member_id、ipb_pass_hash；ExHentai 还需 igneous。仅保存在插件安全会话中。",
      obscure: true,
    });
    const pairs = raw
      .split(";")
      .map((part) =>
        /^\s*(ipb_member_id|ipb_pass_hash|igneous)\s*=\s*([^;\s]+)\s*$/.exec(
          part,
        ),
      );
    /** @type {SourceCookie[]} */
    const cookies = pairs
      .filter((pair) => pair !== null)
      .map((pair) => ({
        name: pair[1],
        value: pair[2],
        path: "/",
        secure: true,
      }));
    if (
      !cookies.some(
        (c) => c.name === "ipb_member_id" && /^\d+$/.test(c.value),
      ) ||
      !cookies.some((c) => c.name === "ipb_pass_hash")
    )
      throw new Error(
        "E-Hentai：Cookie 中缺少有效的 ipb_member_id 或 ipb_pass_hash",
      );
    for (const origin of ehOrigins)
      await Hazuki.cookies.set(
        origin + "/",
        cookies.filter(
          (cookie) => origin === ehOrigins[1] || cookie.name !== "igneous",
        ),
      );
  }
  // The forum validates the credentials; a cookie existing locally is not proof
  // of a logged-in website session. Host login transactions roll back on failure.
  const cookies = (await Hazuki.cookies.get(ehOrigins[0] + "/")).filter(
    (c) => c.name === "ipb_member_id" || c.name === "ipb_pass_hash",
  );
  await Hazuki.cookies.set(
    ehForum + "/",
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      path: "/",
      secure: true,
    })),
  );
  const profile = await ehProfile();
  ehLists.clear();
  ehImageCache.clear();
  return profile;
}

async function ehLogout() {
  for (const origin of [...ehOrigins, ehForum])
    await Hazuki.cookies.delete(origin + "/");
  ehLists.clear();
  ehImageCache.clear();
  await ehInit();
}

Hazuki.registerSource({
  id: "ehentai",
  name: "E-Hentai",
  version: "1.0.1",
  apiVersion: 1,
  init: ehInit,
  settings: {
    site: {
      title: "站点（ExHentai 需有访问权限的 Cookie）",
      type: "select",
      default: "eh",
      options: [
        { value: "eh", label: "E-Hentai" },
        { value: "ex", label: "ExHentai" },
      ],
      onChanged: () => {
        ehLists.clear();
        ehImageCache.clear();
      },
    },
  },
  presentation: {
    skipPeriodicRelogin: true,
    directComicIdRules: {
      patterns: [
        "^(\\d+/[a-z0-9]{10})$",
        "^https?://(?:e-hentai|exhentai)\\.org/g/(\\d+/[a-z0-9]{10})/?(?:[?#].*)?$",
      ],
      extractDigits: false,
    },
    listTagGroups: [
      "language",
      "artist",
      "group",
      "parody",
      "character",
      "female",
      "male",
      "mixed",
      "other",
      "temp",
    ],
  },
  account: {
    loginMethods: [
      { id: "password", title: "账号密码登录", input: "credentials" },
      { id: "browser", title: "浏览器登录（E-Hentai）", input: "none" },
      { id: "cookie", title: "Cookie 登录", input: "none" },
    ],
    login: ehLogin,
    loadProfile: ehProfile,
    logout: ehLogout,
  },
  explore: [
    {
      title: "最新画廊",
      type: "multiPageComicList",
      load: (page) => ehList("/", page),
    },
    {
      title: "热门画廊",
      type: "multiPageComicList",
      load: (page) => ehList("/popular", page),
    },
  ],
  category: {
    title: "分类",
    parts: [
      {
        name: "画廊分类",
        itemType: "category",
        categories: ehCategories.map((c) => String(c[0])),
        categoryParams: ehCategories.map((c) => String(c[1])),
      },
    ],
  },
  categoryComics: {
    load: (_category, param, _options, page) => {
      if (!ehCategories.some((c) => String(c[1]) === param))
        throw new Error("E-Hentai：无效的分类");
      return ehList("/?f_cats=" + (1023 ^ Number(param)), page);
    },
  },
  search: {
    load: (keyword, _options, page) =>
      ehList("/?f_search=" + encodeURIComponent(keyword), page),
  },
  comic: { loadInfo: ehLoadInfo, loadEp: ehLoadEp, onImageLoad: ehImage },
});

/* JHenTai upstream license (Apache-2.0)
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

*/
