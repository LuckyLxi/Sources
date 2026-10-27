/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

/*
 * 漫画柜手机版 (https://m.manhuagui.com/), Hazuki API v1.
 * Original plugin implementation under GPL-3.0; see LICENSE.
 * The LZ decoder below is adapted from lz-string 1.4.4:
 * Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
 * https://github.com/pieroxy/lz-string/tree/1.4.4
 *
 * DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
 * Version 2, December 2004
 * Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>
 * Everyone is permitted to copy and distribute verbatim or modified
 * copies of this license document, and changing it is allowed as long
 * as the name is changed.
 * DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
 * TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION
 * 0. You just DO WHAT THE FUCK YOU WANT TO.
 */

const manhuaguiOrigin = "https://m.manhuagui.com";
const manhuaguiDesktopOrigin = "https://www.manhuagui.com";
const manhuaguiHeaders = {
  Referer: manhuaguiOrigin + "/",
  "User-Agent": "Mozilla/5.0",
};
let manhuaguiNextRequest = 0;
const manhuaguiGenres = [
  ["全部", ""],
  ["热血", "rexue"],
  ["冒险", "maoxian"],
  ["魔幻", "mohuan"],
  ["神鬼", "shengui"],
  ["搞笑", "gaoxiao"],
  ["萌系", "mengxi"],
  ["爱情", "aiqing"],
  ["科幻", "kehuan"],
  ["魔法", "mofa"],
  ["格斗", "gedou"],
  ["武侠", "wuxia"],
  ["机战", "jizhan"],
  ["战争", "zhanzheng"],
  ["竞技", "jingji"],
  ["体育", "tiyu"],
  ["校园", "xiaoyuan"],
  ["生活", "shenghuo"],
  ["励志", "lizhi"],
  ["历史", "lishi"],
  ["伪娘", "weiniang"],
  ["宅男", "zhainan"],
  ["腐女", "funv"],
  ["耽美", "danmei"],
  ["百合", "baihe"],
  ["后宫", "hougong"],
  ["治愈", "zhiyu"],
  ["美食", "meishi"],
  ["推理", "tuili"],
  ["悬疑", "xuanyi"],
  ["恐怖", "kongbu"],
  ["四格", "sige"],
  ["职场", "zhichang"],
  ["侦探", "zhentan"],
  ["社会", "shehui"],
  ["音乐", "yinyue"],
  ["舞蹈", "wudao"],
  ["杂志", "zazhi"],
  ["黑道", "heidao"],
];
const manhuaguiRegions = [
  ["日本", "japan"],
  ["港台", "hongkong"],
  ["其它", "other"],
  ["欧美", "europe"],
  ["内地", "china"],
  ["韩国", "korea"],
];
const manhuaguiReaders = [
  ["少女", "shaonv"],
  ["少年", "shaonian"],
  ["青年", "qingnian"],
  ["儿童", "ertong"],
  ["通用", "tongyong"],
];

/** @param {string} value @param {string} [origin] */
function manhuaguiAbsolute(value, origin = manhuaguiOrigin) {
  if (value.startsWith("//")) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? origin + value : "";
}

/** @param {string} id */
function manhuaguiId(id) {
  if (!/^\d+$/.test(id)) throw new Error("漫画柜：无效的漫画或章节 ID");
  return id;
}

/** @param {SourceHttpResponse<string>} response */
function manhuaguiBody(response) {
  if (response.status !== 200)
    throw new Error("漫画柜：请求失败（HTTP " + response.status + "）");
  return response.body;
}

/** Space request starts without tying a refresh to an older network request.
 * @param {string} path @param {string} [body] @param {string} [origin]
 */
async function manhuaguiRequest(path, body, origin = manhuaguiOrigin) {
  const now = Date.now();
  const start = Math.max(now, manhuaguiNextRequest);
  manhuaguiNextRequest = start + 1000;
  if (start > now) await Hazuki.delay(start - now);
  try {
    const headers = { ...manhuaguiHeaders, Referer: origin + "/" };
    const response =
      body === undefined
        ? await Hazuki.http.get(origin + path, headers)
        : await Hazuki.http.post(
            origin + path,
            {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            },
            body,
          );
    return manhuaguiBody(response);
  } catch (error) {
    if (
      /timeout|timed out|socketexception|failed host lookup|connection error|connection refused|network is unreachable/i.test(
        String(error),
      )
    )
      throw new Error(
        "漫画柜：无法连接 " +
          origin.replace("https://", "") +
          "，请检查当前代理节点或网络",
      );
    throw error;
  }
}

