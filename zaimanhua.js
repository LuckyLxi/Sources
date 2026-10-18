/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

/*
 * Original Hazuki API v1 source for 再漫画 (https://manhua.zaimanhua.com/).
 * Written for this repository under GPL-3.0; see LICENSE. No upstream code copied.
 * Routes and field names were observed in the public desktop site's responses:
 *   /app/v1/search/index
 *   /app/v1/comic/sub/{list,checkIsSub,add,del}
 *   /app/v1/readingRecord/{add,list}
 *   /api/v1/comic1/{filter,rank_list,comic/same_list}
 *   /api/v1/comic2/{index,update_list,comic/detail,chapter/detail}
 * Optional account flows use the site's own point captcha/SMS and browser OAuth
 * endpoints. Native chapter groups and progress reports require the updated host.
 * Browser OAuth state is passed unchanged to the provider and consumed by the
 * site's account backend; the final token is verified before saving a session.
 */

const zaimanhuaOrigin = "https://manhua.zaimanhua.com";
const zaimanhuaAccountOrigin = "https://account-api.zaimanhua.com";
const zaimanhuaPageSize = 20;
const zaimanhuaUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** @typedef {Record<string, any>} ZaimanhuaData */
/** @typedef {{method?: 'GET' | 'POST', anonymous?: boolean, token?: string,
 * allowError?: boolean, origin?: string, common?: boolean}} ZaimanhuaRequestOptions */

/** Filter IDs from the site's /api/v1/comic1/filter_type (not detail tag IDs). */
const zaimanhuaThemes = [
  ["0", "全部漫画"],
  ["1", "冒险"],
  ["2", "搞笑"],
  ["3", "格斗"],
  ["4", "科幻"],
  ["5", "爱情"],
  ["6", "侦探"],
  ["7", "竞技"],
  ["8", "魔法"],
  ["9", "校园"],
  ["11", "百合"],
  ["13", "耽美"],
  ["14", "历史"],
  ["15", "战争"],
  ["16", "宅系"],
  ["17", "治愈"],
  ["18", "仙侠"],
  ["19", "武侠"],
  ["20", "职场"],
  ["21", "神鬼"],
  ["22", "奇幻"],
  ["23", "生活"],
  ["24", "其他"],
];

/** @param {unknown} value */
function zaimanhuaText(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

/** @param {unknown} value */
function zaimanhuaId(value) {
  const id = zaimanhuaText(value);
  if (!/^[1-9]\d*$/.test(id)) throw new Error("再漫画：无效的漫画或章节 ID");
  return id;
}

/** @param {number} page */
function zaimanhuaPageNumber(page) {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

/** Keep encoded image paths intact; QuickJS has no browser URL global.
 * @param {unknown} value
 */
function zaimanhuaImageUrl(value) {
  let url = zaimanhuaText(value);
  if (url.startsWith("//")) url = "https:" + url;
  return /^https?:\/\/[^\s/]+\//i.test(url)
    ? url.replace(/^http:/i, "https:")
    : "";
}

/** @param {string} path @param {Record<string, string | number>} [params]
 * @param {ZaimanhuaRequestOptions} [options]
 * @returns {Promise<ZaimanhuaData>}
 */
async function zaimanhuaApi(path, params = {}, options = {}) {
  const token = options.anonymous
    ? ""
    : (options.token ?? (await Hazuki.secrets.get("session")) ?? "");
  const uid = token ? zaimanhuaText(Hazuki.storage.get("uid")) : "";
  const common =
    options.common === false
      ? {}
      : {
          channel: "pc",
          app_name: "zmh",
          version: "1.0.0",
          timestamp: Date.now(),
          ...(uid ? { uid } : {}),
        };
  const query = Object.entries({
    ...common,
    ...params,
  })
    .map(
      ([key, value]) =>
        encodeURIComponent(key) + "=" + encodeURIComponent(value),
    )
    .join("&");
  const url =
    (options.origin || zaimanhuaOrigin) + path + (query ? "?" + query : "");
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/json",
    Referer: zaimanhuaOrigin + "/",
    "User-Agent": zaimanhuaUserAgent,
    Platform: "pc",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const clientId = zaimanhuaText(Hazuki.storage.get("clientId"));
  if (clientId) headers["X-Client-ID"] = clientId;
  // The site's POST wrapper submits parameters in the query string. Do not log
  // request URLs or caught network errors: login parameters can contain secrets.
  let response;
  try {
    response =
      options.method === "POST"
        ? await Hazuki.http.post(url, headers)
        : await Hazuki.http.get(url, headers);
  } catch {
    throw new Error("再漫画：网络请求失败，请检查连接后重试");
  }
  if (token && response.status === 401)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：登录已失效，请重新登录");
  if (response.status !== 200)
    throw new Error("再漫画：请求失败，HTTP " + response.status);
  /** @type {ZaimanhuaData} */
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error("再漫画：接口未返回有效 JSON，请稍后重试");
  }
  if (payload && Number(payload.errno) === 99 && token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：登录已失效，请重新登录");
  if (!payload || typeof payload !== "object" || payload.errno == null)
    throw new Error("再漫画：接口返回异常");
  if (Number(payload.errno) !== 0 && !options.allowError)
    throw new Error(
      "再漫画：" + (zaimanhuaText(payload?.errmsg) || "接口返回异常"),
    );
  return payload;
}

/** @param {string} path @param {Record<string, string | number>} [params]
 * @param {ZaimanhuaRequestOptions} [options] @returns {Promise<ZaimanhuaData>}
 */
async function zaimanhuaRequest(path, params = {}, options = {}) {
  const payload = await zaimanhuaApi(path, params, options);
  if (!payload.data || typeof payload.data !== "object")
    throw new Error("再漫画：接口缺少数据");
  return payload.data;
}

/** @param {string} url @param {string} key */
function zaimanhuaQueryValue(url, key) {
  const query = url.split("#")[0].split("?").slice(1).join("?");
  const values = [];
  try {
    for (const pair of query.split("&")) {
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      if (
        decodeURIComponent(pair.slice(0, separator).replace(/\+/g, " ")) === key
      )
        values.push(
          decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " ")),
        );
    }
  } catch {
    throw new Error("再漫画：授权地址格式异常");
  }
  if (values.length > 1) throw new Error("再漫画：授权地址存在重复参数");
  return values[0] || "";
}

