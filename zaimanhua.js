/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

/*
 * Original Hazuki API v1 source for 再漫画 (https://manhua.zaimanhua.com/).
 * Written for this repository under GPL-3.0; see LICENSE. No upstream code copied.
 * Routes and field names were observed in the public desktop site's responses:
 *   /app/v1/search/index
 *   /app/v1/comic/sub/{list,checkIsSub,add,del}
 *   /app/v1/comment/{list,addLike}
 *   https://v4api.zaimanhua.com/app/v1/comment/create
 *   https://i.zaimanhua.com/lpi/v1/task/{list,sign_in}
 *   /api/v1/comic1/{filter,rank_list,comic/same_list}
 *   /api/v1/comic2/{index,update_list,comic/detail,chapter/detail}
 * Optional account flows use the site's own point captcha/SMS and browser OAuth
 * endpoints. Native chapter groups and login interactions require the updated host.
 * Browser OAuth state is passed unchanged to the provider and consumed by the
 * site's account backend; the final token is verified before saving a session.
 */

const zaimanhuaOrigin = "https://manhua.zaimanhua.com";
const zaimanhuaAccountOrigin = "https://account-api.zaimanhua.com";
const zaimanhuaUserCenterOrigin = "https://i.zaimanhua.com";
const zaimanhuaPageSize = 20;
// The host comments gateway displays 16 entries per page.
const zaimanhuaCommentPageSize = 16;
// The mixed website list accepts at most 100 records per request. Fetch batches
// independently of host pages so reply-only pages cannot stop main pagination.
const zaimanhuaCommentBatchSize = 100;
const zaimanhuaUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** @typedef {Record<string, any>} ZaimanhuaData */
/** @typedef {{method?: 'GET' | 'POST', anonymous?: boolean, token?: string,
 * allowError?: boolean, origin?: string, referer?: string, common?: boolean,
 * jsonBody?: Record<string, unknown>}} ZaimanhuaRequestOptions */