/** @param {string} path @param {string} [body] @param {string} [origin] */
async function manhuaguiJson(path, body, origin) {
  const text = await manhuaguiRequest(path, body, origin);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("漫画柜：无法读取网站数据，访问可能受限");
  }
}

/** @param {string} [origin] @returns {Promise<SourceProfile>} */
async function manhuaguiProfile(origin = manhuaguiDesktopOrigin) {
  const data = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=user_check_login&m=1",
    undefined,
    origin,
  );
  if (data.status !== 1)
    throw Hazuki.error("AUTH_EXPIRED", "漫画柜：请先登录账号或重新登录");
  return {
    displayName: decodeURI(data.nick_name || data.username),
    avatarUrl: manhuaguiAbsolute(data.avatar || "", manhuaguiDesktopOrigin),
  };
}

/** @param {string} id */
async function manhuaguiShelfState(id) {
  manhuaguiId(id);
  await manhuaguiProfile(manhuaguiOrigin);
  const result = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=user_book_shelf_check&book_id=" + id,
  );
  if (result.status === 0 && /未登录|已超时/.test(result.msg || ""))
    throw Hazuki.error("AUTH_EXPIRED", "漫画柜：请先登录账号或重新登录");
  if (result.status !== 0 && result.status !== 1)
    throw new Error(result.msg || "漫画柜：无法读取收藏状态");
  return result.status === 1;
}

/** @param {string} id @param {boolean} adding */
async function manhuaguiSetFavorite(id, adding) {
  manhuaguiId(id);
  await manhuaguiProfile(manhuaguiOrigin);
  const result = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=user_book_shelf_" +
      (adding ? "add" : "delete"),
    "book_id=" + id,
  );
  if (result.status !== 1)
    throw new Error(result.msg || "漫画柜：网站书架操作失败");
}

/** @param {string} account @param {string} password */
async function manhuaguiLogin(account, password) {
  if (!account.trim() || !password)
    throw new Error("漫画柜：请填写用户名或邮箱和登录密码");
  const data = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=user_login",
    "txtUserName=" +
      encodeURIComponent(account.trim()) +
      "&txtPassword=" +
      encodeURIComponent(password) +
      "&chkRemember=checked",
    manhuaguiDesktopOrigin,
  );
  if (data.status !== 1) throw new Error(data.msg || "漫画柜：登录失败");
  // The host stages these HTTP cookies until the authenticated profile is verified.
  return manhuaguiProfile();
}

/** @param {HtmlDocument} doc @returns {SourceComic[]} */
function manhuaguiRecommendations(doc) {
  const section = doc.querySelector(".book-similar");
  if (!section) throw new Error("漫画柜：无法读取相关推荐");
  return section.querySelectorAll("a.scover").map((link) => {
    const match = /^\/comic\/(\d+)\/$/.exec(link.attributes.href || "");
    const title = link.attributes.title;
    if (!match || !title) throw new Error("漫画柜：无效的推荐漫画");
    return {
      id: match[1],
      title,
      cover: manhuaguiAbsolute(link.querySelector("img")?.attributes.src || ""),
      subTitle: link.querySelector(".tt")?.text.trim() || "",
    };
  });
}