/** @param {string} token */
async function zaimanhuaVerifyToken(token) {
  if (!token || /[\s\x00-\x1f\x7f]/.test(token))
    throw new Error("再漫画：未获得有效登录凭据");
  const data = await zaimanhuaRequest(
    "/v1/userInfo/get",
    {},
    {
      origin: zaimanhuaAccountOrigin,
      common: false,
      token,
    },
  );
  const user = data.userInfo;
  if (!user || !/^[1-9]\d*$/.test(zaimanhuaText(user.uid)))
    throw new Error("再漫画：账号资料校验失败");
  const photo = zaimanhuaText(user.photo);
  return {
    uid: zaimanhuaText(user.uid),
    profile: {
      token,
      displayName: zaimanhuaText(user.nickname) || "再漫画用户",
      avatarUrl: zaimanhuaImageUrl(
        photo.startsWith("/") && !photo.startsWith("//")
          ? zaimanhuaOrigin + photo
          : photo,
      ),
    },
  };
}

/** @param {SourceLoginContext} context @param {string} [message] */
async function zaimanhuaCaptcha(
  context,
  message = "请按提示图中的顺序点击文字",
) {
  for (;;) {
    const captcha = await zaimanhuaRequest(
      "/lpi/v1/captcha/click/create",
      {},
      { anonymous: true },
    );
    const captchaId = zaimanhuaText(captcha.captchaId);
    if (
      !captchaId ||
      !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(
        zaimanhuaText(captcha.bigImg),
      ) ||
      !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(
        zaimanhuaText(captcha.verifyImg),
      )
    )
      throw new Error("再漫画：验证码数据异常");
    // Only use metadata to specify the number of clicks. The user solves the
    // challenge; no coordinates from the server are used as an answer.
    let pointCount;
    try {
      const count = Object.keys(JSON.parse(zaimanhuaText(captcha.dots))).length;
      if (count >= 1 && count <= 32) pointCount = count;
    } catch {
      /* Older responses may omit point-count metadata. */
    }
    const answer = await context.requestClickCaptcha({
      title: "再漫画登录验证",
      message,
      image: captcha.bigImg,
      hintImage: captcha.verifyImg,
      ...(pointCount ? { pointCount } : {}),
    });
    if (answer.status === "refresh") continue;
    return { captchaId, points: answer.points };
  }
}