/** @typedef {{status: 'success' | 'alreadyCheckedIn' | 'skipped', message?: string}} ZaimanhuaCheckInResult */
/** @type {{token: string, promise: Promise<ZaimanhuaCheckInResult>} | null} */
let zaimanhuaCheckInPending = null;

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
    Referer: options.referer || zaimanhuaOrigin + "/",
    "User-Agent": zaimanhuaUserAgent,
    Platform: "pc",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const clientId = zaimanhuaText(Hazuki.storage.get("clientId"));
  if (clientId) headers["X-Client-ID"] = clientId;
  if (options.jsonBody) headers["Content-Type"] = "application/json";
  // Legacy POSTs use query parameters; the v4 comment API uses a JSON body. Do not log
  // request URLs or caught network errors: login parameters can contain secrets.
  let response;
  try {
    response =
      options.method === "POST"
        ? await Hazuki.http.post(
            url,
            headers,
            options.jsonBody ? JSON.stringify(options.jsonBody) : undefined,
          )
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

/** @returns {Promise<string>} */
async function zaimanhuaFavoriteSession() {
  const token = await Hazuki.secrets.get("session");
  if (!token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：请先登录再使用云端订阅");
  return token;
}

/** Read the website's daily status, not a device date or an App-only record.
 * @param {string} token @returns {Promise<boolean>}
 */
async function zaimanhuaSignedToday(token) {
  const data = await zaimanhuaRequest(
    "/lpi/v1/task/list",
    {},
    {
      token,
      origin: zaimanhuaUserCenterOrigin,
      referer: zaimanhuaUserCenterOrigin + "/",
      common: false,
    },
  );
  const signed = data.task?.signInfo?.currentSign;
  if (typeof signed !== "boolean")
    throw new Error("再漫画：签到状态格式异常，请稍后重试");
  return signed;
}

/** @returns {Promise<boolean | null>} */
async function zaimanhuaCheckInStatus() {
  const token = await Hazuki.secrets.get("session");
  return token ? zaimanhuaSignedToday(token) : null;
}

/** @param {string} token @returns {Promise<ZaimanhuaCheckInResult>} */
async function zaimanhuaPerformCheckIn(token) {
  if (await zaimanhuaSignedToday(token))
    return { status: "alreadyCheckedIn", message: "今日已签到" };
  if ((await Hazuki.secrets.get("session")) !== token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：登录状态已变化，请重试签到");
  // The public website calls sign_in() without body/query arguments. It does not
  // claim unrelated tasks or cumulative rewards as part of the sign-in action.
  const result = await zaimanhuaApi(
    "/lpi/v1/task/sign_in",
    {},
    {
      method: "POST",
      token,
      origin: zaimanhuaUserCenterOrigin,
      referer: zaimanhuaUserCenterOrigin + "/",
      common: false,
      allowError: true,
    },
  );
  const message = zaimanhuaText(result.errmsg);
  if (Number(result.errno) !== 0) {
    // Another client can sign after the status read. Confirm that state before
    // treating a duplicate-sign response as already completed.
    if (
      /(?:已(?:经)?签到|重复签到)/.test(message) &&
      (await zaimanhuaSignedToday(token))
    )
      return { status: "alreadyCheckedIn", message };
    throw new Error("再漫画：" + (message || "签到失败，请稍后重试"));
  }
  if (!(await zaimanhuaSignedToday(token)))
    throw new Error("再漫画：网站尚未确认签到成功，请刷新状态后重试");
  return { status: "success", message: message || "签到成功" };
}

/** Deduplicate simultaneous manual/automatic check-ins for the same session.
 * @returns {Promise<ZaimanhuaCheckInResult>}
 */
async function zaimanhuaCheckIn() {
  const token = await Hazuki.secrets.get("session");
  if (!token) return { status: "skipped" };
  if (zaimanhuaCheckInPending?.token === token)
    return zaimanhuaCheckInPending.promise;
  const pending = { token, promise: zaimanhuaPerformCheckIn(token) };
  zaimanhuaCheckInPending = pending;
  try {
    return await pending.promise;
  } finally {
    if (zaimanhuaCheckInPending === pending) zaimanhuaCheckInPending = null;
  }
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

/** Keep promotional titles/art separate from the target comic's metadata.
 * @returns {Promise<SourceDailyRecommendationItem[]>}
 */
async function zaimanhuaRecommendations() {
  const banners = zaimanhuaList((await zaimanhuaHome()).bannerList).filter(
    (item) =>
      Number(item.type) === 1 && /^[1-9]\d*$/.test(zaimanhuaText(item.obj_id)),
  );
  const ids = [...new Set(banners.map((item) => zaimanhuaText(item.obj_id)))];
  // A comic may have several banners. Fetch its identity once while keeping
  // every promotional item in the website's original order.
  /** @type {Map<string, {title: string, cover: string}>} */
  const comics = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const data = await zaimanhuaRequest("/api/v1/comic2/comic/detail", {
        id,
      });
      const info = data.comicInfo;
      if (!info || zaimanhuaText(info.id) !== id || !zaimanhuaText(info.title))
        throw new Error("再漫画：轮播目标漫画不存在或资料异常");
      comics.set(id, {
        title: zaimanhuaText(info.title),
        cover: zaimanhuaImageUrl(info.cover),
      });
    }),
  );
  return banners.map((item) => {
    const id = zaimanhuaText(item.obj_id);
    const comic = comics.get(id);
    const imageUrl = zaimanhuaImageUrl(item.cover);
    if (!comic || (!comic.cover && !imageUrl))
      throw new Error("再漫画：轮播条目缺少可用图片");
    return {
      id,
      title: comic.title,
      ...(comic.cover ? { cover: comic.cover } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      bannerTitle: zaimanhuaText(item.title),
      caption: zaimanhuaText(item.sub_title),
    };
  });
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
      { label: "题材", values: themes, action: "search" },
      { label: "状态", values: status },
      { label: "读者", values: audience, action: "search" },
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

/** @param {ZaimanhuaData} row */
function zaimanhuaCommentAuthor(row) {
  return zaimanhuaText(row.author?.nickname || row.nickname) || "匿名用户";
}

/** @param {unknown} value */
function zaimanhuaCommentCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** @typedef {{id: string, sortBy: string, session: string | null,
 * roots: string[], rows: Map<string, ZaimanhuaData>,
 * parents: Map<string, string>, rootIds: Map<string, string>,
 * threads: Map<string, Set<string>>, listed: Set<string>,
 * nextPage: number, done: boolean, pending: Promise<void> | null}} ZaimanhuaCommentIndex
 */
/** @type {Map<string, ZaimanhuaCommentIndex>} */
const zaimanhuaCommentIndexes = new Map();

/** @param {string} id */
function zaimanhuaClearComments(id) {
  for (const [key, index] of zaimanhuaCommentIndexes) {
    if (index.id === id) zaimanhuaCommentIndexes.delete(key);
  }
}

/** The comma-separated IDs are current, parent, then older ancestors. Only
 * listed chains define order; map entries also contain context from other pages.
 * Validate the batch before mutating the index so a failed page can be retried.
 * @param {ZaimanhuaCommentIndex} index
 */
async function zaimanhuaReadCommentBatch(index) {
  const data = await zaimanhuaRequest("/app/v1/comment/list", {
    objId: index.id,
    sortBy: index.sortBy,
    type: 4,
    page: index.nextPage,
    size: zaimanhuaCommentBatchSize,
    top_status: 0,
    is_goods: 0,
  });
  if (
    !Array.isArray(data.commentIdList) ||
    (data.commentIdList.length > 0 &&
      (!data.commentList ||
        typeof data.commentList !== "object" ||
        Array.isArray(data.commentList)))
  )
    throw new Error("再漫画：评论列表格式异常");
  const chains = data.commentIdList.map((/** @type {unknown} */ chain) => {
    const ids = zaimanhuaText(chain).split(",").map(zaimanhuaId);
    if (new Set(ids).size !== ids.length)
      throw new Error("再漫画：评论引用关系异常");
    for (const [position, commentId] of ids.entries()) {
      const row = data.commentList[commentId];
      // A deleted ancestor may be absent. Keep surviving comments in its thread.
      if (!row && position > 0) continue;
      if (
        !row ||
        zaimanhuaText(row.id) !== commentId ||
        zaimanhuaText(row.obj_id) !== index.id ||
        typeof row.content !== "string"
      )
        throw new Error("再漫画：评论数据缺失或与漫画不匹配");
    }
    return ids;
  });
  if (
    chains.length >= zaimanhuaCommentBatchSize &&
    chains.every((/** @type {string[]} */ ids) => index.listed.has(ids[0]))
  )
    throw new Error("再漫画：评论分页未前进，请刷新后重试");
  for (const ids of chains) {
    index.listed.add(ids[0]);
    // Use the oldest surviving ancestor when the root has been deleted.
    const surviving = ids.filter(
      (/** @type {string} */ commentId) => data.commentList[commentId],
    );
    const rootId = surviving[surviving.length - 1];
    if (!index.threads.has(rootId)) {
      index.roots.push(rootId);
      index.threads.set(rootId, new Set());
    }
    for (const [position, commentId] of ids.entries()) {
      const row = data.commentList[commentId];
      index.parents.set(commentId, ids[position + 1] || "");
      if (!row) continue;
      index.rows.set(commentId, row);
      index.rootIds.set(commentId, rootId);
      if (commentId !== rootId) index.threads.get(rootId)?.add(commentId);
    }
  }
  index.nextPage++;
  // Later pages can report total=0 even when full. Never use total to stop.
  index.done = chains.length < zaimanhuaCommentBatchSize;
}

/** @param {ZaimanhuaCommentIndex} index */
async function zaimanhuaNextCommentBatch(index) {
  if (!index.pending) {
    index.pending = zaimanhuaReadCommentBatch(index).finally(() => {
      index.pending = null;
    });
  }
  await index.pending;
}

/** @param {ZaimanhuaCommentIndex} index @param {string} replyTo */
function zaimanhuaThreadComments(index, replyTo) {
  const rootId = index.rootIds.get(replyTo) || replyTo;
  return Array.from(index.threads.get(rootId) || []).filter((commentId) => {
    const seen = new Set([commentId]);
    let parent = index.parents.get(commentId);
    while (parent && !seen.has(parent)) {
      if (parent === replyTo) return true;
      seen.add(parent);
      parent = index.parents.get(parent);
    }
    return false;
  });
}

/** @param {ZaimanhuaCommentIndex} index @param {string} commentId
 * @param {boolean} reply @returns {SourceComment}
 */
function zaimanhuaSourceComment(index, commentId, reply) {
  const row = /** @type {ZaimanhuaData} */ (index.rows.get(commentId));
  const parent = index.rows.get(index.parents.get(commentId) || "");
  const timestamp = Number(row.create_time) * 1000;
  const liked = row.stats?.is_like ?? row.is_like;
  return {
    id: commentId,
    userName:
      zaimanhuaCommentAuthor(row) +
      (reply && parent ? " 👉 " + zaimanhuaCommentAuthor(parent) : ""),
    avatar: zaimanhuaImageUrl(row.author?.photo || row.photo),
    content: row.content,
    ...(Number.isFinite(timestamp) && timestamp > 0 && timestamp <= 8.64e15
      ? { time: new Date(timestamp).toISOString() }
      : {}),
    score: zaimanhuaCommentCount(row.stats?.like_amount ?? row.like_amount),
    isLiked: [true, 1, "1", "true"].includes(liked),
    replyCount: Math.max(
      zaimanhuaCommentCount(row.stats?.reply_amount ?? row.reply_amount),
      index.threads.get(commentId)?.size || 0,
    ),
  };
}

/** Group the site's mixed list into native host threads. Fetch enough raw pages
 * for each logical page, including when whole raw pages contain only replies.
 * @param {string} id @param {string | null} _subId @param {number} page
 * @param {string | null} replyTo @param {string} [order]
 * @returns {Promise<{comments: SourceComment[], maxPage: number}>}
 */
async function zaimanhuaComments(id, _subId, page, replyTo, order = "1") {
  id = zaimanhuaId(id);
  if (replyTo !== null) replyTo = zaimanhuaId(replyTo);
  const sortBy = order || "1";
  if (!["1", "2"].includes(sortBy)) throw new Error("再漫画：未知的评论排序");
  page = zaimanhuaPageNumber(page);
  const key = id + ":" + sortBy;
  const session = await Hazuki.secrets.get("session");
  let index = zaimanhuaCommentIndexes.get(key);
  if (!index || index.session !== session || (!replyTo && page === 1)) {
    index = {
      id,
      sortBy,
      session,
      roots: [],
      rows: new Map(),
      parents: new Map(),
      rootIds: new Map(),
      threads: new Map(),
      listed: new Set(),
      nextPage: 1,
      done: false,
      pending: null,
    };
    // Keep a few active comic/order snapshots, never persist account comments.
    zaimanhuaCommentIndexes.delete(key);
    if (zaimanhuaCommentIndexes.size >= 4) {
      const oldest = zaimanhuaCommentIndexes.keys().next().value;
      if (oldest) zaimanhuaCommentIndexes.delete(oldest);
    }
    zaimanhuaCommentIndexes.set(key, index);
  }
  const end = page * zaimanhuaCommentPageSize;
  let ids = replyTo ? zaimanhuaThreadComments(index, replyTo) : index.roots;
  while (!index.done && ids.length <= end) {
    await zaimanhuaNextCommentBatch(index);
    ids = replyTo ? zaimanhuaThreadComments(index, replyTo) : index.roots;
  }
  return {
    comments: ids
      .slice(end - zaimanhuaCommentPageSize, end)
      .map((commentId) => zaimanhuaSourceComment(index, commentId, !!replyTo)),
    maxPage: ids.length > end || !index.done ? page + 1 : page,
  };
}

/** @returns {Promise<string>} */
async function zaimanhuaCommentSession() {
  const token = await Hazuki.secrets.get("session");
  if (!token)
    throw Hazuki.error("AUTH_EXPIRED", "再漫画：请先登录再发表评论或点赞");
  return token;
}

/** @param {string} value */
function zaimanhuaCommentNumericId(value) {
  const id = Number(zaimanhuaId(value));
  if (!Number.isSafeInteger(id))
    throw new Error("再漫画：评论 ID 超出有效范围");
  return id;
}

/** The public composer uses comic-level type=4, including in the reader.
 * @param {string} id @param {string | null} _subId @param {string} text
 * @param {string | null} replyTo
 */
async function zaimanhuaSendComment(id, _subId, text, replyTo) {
  const comicId = zaimanhuaCommentNumericId(id);
  const parentId = replyTo ? zaimanhuaCommentNumericId(replyTo) : 0;
  text = text.trim();
  if (!text || text.length > 1000)
    throw new Error("再漫画：评论内容应为 1～1000 个字符");
  const token = await zaimanhuaCommentSession();
  if (!zaimanhuaText(Hazuki.storage.get("clientId"))) {
    const config = await zaimanhuaRequest(
      "/api/v1/comic1/config",
      {},
      { anonymous: true },
    );
    const clientId = zaimanhuaText(config.clientId);
    if (!clientId) throw new Error("再漫画：缺少客户端标识，请重新登录");
    await Hazuki.storage.set("clientId", clientId);
  }
  await zaimanhuaApi(
    "/app/v1/comment/create",
    {},
    {
      method: "POST",
      origin: "https://v4api.zaimanhua.com",
      common: false,
      token,
      jsonBody: {
        obj_id: comicId,
        content: text,
        to_comment_id: parentId,
        type: 4,
        mentions: [],
      },
    },
  );
  zaimanhuaClearComments(String(comicId));
}

/** Only addLike is exposed by the observed website; do not invent an unlike API.
 * @param {string} id @param {string | null} _subId
 * @param {string} commentId @param {boolean} isLike
 */
async function zaimanhuaLikeComment(id, _subId, commentId, isLike) {
  zaimanhuaId(id);
  commentId = zaimanhuaId(commentId);
  if (!isLike) throw new Error("再漫画：暂不支持取消点赞");
  const token = await zaimanhuaCommentSession();
  await zaimanhuaApi(
    "/app/v1/comment/addLike",
    { type: 4, commentId },
    {
      method: "POST",
      token,
    },
  );
  zaimanhuaClearComments(id);
}

Hazuki.registerSource({
  id: "zaimanhua",
  name: "再漫画",
  version: "1.5.1",
  apiVersion: 1,
  presentation: {
    showComments: true,
    commentReplies: true,
    commentOrders: { 1: "最新", 2: "热门" },
    commentDefaultOrder: "1",
    buttons: [
      { id: "checkIn", location: "homeProfile" },
      { id: "autoCheckIn", location: "other" },
      { id: "copyComicId", location: "comicDetailInfo" },
      { id: "relatedComics", location: "comicDetailTabs" },
    ],
    listTagGroups: ["题材"],
    skipPeriodicRelogin: true,
    dailyCheckIn: true,
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
    checkInStatus: zaimanhuaCheckInStatus,
    checkIn: zaimanhuaCheckIn,
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
    load: zaimanhuaRecommendations,
  },
  explore: [
    {
      title: "首页",
      type: "multiPartPage",
      load: async () => {
        const home = await zaimanhuaHome();
        return [
          { title: "精品力荐", comics: zaimanhuaComics(home.recList) },
          {
            title: "最新更新",
            comics: zaimanhuaComics(home.updateList),
            viewMore: "explore:1",
          },
          { title: "本周排行", comics: zaimanhuaComics(home.weekRankList) },
          { title: "本月排行", comics: zaimanhuaComics(home.monthRankList) },
        ];
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
    loadComments: zaimanhuaComments,
    sendComment: zaimanhuaSendComment,
    likeComment: zaimanhuaLikeComment,
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