/** @param {HtmlDocument} doc @returns {SourceComicInfoField[]} */
function manhuaguiDesktopInfo(doc) {
  const spans = doc.querySelectorAll(".detail-list span");
  /** @param {string} label */
  const values = (label) => {
    const row = spans.find(
      (span) =>
        span.querySelector("strong")?.text.replace(/[\s：:]/g, "") === label,
    );
    return (
      row
        ?.querySelectorAll("a")
        .map((link) => link.text.trim())
        .filter(Boolean) || []
    );
  };
  const readers =
    doc
      .querySelector(".crumb")
      ?.querySelectorAll("a")
      .filter((link) =>
        manhuaguiReaders.some(
          (reader) => link.attributes.href === "/list/" + reader[1] + "/",
        ),
      )
      .map((link) => link.text.trim()) || [];
  const aliases = [
    ...new Set(
      [
        doc.querySelector(".book-title h2")?.text.trim() || "",
        ...values("漫画别名"),
      ].filter(Boolean),
    ),
  ];
  /** @type {SourceComicInfoField[]} */
  const fields = [
    { label: "地区", values: values("漫画地区"), action: "search" },
    { label: "读者", values: readers, action: "search" },
    { label: "出品年代", values: values("出品年代"), action: "search" },
    { label: "字母索引", values: values("字母索引"), action: "search" },
    { label: "别名", values: aliases, action: "search" },
  ];
  return fields.filter((field) => field.values.length);
}

/** @param {HtmlDocument} doc @param {string} id @returns {SourceChapterGroup[]} */
function manhuaguiChapterGroups(doc, id) {
  const seen = new Set();
  const groups = doc.querySelectorAll(".chapter-list").map((list, index) => {
    let heading = list.previousElementSibling;
    while (heading && heading.localName !== "h4")
      heading = heading.previousElementSibling;
    const title = heading?.text.trim();
    if (!title) throw new Error("漫画柜：无法读取章节分类");
    // Desktop pages store ascending blocks, with descending chapters inside each block.
    const chapters = list.querySelectorAll("ul").flatMap((block) =>
      block
        .querySelectorAll("a")
        .map((link) => {
          const match = /^\/comic\/(\d+)\/(\d+)\.html$/.exec(
            link.attributes.href || "",
          );
          if (!match || match[1] !== id || seen.has(match[2]))
            throw new Error("漫画柜：无效或重复的章节链接");
          seen.add(match[2]);
          return {
            id: match[2],
            title:
              link.attributes.title ||
              link.querySelector("span")?.text.trim() ||
              link.text.trim(),
          };
        })
        .reverse(),
    );
    return { id: "group-" + (index + 1), title, chapters };
  });
  if (!groups.length || !seen.size)
    throw new Error("漫画柜：没有可读取的章节，作品可能受限");
  return groups;
}

/** @param {string} id */
async function manhuaguiRating(id) {
  const result = await manhuaguiJson("/tools/vote.ashx?act=get&bid=" + id);
  const counts = [1, 2, 3, 4, 5].map((star) => result.data?.["s" + star]);
  if (
    result.success !== true ||
    counts.some((count) => !Number.isInteger(count) || count < 0)
  )
    throw new Error("漫画柜：无法读取评分");
  const total = counts.reduce((sum, count) => sum + count, 0);
  const average = total
    ? (
        (counts.reduce((sum, count, i) => sum + count * (i + 1), 0) * 2) /
        total
      ).toFixed(1)
    : "0.0";
  return { average, total };
}

/** @param {{average: string, total: number}} rating @returns {SourceComicHeaderStat} */
function manhuaguiRatingStat(rating) {
  return {
    text: rating.average + " 分 · " + rating.total + " 人",
    icon: "star",
    ...((Hazuki.comicHeaderVersion ?? 1) >= 2 &&
    (Hazuki.ui?.dialogVersion ?? 0) >= 3
      ? { action: "plugin", id: "rating" }
      : {}),
  };
}