/** @param {string} provider @param {SourceLoginContext} context */
async function zaimanhuaBrowserLogin(provider, context) {
  /** @type {Record<string, string>} */
  const origins = {
    wechat: "https://open.weixin.qq.com",
    qq: "https://graph.qq.com",
    weibo: "https://api.weibo.com",
  };
  const backUrl = "https://i.zaimanhua.com/login";
  const data = await zaimanhuaRequest(
    `/lpi/v1/${provider}/web/auth_url`,
    { backUrl },
    { anonymous: true },
  );
  const url = zaimanhuaText(data.url);
  if (
    !url.startsWith(origins[provider] + "/") ||
    !zaimanhuaQueryValue(url, "state") ||
    zaimanhuaQueryValue(url, "redirect_uri") !==
      `${zaimanhuaAccountOrigin}/v1/${provider}/web/auth_back`
  )
    throw new Error("再漫画：第三方授权入口异常");
  // Provider state is opaque and consumed by the site's /auth_back endpoint.
  // Keep the authorization URL unchanged and verify the final site token.
  const result = await context.requestBrowserAuthorization({
    title: "再漫画授权登录",
    url,
    callbacks: [
      {
        origin: "https://i.zaimanhua.com",
        path: "/login",
        requiredQueryKeys: ["token"],
      },
    ],
  });
  if (result.status === "timeout")
    throw Hazuki.error("AUTH_TIMEOUT", "再漫画：授权超时，请重试");
  if (!/^https:\/\/i\.zaimanhua\.com\/login(?:\?|#|$)/.test(result.url))
    throw new Error("再漫画：授权回调地址异常");
  return zaimanhuaQueryValue(result.url, "token");
}

/** @param {string} account @param {string} password @param {SourceLoginContext} [context] */
async function zaimanhuaLogin(account, password, context) {
  if (!context)
    throw Hazuki.error(
      "INTERACTION_REQUIRED",
      "请更新 Hazuki 并从登录入口重新登录",
    );
  const method = context.method;
  if (!["password", "sms", "wechat", "qq", "weibo"].includes(method))
    throw new Error("再漫画：未知登录方式");
  if (method === "password" && (!account.trim() || !password))
    throw new Error("请输入账号和密码");
  if (method === "sms" && !/^1[3-9]\d{9}$/.test(account.trim()))
    throw new Error("请输入正确的手机号");
  const config = await zaimanhuaRequest(
    "/api/v1/comic1/config",
    {},
    { anonymous: true },
  );
  const clientId = zaimanhuaText(config.clientId);
  if (!clientId) throw new Error("再漫画：登录配置缺少客户端标识");
  await Hazuki.storage.set("clientId", clientId);
  let token = "";
  if (["wechat", "qq", "weibo"].includes(method)) {
    token = await zaimanhuaBrowserLogin(method, context);
  } else {
    let message;
    for (;;) {
      const captcha = await zaimanhuaCaptcha(context, message);
      const response =
        method === "password"
          ? await zaimanhuaApi(
              "/lpi/v1/login/passwd",
              {
                username: account.trim(),
                passwd: Hazuki.convert.hexEncode(
                  Hazuki.convert.md5(Hazuki.convert.encodeUtf8(password)),
                ),
                captchaId: captcha.captchaId,
                captchaResult: JSON.stringify(captcha.points),
                captchaCate: 2,
              },
              { method: "POST", anonymous: true, allowError: true },
            )
          : await zaimanhuaApi(
              "/lpi/v1/sms/send",
              {
                phone: account.trim(),
                type: 3,
                digits: JSON.stringify(captcha.points),
                captchaId: captcha.captchaId,
                captchaCate: 2,
              },
              { anonymous: true, allowError: true },
            );
      if ([101, 102].includes(Number(response.errno))) {
        message = "验证未通过或已过期，请重新按提示顺序点击";
        continue;
      }
      if (Number(response.errno) !== 0)
        throw new Error(
          "再漫画：" + (zaimanhuaText(response.errmsg) || "登录失败"),
        );
      if (method === "password") {
        token = zaimanhuaText(response.data?.user?.token);
      } else {
        const code = (
          await context.requestText({
            title: "输入短信验证码",
            message: "验证码已发送到你输入的手机号",
            keyboardType: "number",
          })
        ).trim();
        if (!/^\d+$/.test(code)) throw new Error("短信验证码应为数字");
        const data = await zaimanhuaRequest(
          "/lpi/v1/login/sms",
          {
            phone: account.trim(),
            sms_code: code,
          },
          { method: "POST", anonymous: true },
        );
        token = zaimanhuaText(data.user?.token);
      }
      break;
    }
  }
  // The host stages these writes during interactive login. Only a verified
  // account reaches this point; cancellation and failure never save a new token.
  const verified = await zaimanhuaVerifyToken(token);
  await Hazuki.secrets.set("session", token);
  await Hazuki.storage.set("uid", verified.uid);
  return verified.profile;
}

/** @param {SourceReadingProgress} progress */
async function zaimanhuaReadingProgress(progress) {
  const token = await Hazuki.secrets.get("session");
  if (!token) return;
  const comicId = Number(zaimanhuaId(progress.comicId));
  const chapterId = Number(zaimanhuaId(progress.chapterId));
  if (
    !Number.isSafeInteger(comicId) ||
    !Number.isSafeInteger(chapterId) ||
    !Number.isInteger(progress.page) ||
    !Number.isInteger(progress.totalPages) ||
    progress.page < 1 ||
    progress.page > progress.totalPages
  )
    throw new Error("再漫画：阅读进度数据异常");
  await zaimanhuaApi(
    "/app/v1/readingRecord/add",
    {
      source: "mh",
      json: JSON.stringify([
        { bizId: comicId, chapterId, page: progress.page },
      ]),
    },
    { method: "POST", token },
  );
}

/** @returns {Promise<string>} */
async function zaimanhuaReadingSession() {
  const token = await Hazuki.secrets.get("session");
  if (!token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：请先登录再读取网站阅读进度");
  return token;
}

/** The website displays record directly as an original, one-based image page.
 * total_num is not mapped: its image-count semantics have not been verified.
 * @param {unknown} value @param {string} comicId
 * @returns {SourceCloudReadingProgress | null}
 */
function zaimanhuaParseReadingRecord(value, comicId) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("再漫画：网站阅读进度格式异常");
  const record = /** @type {ZaimanhuaData} */ (value);
  const id = zaimanhuaText(record.biz_id);
  const chapterId = zaimanhuaText(record.chapter_id);
  const pageText = zaimanhuaText(record.record);
  // The detail endpoint returns this explicit zero-valued placeholder when the
  // website has no position. Missing/malformed fields must not imitate it.
  if (chapterId === "0" && pageText === "0" && (id === "0" || id === comicId))
    return null;
  const page = Number(pageText);
  if (
    id !== comicId ||
    !/^[1-9]\d*$/.test(chapterId) ||
    !/^[1-9]\d*$/.test(pageText) ||
    !Number.isSafeInteger(page)
  )
    throw new Error("再漫画：网站阅读进度无效或与漫画不匹配");
  const seconds = Number(zaimanhuaText(record.viewing_time));
  const updatedAtMs = seconds * 1000;
  return {
    chapterId,
    page,
    ...(seconds > 0 && Number.isSafeInteger(updatedAtMs)
      ? { updatedAtMs }
      : {}),
  };
}

/** Always re-read the exact comic. Never restore from history, a local position,
 * or a session cache, and never write state from this read-only host runtime.
 * @param {string} comicId @returns {Promise<SourceCloudReadingProgress | null>}
 */
async function zaimanhuaLoadReadingProgress(comicId) {
  comicId = zaimanhuaId(comicId);
  const token = await zaimanhuaReadingSession();
  const data = await zaimanhuaRequest(
    "/api/v1/comic2/comic/detail",
    { id: comicId },
    { token },
  );
  if (!data.comicInfo || zaimanhuaText(data.comicInfo.id) !== comicId)
    throw new Error("再漫画：漫画不存在或网站阅读进度数据异常");
  return zaimanhuaParseReadingRecord(data.readingRecord, comicId);
}

/** @param {number} page @returns {Promise<{
 * items: {comic: SourceComic, progress: SourceCloudReadingProgress}[]
 * }>}
 */
async function zaimanhuaLoadReadingHistory(page) {
  const token = await zaimanhuaReadingSession();
  page = zaimanhuaPageNumber(page);
  // The account center uses pageSize here, not the size used by subscriptions.
  const data = await zaimanhuaRequest(
    "/app/v1/readingRecord/list",
    {
      source: "mh",
      page,
      pageSize: zaimanhuaPageSize,
    },
    { token },
  );
  const records =
    data.recordList === null ? [] : zaimanhuaList(data.recordList);
  if (data.recordList !== null && records.length !== data.recordList.length)
    throw new Error("再漫画：网站阅读历史列表格式异常");
  /** @type {{comic: SourceComic, progress: SourceCloudReadingProgress}[]} */
  const items = [];
  for (const record of records) {
    const id = zaimanhuaId(record.biz_id);
    const progress = zaimanhuaParseReadingRecord(record, id);
    const title = zaimanhuaText(record.title);
    if (!progress || !title)
      throw new Error("再漫画：网站阅读历史缺少漫画名称或有效阅读位置");
    items.push({
      comic: {
        id,
        title,
        cover: zaimanhuaImageUrl(record.cover),
        subTitle: zaimanhuaText(record.chapter_name),
      },
      progress,
    });
  }
  // The published history UI does not provide a reliable total. Deliberately
  // omit maxPage so the host imports every page until the website returns empty.
  return { items };
}

/** @returns {Promise<string>} */
async function zaimanhuaFavoriteSession() {
  const token = await Hazuki.secrets.get("session");
  if (!token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：请先登录再使用云端订阅");
  return token;
}

/** The website has one subscription list, without user-created folders.
 * @param {string | null | undefined} folderId
 */
function zaimanhuaFavoriteFolder(folderId) {
  if (folderId != null && folderId !== "" && folderId !== "0")
    throw new Error("再漫画：未知的云端收藏夹，请选择我的订阅");
}

/** @param {string} id @param {string} token @returns {Promise<boolean>} */
async function zaimanhuaIsSubscribed(id, token) {
  const data = await zaimanhuaRequest(
    "/app/v1/comic/sub/checkIsSub",
    {
      objId: zaimanhuaId(id),
      source: 1,
    },
    { token },
  );
  if ([true, 1, "1", "true"].includes(data.isSub)) return true;
  if ([false, 0, "0", "false"].includes(data.isSub)) return false;
  throw new Error("再漫画：订阅状态格式异常");
}

/** @param {number} page @param {string | null} folderId @returns {Promise<ComicPage>} */
async function zaimanhuaFavoriteComics(page, folderId) {
  zaimanhuaFavoriteFolder(folderId);
  const token = await zaimanhuaFavoriteSession();
  page = zaimanhuaPageNumber(page);
  // Parameters and response fields from the account center's /subscribe page.
  const data = await zaimanhuaRequest(
    "/app/v1/comic/sub/list",
    {
      status: "",
      firstLetter: "",
      page,
      size: zaimanhuaPageSize,
    },
    { token },
  );
  const total = Number(data.total);
  if (
    data.subList === null &&
    Number.isFinite(total) &&
    total >= 0 &&
    page > Math.ceil(total / zaimanhuaPageSize)
  )
    data.subList = [];
  return zaimanhuaComicPage(data, "subList", page, data.total);
}

/** @param {string | null} comicId */
async function zaimanhuaFavoriteFolders(comicId) {
  const token = await zaimanhuaFavoriteSession();
  const folders = { 0: "我的订阅" };
  if (comicId == null) return { folders };
  const favorited = await zaimanhuaIsSubscribed(comicId, token);
  return { folders, favorited: favorited ? ["0"] : [] };
}

/** @param {string} comicId @param {string} folderId @param {boolean} adding */
async function zaimanhuaSetFavorite(comicId, folderId, adding) {
  comicId = zaimanhuaId(comicId);
  zaimanhuaFavoriteFolder(folderId);
  const token = await zaimanhuaFavoriteSession();
  // The desktop detail page uses GET for both operations. Keep the exact comic
  // ID parameter; removing a subscription is never a folder-wide operation.
  await zaimanhuaApi(
    "/app/v1/comic/sub/" + (adding ? "add" : "del"),
    {
      comic_id: comicId,
    },
    { token },
  );
}

/** @param {unknown} value @returns {ZaimanhuaData[]} */
function zaimanhuaList(value) {
  if (!Array.isArray(value)) throw new Error("再漫画：接口列表格式异常");
  return value.filter((item) => item && typeof item === "object");
}

/** @param {unknown} value @returns {SourceComic[]} */
function zaimanhuaComics(value) {
  const seen = new Set();
  /** @type {SourceComic[]} */
  const comics = [];
  for (const item of zaimanhuaList(value)) {
    const id = zaimanhuaText(item.id || item.comic_id || item.obj_id);
    const title = zaimanhuaText(item.title || item.name);
    if (!/^[1-9]\d*$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    comics.push({
      id,
      title,
      cover: zaimanhuaImageUrl(item.cover),
      subTitle: zaimanhuaText(item.last_update_chapter_name || item.last_name),
      tags: zaimanhuaText(item.types)
        .split(/[,，/]/)
        .filter(Boolean),
    });
  }
  return comics;
}

/** @param {ZaimanhuaData} data @param {string} key @param {number} page
 * @param {unknown} total @returns {ComicPage}
 */
function zaimanhuaComicPage(data, key, page, total) {
  const count = Number(total);
  // The site represents a genuinely empty result as null on some list routes.
  const items =
    data[key] === null && count === 0 ? [] : zaimanhuaList(data[key]);
  return {
    comics: zaimanhuaComics(items),
    maxPage:
      Number.isFinite(count) && count >= 0
        ? Math.max(1, Math.ceil(count / zaimanhuaPageSize))
        : items.length >= zaimanhuaPageSize
          ? page + 1
          : page,
  };
}

/** @param {number} page @returns {Promise<ComicPage>} */
async function zaimanhuaUpdates(page) {
  page = zaimanhuaPageNumber(page);
  const data = await zaimanhuaRequest("/api/v1/comic2/update_list", {
    page,
    size: zaimanhuaPageSize,
  });
  return zaimanhuaComicPage(data, "comicList", page, data.totalNum);
}

/** @returns {Promise<ZaimanhuaData>} */
async function zaimanhuaHome() {
  const result = await zaimanhuaRequest("/api/v1/comic2/index");
  if (!result.data || typeof result.data !== "object")
    throw new Error("再漫画：首页数据格式异常");
  return result.data;
}

/** @param {string} option @param {number} page @returns {Promise<ComicPage>} */
async function zaimanhuaRanking(option, page) {
  const [cate = "1", duration = "1"] = option.split(":");
  if (!/^[1-2]$/.test(cate) || !/^[1-3]$/.test(duration))
    throw new Error("再漫画：无效的排行选项");
  page = zaimanhuaPageNumber(page);
  const data = await zaimanhuaRequest("/api/v1/comic1/rank_list", {
    page,
    size: zaimanhuaPageSize,
    cate,
    duration,
    tag: 0,
    theme: 0,
  });
  return zaimanhuaComicPage(data, "list", page, data.totalNum);
}

/** @param {unknown} value */
function zaimanhuaTagNames(value) {
  return Array.isArray(value)
    ? value.map((item) => zaimanhuaText(item?.tagName)).filter(Boolean)
    : [];
}

/** @param {string} id @returns {Promise<SourceComicDetails>} */
async function zaimanhuaDetails(id) {
  id = zaimanhuaId(id);
  const data = await zaimanhuaRequest("/api/v1/comic2/comic/detail", { id });
  const info = data.comicInfo;
  if (!info || zaimanhuaText(info.id) !== id || !zaimanhuaText(info.title))
    throw new Error("再漫画：漫画不存在或详情数据异常");
  const groups = zaimanhuaList(info.chapterList);
  // A Map preserves reading order for numeric chapter IDs. Plain object keys
  // would be enumerated numerically, scrambling volumes and alternate releases.
  /** @type {Map<string, string>} */
  const chapters = new Map();
  /** @type {SourceChapterGroup[]} */
  const chapterGroups = [];
  /** @type {Map<string, number>} */
  const groupTitles = new Map();
  for (const group of groups) {
    const groupTitle = zaimanhuaText(group.title) || "未分类";
    const occurrence = (groupTitles.get(groupTitle) || 0) + 1;
    groupTitles.set(groupTitle, occurrence);
    /** @type {SourceChapterGroup} */
    const nativeGroup = {
      id: "group:" + encodeURIComponent(groupTitle) + ":" + occurrence,
      title: groupTitle,
      chapters: [],
    };
    const items = zaimanhuaList(group.data).slice();
    // The server sends each group newest first. Explicit chapter_order takes
    // priority; reversing is the fallback when that field is absent.
    items.reverse();
    if (items.every((item) => Number.isFinite(Number(item.chapter_order))))
      items.sort((a, b) => Number(a.chapter_order) - Number(b.chapter_order));
    for (const item of items) {
      const chapterId = zaimanhuaId(item.chapter_id);
      const title = zaimanhuaText(item.chapter_title) || "未命名章节";
      const prefix = groups.length > 1 ? zaimanhuaText(group.title) : "";
      if (!chapters.has(chapterId)) {
        chapters.set(chapterId, (prefix ? prefix + " · " : "") + title);
        nativeGroup.chapters.push({ id: chapterId, title });
      }
    }
    if (nativeGroup.chapters.length) chapterGroups.push(nativeGroup);
  }
  const authors = zaimanhuaTagNames(info.authorsTagList);
  const themes = zaimanhuaTagNames(info.themeTagList);
  const status = zaimanhuaTagNames(info.statusTagList);
  const audience = zaimanhuaTagNames(info.cateTagList);
  const region = zaimanhuaTagNames(info.zoneTagList);
  let isFavorite;
  const token = await Hazuki.secrets.get("session");
  if (token) {
    try {
      isFavorite = await zaimanhuaIsSubscribed(id, token);
    } catch {
      // Optional account metadata must not prevent public chapters from loading.
      // The explicit favorites operations still report authentication/errors.
      Hazuki.log("再漫画：订阅状态加载失败", "warning");
    }
  }
  /** @type {SourceComic[]} */
  let recommend = [];
  try {
    const related = await zaimanhuaRequest("/api/v1/comic1/comic/same_list", {
      comic_id: id,
    });
    recommend = zaimanhuaComics(related.data?.comicList);
  } catch (error) {
    Hazuki.log("再漫画：相关推荐加载失败：" + String(error), "warning");
  }
  const timestamp = Number(info.lastUpdateTime);
  return {
    id,
    title: zaimanhuaText(info.title),
    cover: zaimanhuaImageUrl(info.cover),
    description: [info.description, info.comicNotice]
      .map(zaimanhuaText)
      .filter(Boolean)
      .join("\n\n"),
    updateTime:
      Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString().slice(0, 10)
        : undefined,
    chapters,
    chapterGroups,
    ...(isFavorite !== undefined ? { isFavorite } : {}),
    tags: {
      作者: authors,
      题材: themes,
      状态: status,
      读者: audience,
      地区: region,
    },
    infoFields: [
      { label: "作者", values: authors, action: "search" },
      { label: "题材", values: themes },
      { label: "状态", values: status },
      { label: "读者", values: audience },
      { label: "地区", values: region },
      {
        label: "别名",
        values: [info.aliasName, info.realName]
          .map(zaimanhuaText)
          .filter(Boolean),
        action: "search",
      },
      { label: "最近更新", values: zaimanhuaText(info.lastUpdateChapterName) },
    ],
    headerStats: [
      ...status.map((text) => ({ text })),
      ...(info.hotNumStr
        ? [{ text: "人气 " + zaimanhuaText(info.hotNumStr) }]
        : []),
      ...(info.subNumStr
        ? [{ text: "订阅 " + zaimanhuaText(info.subNumStr) }]
        : []),
    ],
    recommend,
  };
}

Hazuki.registerSource({
  id: "zaimanhua",
  name: "再漫画",
  version: "1.2.0",
  apiVersion: 1,
  presentation: {
    buttons: [
      { id: "copyComicId", location: "comicDetailInfo" },
      { id: "relatedComics", location: "comicDetailTabs" },
    ],
    listTagGroups: ["题材"],
    skipPeriodicRelogin: true,
    refreshCloudFavorites: true,
    directComicIdRules: {
      patterns: [
        "^(\\d+)$",
        "^https?://manhua\\.zaimanhua\\.com/details/(\\d+)/?(?:[?#].*)?$",
        "^https?://manhua\\.zaimanhua\\.com/view/[^/]+/(\\d+)/\\d+/?(?:[?#].*)?$",
      ],
      extractDigits: false,
    },
    dailyRecommendation: { mode: "plugin" },
  },
  account: {
    loginMethods: [
      { id: "password", title: "账号密码", input: "credentials" },
      { id: "sms", title: "手机短信", input: "account" },
      { id: "wechat", title: "微信授权", input: "none" },
      { id: "qq", title: "QQ 授权", input: "none" },
      { id: "weibo", title: "微博授权", input: "none" },
    ],
    login: zaimanhuaLogin,
    loadProfile: async () => {
      const token = await Hazuki.secrets.get("session");
      if (!token) throw Hazuki.error("AUTH_EXPIRED", "再漫画：请重新登录");
      const verified = await zaimanhuaVerifyToken(token);
      await Hazuki.storage.set("uid", verified.uid);
      return verified.profile;
    },
    logout: async () => {
      await Hazuki.secrets.delete("session");
      await Hazuki.storage.delete("uid");
      await Hazuki.cookies.delete(zaimanhuaOrigin);
      await Hazuki.cookies.delete(zaimanhuaAccountOrigin);
    },
  },
  favorites: {
    singleFolderForSingleComic: true,
    loadComics: zaimanhuaFavoriteComics,
    loadFolders: zaimanhuaFavoriteFolders,
    addOrDelFavorite: zaimanhuaSetFavorite,
  },
  dailyRecommendation: {
    load: async () =>
      zaimanhuaList((await zaimanhuaHome()).bannerList)
        .filter(
          (item) =>
            Number(item.type) === 1 &&
            /^[1-9]\d*$/.test(zaimanhuaText(item.obj_id)),
        )
        .map((item) => ({
          id: zaimanhuaText(item.obj_id),
          title: zaimanhuaText(item.title),
          imageUrl: zaimanhuaImageUrl(item.cover),
          caption: zaimanhuaText(item.sub_title),
        })),
  },
  explore: [
    {
      title: "首页",
      type: "singlePageWithMultiPart",
      load: async () => {
        const home = await zaimanhuaHome();
        return {
          精品力荐: zaimanhuaComics(home.recList),
          最新更新: zaimanhuaComics(home.updateList),
          本周排行: zaimanhuaComics(home.weekRankList),
          本月排行: zaimanhuaComics(home.monthRankList),
        };
      },
    },
    { title: "最新更新", type: "multiPageComicList", load: zaimanhuaUpdates },
    {
      title: "人气周榜",
      type: "multiPageComicList",
      load: (page) => zaimanhuaRanking("1:1", page),
    },
  ],
  category: {
    title: "再漫画",
    parts: [
      {
        name: "题材",
        type: "fixed",
        itemType: "category",
        categories: zaimanhuaThemes.map((item) => item[1]),
        categoryParams: zaimanhuaThemes.map((item) => item[0]),
      },
    ],
  },
  categoryComics: {
    optionList: [
      { label: "状态", options: ["0-全部", "1-连载", "2-完结"] },
      {
        label: "读者",
        options: ["0-全部", "3262-少年", "3263-少女", "3264-青年"],
      },
      { label: "类型", options: ["0-全部", "1-故事漫画", "2-四格多格"] },
    ],
    load: async (category, param, options, page) => {
      const theme =
        param ??
        zaimanhuaThemes.find((item) => item[1] === category)?.[0] ??
        "0";
      if (!zaimanhuaThemes.some((item) => item[0] === theme))
        throw new Error("再漫画：未知的题材分类");
      page = zaimanhuaPageNumber(page);
      const data = await zaimanhuaRequest("/api/v1/comic1/filter", {
        theme,
        // The site's popularity sort currently returns null with a nonzero
        // total; keep the working update order and use rankings for popularity.
        sortType: 0,
        status: options[0] || "0",
        audience: options[1] || "0",
        cate: options[2] || "0",
        firstLetter: "",
        page,
        size: zaimanhuaPageSize,
      });
      return zaimanhuaComicPage(data, "comicList", page, data.totalNum);
    },
    ranking: {
      // The public site's subscription/roast rankings are empty, and its
      // comment rankings have neither comic IDs nor titles. Expose usable lists.
      options: ["人气", "点击"].flatMap((label, index) =>
        ["周榜", "月榜", "总榜"].map(
          (period, duration) =>
            `${index + 1}:${duration + 1}-${label}${period}`,
        ),
      ),
      load: zaimanhuaRanking,
    },
  },
  search: {
    load: async (keyword, _options, page) => {
      page = zaimanhuaPageNumber(page);
      const data = await zaimanhuaRequest("/app/v1/search/index", {
        keyword: keyword.trim(),
        source: 0,
        page,
        size: zaimanhuaPageSize,
      });
      return zaimanhuaComicPage(data, "list", page, data.total);
    },
  },
  comic: {
    loadInfo: zaimanhuaDetails,
    onReadingProgress: zaimanhuaReadingProgress,
    loadReadingProgress: zaimanhuaLoadReadingProgress,
    loadReadingHistory: zaimanhuaLoadReadingHistory,
    loadEp: async (comicId, chapterId) => {
      comicId = zaimanhuaId(comicId);
      chapterId = zaimanhuaId(chapterId);
      const data = await zaimanhuaRequest("/api/v1/comic2/chapter/detail", {
        comic_id: comicId,
        chapter_id: chapterId,
      });
      const info = data.chapterInfo;
      if (
        !info ||
        zaimanhuaText(info.comic_id) !== comicId ||
        zaimanhuaText(info.chapter_id) !== chapterId
      )
        throw new Error("再漫画：章节不存在或与漫画不匹配");
      if (!Array.isArray(info.page_url) || !info.page_url.length)
        throw new Error("再漫画：章节暂无可用图片，可能需要登录或购买后阅读");
      const images = info.page_url.map(zaimanhuaImageUrl);
      if (images.some((/** @type {string} */ url) => !url))
        throw new Error("再漫画：章节图片地址异常");
      return { images };
    },
    onImageLoad: (url) => ({
      url,
      headers: {
        Referer: zaimanhuaOrigin + "/",
        "User-Agent": zaimanhuaUserAgent,
      },
    }),
  },
});