/** @param {string} id @returns {Promise<SourceComicHeaderActionResult | void>} */
async function manhuaguiVote(id) {
  manhuaguiId(id);
  if ((Hazuki.ui?.dialogVersion ?? 0) < 3)
    throw new Error("漫画柜：请升级到支持评分窗口的宿主版本");
  const rating = await manhuaguiRating(id);
  const voted = Hazuki.storage.get("vote:" + id);
  const dialog = await Hazuki.ui.openDialog({
    title: "漫画评分",
    content: [
      {
        id: "summary",
        type: "text",
        text: rating.average + " / 10 · " + rating.total + " 人评分",
      },
      {
        id: "score",
        type: "rating",
        label: voted ? "我的评分（已投票）" : "我的评分",
        max: 5,
        required: true,
        readOnly: !!voted,
        initialValue: typeof voted === "number" ? voted : 0,
      },
    ],
    buttons: voted
      ? [{ id: "close", text: "关闭" }]
      : [{ id: "submit", text: "提交评分", role: "primary", validate: true }],
  });
  try {
    const event = await dialog.nextEvent();
    if (event.type !== "action" || event.id !== "submit" || voted) return;
    const stars = event.values.score;
    if (
      typeof stars !== "number" ||
      !Number.isInteger(stars) ||
      stars < 1 ||
      stars > 5
    )
      throw new Error("漫画柜：请选择 1～5 星评分");
    await dialog.update({ busy: true });
    const result = await manhuaguiJson(
      "/tools/vote.ashx?act=vote&bid=" + id + "&s=" + stars,
    );
    if (result.success !== true)
      throw new Error("漫画柜：评分失败，请稍后重试");
    // The website also remembers votes per browser, rather than per account.
    await Hazuki.storage.set("vote:" + id, stars);
  } finally {
    await dialog.close();
  }
  await Hazuki.ui.alert({ title: "评分成功", message: "感谢您的参与！" });
  return { reload: true };
}

/** @param {string} html */
function manhuaguiCommentText(html) {
  const doc = Hazuki.html.parse(
    "<div>" + html.replace(/<br\s*\/?\s*>/gi, "\n") + "</div>",
  );
  try {
    return doc.querySelector("div")?.text.trim() || "";
  } finally {
    doc.dispose();
  }
}

/** @param {any} row @returns {SourceComment} */
function manhuaguiComment(row) {
  if (!row) throw new Error("漫画柜：无法读取评论内容");
  return {
    id: String(row.id),
    userName: row.user_name || "",
    avatar: manhuaguiAbsolute(row.avatar || ""),
    content: manhuaguiCommentText(row.content) || "此评论已被删除",
    time: row.add_time,
    score: row.support_count,
    replyCount: row.reply_count,
    isLiked: Hazuki.storage.get("commentLike:" + row.id) === true,
    canUnlike: false,
  };
}

/** @param {string} id @param {number} page @param {string} order */
async function manhuaguiComments(id, page, order) {
  const data = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=comment_list&m=1&book_id=" +
      manhuaguiId(id) +
      "&page_index=" +
      page +
      (order === "hot" ? "&hot=1" : ""),
  );
  if (
    !Array.isArray(data.commentIds) ||
    !data.comments ||
    !Number.isInteger(data.total)
  )
    throw new Error("漫画柜：无法读取评论列表");
  return {
    comments: data.commentIds.map((/** @type {string} */ chain) => {
      const ids = chain.split(",");
      return {
        ...manhuaguiComment(data.comments[ids[0]]),
        quotedComments: ids
          .slice(1)
          .reverse()
          .map((quotedId) => manhuaguiComment(data.comments[quotedId])),
      };
    }),
    maxPage: Math.max(1, Math.ceil(data.total / 30)),
  };
}

/** @param {string} id @param {string} commentId @param {boolean} isLike */
async function manhuaguiLikeComment(id, commentId, isLike) {
  manhuaguiId(id);
  manhuaguiId(commentId);
  if (!isLike) throw new Error("漫画柜：网站不支持取消点赞");
  const result = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=comment_support&comment_id=" + commentId,
  );
  if (result.status !== 1)
    throw new Error(result.msg || "漫画柜：评论点赞失败");
  await Hazuki.storage.set("commentLike:" + commentId, true);
}

/** @param {string} id @param {string} text @param {string | null} replyTo */
async function manhuaguiSendComment(id, text, replyTo) {
  manhuaguiId(id);
  if (replyTo) manhuaguiId(replyTo);
  const content = text.trim();
  if (!content || content.length > 1000)
    throw new Error("漫画柜：评论须为 1～1000 个字符");
  await manhuaguiProfile();
  const result = await manhuaguiJson(
    "/tools/submit_ajax.ashx?action=comment_add",
    "book_id=" +
      id +
      // The website percent-encodes the content before form serialization.
      "&txtContent=" +
      encodeURIComponent(encodeURIComponent(content)) +
      "&to_comment_id=" +
      (replyTo || "0"),
    manhuaguiDesktopOrigin,
  );
  if (result.status !== 1)
    throw new Error(result.msg || "漫画柜：评论发送失败");
}

/** @param {HtmlElement} element @param {string} label */
function manhuaguiField(element, label) {
  const row = element
    .querySelectorAll("dl")
    .find(
      (item) =>
        item.querySelector("dt")?.text.replace(/[\s：:]/g, "") === label,
    );
  return row?.querySelector("dd")?.text.trim() || "";
}

/** @param {HtmlDocument | HtmlElement} root @returns {SourceComic[]} */
function manhuaguiComics(root) {
  const seen = new Set();
  /** @type {SourceComic[]} */
  const comics = [];
  for (const link of root.querySelectorAll("a")) {
    const match = /^\/comic\/(\d+)\/$/.exec(link.attributes.href || "");
    const title = link.querySelector("h3")?.text.trim();
    const image = link.querySelector("img");
    if (!match || !title || seen.has(match[1])) continue;
    seen.add(match[1]);
    const genres = manhuaguiField(link, "类别");
    comics.push({
      id: match[1],
      title,
      cover: manhuaguiAbsolute(
        image?.attributes["data-src"] || image?.attributes.src || "",
      ),
      subTitle:
        manhuaguiField(link, "更新至") ||
        link.querySelector("p span")?.text.trim() ||
        "",
      tags: genres
        ? genres
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    });
  }
  return comics;
}

/** @param {string} html */
function manhuaguiPageCount(html) {
  const match = /pageCount\s*[:=]\s*(\d+)/.exec(html);
  if (!match) throw new Error("漫画柜：无法读取分页信息，网站格式可能已变化");
  return Math.max(1, Number(match[1]));
}

/** @param {string} path @param {number} page @returns {Promise<ComicPage>} */
async function manhuaguiList(path, page) {
  const html = await manhuaguiRequest(path + "?page=" + page);
  const doc = Hazuki.html.parse(html);
  try {
    const list = doc.querySelector("#detail");
    if (!list) throw new Error("漫画柜：无法读取漫画列表，网站格式可能已变化");
    return { comics: manhuaguiComics(list), maxPage: manhuaguiPageCount(html) };
  } finally {
    doc.dispose();
  }
}

/** LZ-string's base64 bit stream, used by the mobile site's packed dictionary.
 * @param {string} compressed
 */
function manhuaguiDecompress(compressed) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let index = 0;
  let position = 0;
  let value = 0;
  /** @param {number} width */
  function read(width) {
    let bits = 0;
    for (let bit = 0; bit < width; bit++) {
      if (position === 0) {
        if (index >= compressed.length)
          throw new Error("漫画柜：章节压缩数据不完整");
        value = alphabet.indexOf(compressed.charAt(index++));
        if (value < 0) throw new Error("漫画柜：无效的章节压缩数据");
        position = 32;
      }
      if (value & position) bits |= 1 << bit;
      position >>= 1;
    }
    return bits;
  }
  const first = read(2);
  if (first === 2) return "";
  if (first > 2) throw new Error("漫画柜：无效的章节压缩数据");
  let previous = String.fromCharCode(read(first === 0 ? 8 : 16));
  /** @type {string[]} */
  const dictionary = ["", "", "", previous];
  const result = [previous];
  let width = 3;
  let remaining = 4;
  while (true) {
    let code = read(width);
    if (code === 2) return result.join("");
    if (code === 0 || code === 1) {
      dictionary.push(String.fromCharCode(read(code === 0 ? 8 : 16)));
      code = dictionary.length - 1;
      remaining--;
    }
    if (remaining === 0) {
      remaining = 1 << width;
      width++;
    }
    const entry =
      dictionary[code] ||
      (code === dictionary.length ? previous + previous.charAt(0) : "");
    if (!entry) throw new Error("漫画柜：无效的章节压缩字典");
    result.push(entry);
    dictionary.push(previous + entry.charAt(0));
    remaining--;
    previous = entry;
    if (remaining === 0) {
      remaining = 1 << width;
      width++;
    }
  }
}

/** Decode only a JS string literal, without executing the website's scripts.
 * @param {string} value
 */
function manhuaguiUnquote(value) {
  return value.replace(
    /\\(x[\da-f]{2}|u[\da-f]{4}|[\\'"/nrt])/gi,
    (_, escape) => {
      if (escape[0] === "x" || escape[0] === "u")
        return String.fromCharCode(parseInt(escape.slice(1), 16));
      return escape === "n"
        ? "\n"
        : escape === "r"
          ? "\r"
          : escape === "t"
            ? "\t"
            : escape;
    },
  );
}

/** @param {string} html @param {string} comicId @param {string} chapterId */
function manhuaguiImages(html, comicId, chapterId) {
  const packed =
    /}\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([A-Za-z0-9+/=]+)'\[/.exec(
      html,
    );
  if (!packed)
    throw new Error("漫画柜：找不到章节图片数据，章节可能受限或网站格式已变化");
  const radix = Number(packed[2]);
  if (radix < 2 || radix > 62) throw new Error("漫画柜：不支持的章节编码");
  const words = manhuaguiDecompress(packed[4]).split("|");
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const unpacked = manhuaguiUnquote(packed[1]).replace(
    /\b[\da-zA-Z]+\b/g,
    (word) => {
      let code = 0;
      for (const character of word) {
        const digit = alphabet.indexOf(character);
        if (digit >= radix) return word;
        code = code * radix + digit;
      }
      return code < Number(packed[3]) && words[code] ? words[code] : word;
    },
  );
  const match = /SMH\.reader\((\{[\s\S]*\})\)\s*\.preInit\(\)/.exec(unpacked);
  if (!match) throw new Error("漫画柜：无法解析章节图片数据");
  const data = JSON.parse(match[1]);
  if (String(data.bookId) !== comicId || String(data.chapterId) !== chapterId)
    throw new Error("漫画柜：返回的章节与请求不一致");
  if (
    !Array.isArray(data.images) ||
    !data.images.length ||
    !data.sl?.e ||
    !data.sl?.m
  )
    throw new Error("漫画柜：章节缺少图片或签名");
  return data.images.map((/** @type {unknown} */ image) => {
    if (typeof image !== "string" || !image.startsWith("/"))
      throw new Error("漫画柜：无效的章节图片路径");
    return (
      "https://i.hamreus.com" +
      encodeURI(image) +
      "?e=" +
      encodeURIComponent(data.sl.e) +
      "&m=" +
      encodeURIComponent(data.sl.m)
    );
  });
}

Hazuki.registerSource({
  id: "manhuagui",
  name: "漫画柜",
  version: "1.3.2",
  apiVersion: 1,
  presentation: {
    searchOrders: { 0: "添加时间", 1: "更新时间", 2: "浏览次数" },
    searchDefaultOrder: "0",
    listTagGroups: ["题材"],
    showComicStatus: false,
    showComments: true,
    commentOrders: { newest: "最新", hot: "热门" },
    commentDefaultOrder: "newest",
    refreshCloudFavorites: true,
    buttons: [{ id: "relatedComics", location: "comicDetailTabs" }],
    directComicIdRules: {
      patterns: [
        "^(\\d+)$",
        "^https?://(?:m|www|tw)\\.manhuagui\\.com/comic/(\\d+)(?:/|/\\d+\\.html)?(?:[?#].*)?$",
      ],
      extractDigits: false,
    },
  },
  search: {
    load: async (keyword, options, page) => {
      const order = ["0", "1", "2"].includes(options[0]) ? options[0] : "0";
      const term = keyword.trim();
      const category = [
        ...manhuaguiGenres,
        ...manhuaguiRegions,
        ...manhuaguiReaders,
      ].find((item) => item[0] === term.replace(/漫画$/, "") && item[1]);
      const year = /^(\d{4})年$/.exec(term);
      const slug =
        category?.[1] ||
        (year
          ? Number(year[1]) >= 2010
            ? year[1]
            : year[1].slice(0, 3) + "x"
          : "") ||
        (/^[A-Z]$/.test(term) ? term.toLowerCase() : "");
      if (slug)
        return manhuaguiList(
          "/list/" +
            slug +
            "/" +
            ["", "update.html", "view.html"][Number(order)],
          page,
        );
      const path =
        "/s/" + encodeURIComponent(keyword.trim()) + "_o" + order + ".html";
      const html = await manhuaguiRequest(path);
      const maxPage = manhuaguiPageCount(html);
      if (page > maxPage) return { comics: [], maxPage };
      // The mobile search ignores GET page parameters; its own load-more uses POST.
      const content =
        page === 1
          ? html
          : await manhuaguiRequest(
              path,
              "page=" +
                page +
                "&ajax=1&order=" +
                order +
                "&key=" +
                encodeURIComponent(keyword.trim()),
            );
      const doc = Hazuki.html.parse(content);
      try {
        if (page === 1 && !doc.querySelector("#detail"))
          throw new Error("漫画柜：无法读取搜索结果");
        const comics = manhuaguiComics(doc);
        if (page > 1 && !comics.length)
          throw new Error("漫画柜：无法读取搜索分页结果");
        return { comics, maxPage };
      } finally {
        doc.dispose();
      }
    },
  },
  account: {
    loginMethods: [
      { id: "password", title: "用户名／邮箱登录", input: "credentials" },
    ],
    login: manhuaguiLogin,
    loadProfile: manhuaguiProfile,
    logout: async () => {
      await Hazuki.cookies.delete(manhuaguiDesktopOrigin + "/");
      await Hazuki.cookies.delete(manhuaguiOrigin + "/");
    },
  },
  favorites: {
    singleFolderForSingleComic: true,
    loadComics: async (page) => {
      // The mobile site returns an empty shelf even for guests; verify its session first.
      await manhuaguiProfile(manhuaguiOrigin);
      return manhuaguiList("/user/book/", page);
    },
    loadFolders: async (comicId) => {
      const folders = { shelf: "网站书架" };
      if (comicId === null) return { folders };
      return {
        folders,
        favorited: (await manhuaguiShelfState(comicId)) ? ["shelf"] : [],
      };
    },
    addOrDelFavorite: (comicId, _folderId, adding) =>
      manhuaguiSetFavorite(comicId, adding),
  },
  comic: {
    loadInfo: async (id) => {
      const doc = Hazuki.html.parse(
        await manhuaguiRequest("/comic/" + manhuaguiId(id) + "/"),
      );
      try {
        const title = doc.querySelector(".main-bar h1")?.text.trim();
        const detail = doc.querySelector(".book-detail");
        if (!title || !detail)
          throw new Error("漫画柜：找不到漫画详情，作品可能不存在或访问受限");
        const status = detail.querySelector(".thumb i")?.text.trim() || "";
        const authors = manhuaguiField(detail, "作者")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const genres = manhuaguiField(detail, "类别")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const [desktopHtml, rating] = await Promise.all([
          manhuaguiRequest(
            "/comic/" + id + "/",
            undefined,
            manhuaguiDesktopOrigin,
          ),
          manhuaguiRating(id),
        ]);
        const desktop = Hazuki.html.parse(desktopHtml);
        let recommend;
        let chapterGroups;
        let desktopInfo;
        try {
          recommend = manhuaguiRecommendations(desktop);
          chapterGroups = manhuaguiChapterGroups(desktop, id);
          desktopInfo = manhuaguiDesktopInfo(desktop);
        } finally {
          desktop.dispose();
        }
        const latest = manhuaguiField(detail, "更新至");
        /** @type {SourceComicHeaderStat[]} */
        const headerStats = [];
        if (latest)
          headerStats.push({ text: "更新至 " + latest, icon: "book" });
        headerStats.push(manhuaguiRatingStat(rating));
        return {
          id,
          title,
          cover: manhuaguiAbsolute(
            detail.querySelector(".thumb img")?.attributes.src || "",
          ),
          description: doc.querySelector("#bookIntro")?.text.trim() || "",
          updateTime: manhuaguiField(detail, "更新于"),
          recommend,
          chapterGroups,
          tags: { 作者: authors, 题材: genres, 状态: status ? [status] : [] },
          infoFields: [
            { label: "作者", values: authors, action: "search" },
            { label: "题材", values: genres, action: "search" },
            ...desktopInfo,
          ],
          headerBadges: status ? [{ text: status }] : [],
          headerStats,
        };
      } finally {
        doc.dispose();
      }
    },
    loadEp: async (comicId, chapterId) => ({
      images: manhuaguiImages(
        await manhuaguiRequest(
          "/comic/" +
            manhuaguiId(comicId) +
            "/" +
            manhuaguiId(chapterId) +
            ".html",
        ),
        comicId,
        chapterId,
      ),
    }),
    onImageLoad: () => ({ headers: manhuaguiHeaders }),
    onHeaderAction: (id, actionId) => {
      if (actionId === "rating") return manhuaguiVote(id);
    },
    loadComments: (id, _subId, page, _replyTo, order = "newest") =>
      manhuaguiComments(id, page, order),
    sendComment: (id, _subId, text, replyTo) =>
      manhuaguiSendComment(id, text, replyTo),
    likeComment: (id, _subId, commentId, isLike) =>
      manhuaguiLikeComment(id, commentId, isLike),
  },
  explore: [
    {
      title: "首页",
      type: "singlePageWithMultiPart",
      load: async () => {
        const doc = Hazuki.html.parse(await manhuaguiRequest("/"));
        try {
          /** @type {Record<string, SourceComic[]>} */
          const result = {};
          for (const section of doc.querySelectorAll(".main-list")) {
            const title = section.previousElementSibling
              ?.querySelector("h2")
              ?.text.trim();
            if (title) result[title] = manhuaguiComics(section);
          }
          if (!Object.keys(result).length)
            throw new Error("漫画柜：无法读取首页分区");
          return result;
        } finally {
          doc.dispose();
        }
      },
    },
    {
      title: "最新更新",
      type: "multiPageComicList",
      load: (page) => manhuaguiList("/update/", page),
    },
    {
      title: "排行榜",
      type: "multiPageComicList",
      load: (page) => manhuaguiList("/rank/", page),
    },
  ],
  category: {
    title: "分类",
    parts: [
      {
        name: "题材",
        itemType: "category",
        categories: manhuaguiGenres.map((item) => item[0]),
        categoryParams: manhuaguiGenres.map((item) => item[1]),
      },
      {
        name: "地区",
        itemType: "category",
        categories: manhuaguiRegions.map((item) => item[0]),
        categoryParams: manhuaguiRegions.map((item) => item[1]),
      },
      {
        name: "读者",
        itemType: "category",
        categories: manhuaguiReaders.map((item) => item[0]),
        categoryParams: manhuaguiReaders.map((item) => item[1]),
      },
      {
        name: "进度",
        itemType: "category",
        categories: ["连载", "完结"],
        categoryParams: ["lianzai", "wanjie"],
      },
    ],
  },
  categoryComics: {
    ranking: {
      options: ["all-排行榜"],
      load: (option, page) => {
        if (option !== "all") throw new Error("漫画柜：无效的排行榜");
        return manhuaguiList("/rank/", page);
      },
    },
    optionList: [
      {
        label: "排序",
        options: ["index-添加时间", "update-更新时间", "view-浏览次数"],
      },
    ],
    load: (_category, param, options, page) => {
      const slug = param || "";
      const valid = [
        ...manhuaguiGenres,
        ...manhuaguiRegions,
        ...manhuaguiReaders,
        ["", "lianzai"],
        ["", "wanjie"],
      ].some((item) => item[1] === slug);
      if (!valid) throw new Error("漫画柜：无效的分类");
      const order = ["index", "update", "view"].includes(options[0])
        ? options[0]
        : "index";
      return manhuaguiList(
        "/list/" +
          (slug ? slug + "/" : "") +
          (order === "index" ? "" : order + ".html"),
        page,
      );
    },
  },
});
