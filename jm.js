/*
 * JMComic (18comic.vip) source for Hazuki.
 *
 * The web front end is protected by Cloudflare, so this source normally uses
 * the official JMComic app API. Web comments can optionally use an authorized
 * browser session when the app API's comment rate limit applies. Source
 * lineage and attribution are kept in the repository: venera-configs/jm.js
 * (commit e28e...) and dev/upstream/jm/UPSTREAM.md.
 */
/// <reference path="docs/hazuki-source.d.ts" />
// @ts-check

const JM = {
  webHost: '18comic.vip',
  apiSeeds: [
    'www.cdnhjk.net',
    'www.cdngwc.cc',
    'www.cdngwc.net',
    'www.cdngwc.club',
  ],
  publishUrls: [
    'https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt',
    'https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt',
    'https://rup4a04-c03.tos-cn-beijing.bytepluses.com.cn/newsvr-2025.txt',
  ],
  imageSeed: 'https://cdn-msp.jmapiproxy1.cc',
  idPattern: '^(?:jm)?(\\d{2,})$',
  userAgent:
    'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  appVersion: '2.1.11',
  tokenSecret: '18comicAPPContent',
  dataSecret: '185Hcomic3PAPP7R',
  publishSecret: 'diosfjckwpqpdfjkvnqQjsik',
};

const JM_HOST_MARKERS = [
  'jmcomic',
  '18comic',
  'jm365',
  'jmapiproxy',
  'jmdanjonproxy',
  'cdn-msp',
  'cdnhth',
  'cdntwice',
  'cdnsha',
  'cdnaspa',
  'cdnntr',
  'cdnhjk',
  'cdngwc',
  'cdnutc',
];

/**
 * Remove a legacy HTTPS port from a JM-owned URL. Other hosts and plain HTTP
 * URLs are returned unchanged.
 * @param {string} value
 */
function jmNormalizeUrl(value) {
  const text = String(value).trim();
  const match = /^(https:\/\/(?:[^/?#@]+@)?)([^:/?#]+):\d+([\s\S]*)$/i.exec(text);
  if (!match) return text;
  const host = match[2].toLowerCase();
  const owned = JM_HOST_MARKERS.some((marker) => host.includes(marker));
  if (!owned) return text;
  return match[1] + match[2] + match[3];
}

/** @param {any} value @returns {any[]} */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {string} base @param {string} value */
function jmResolveUrl(base, value) {
  const text = String(value || '').trim();
  if (!text) return base;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('//')) return 'https:' + text;
  const origin = /^https?:\/\/[^/]+/i.exec(base)?.[0] || '';
  if (text.startsWith('/')) return origin + text;
  return base.slice(0, base.lastIndexOf('/') + 1) + text;
}

/** @type {Map<string, {rootId: string, replys: any[]}>} */
const JM_COMMENT_CACHE = new Map();

class JmSession {
  constructor() {
    /** @type {string[]} */
    this.hosts = JM.apiSeeds.slice();
    this.hostCursor = 0;
    this.imageBase = JM.imageSeed;
    this.appVersion = JM.appVersion;
    /** @type {Promise<void> | null} */
    this.boot = null;
    /** @type {Promise<{status: 'success' | 'alreadyCheckedIn' | 'skipped', message?: string}> | null} */
    this.checkInTask = null;
    /** @type {Map<string, {maxPage: number}>} */
    this.favoritePagination = new Map();
    this.favoritePaginationOrder = '';
  }

  baseHost() {
    const index = Number(Hazuki.settings.get('apiDomain') ?? '1') - 1;
    return this.hosts[index] || this.hosts[0] || JM.apiSeeds[0];
  }

  baseHeaders() {
    return {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      Connection: 'keep-alive',
      Origin: 'https://localhost',
      Referer: 'https://localhost/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'X-Requested-With': 'com.example.app',
    };
  }

  /** @param {number} time */
  authHeaders(time) {
    const md5 = Hazuki.convert.md5(Hazuki.convert.encodeUtf8(time + JM.tokenSecret));
    return {
      ...this.baseHeaders(),
      Authorization: 'Bearer',
      'Sec-Fetch-Storage-Access': 'active',
      token: Hazuki.convert.hexEncode(md5),
      tokenparam: time + ',' + this.appVersion,
      'User-Agent': JM.userAgent,
    };
  }

  imageHeaders() {
    return {
      ...this.baseHeaders(),
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: 'https://' + this.baseHost() + '/',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Storage-Access': 'active',
      'User-Agent': JM.userAgent,
    };
  }

  /**
   * @param {string} payload
   * @param {string} secret
   * @returns {any}
   */
  decode(payload, secret) {
    const key = Hazuki.convert.encodeUtf8(
      Hazuki.convert.hexEncode(Hazuki.convert.md5(Hazuki.convert.encodeUtf8(secret))),
    );
    const plain = Hazuki.convert.decodeUtf8(
      Hazuki.convert.decryptAesEcb(Hazuki.convert.decodeBase64(payload), key),
    );
    const start = plain.search(/[\[{]/);
    const end = Math.max(plain.lastIndexOf('}'), plain.lastIndexOf(']'));
    if (start < 0 || end < start) throw new Error('invalid_jm_data');
    return JSON.parse(plain.slice(start, end + 1));
  }

  /** @param {Record<string, unknown>} values */
  form(values) {
    return Object.entries(values)
      .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
      .join('&');
  }

  /**
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @param {Record<string, unknown>} [values]
   * @returns {Promise<any>}
   */
  async request(method, path, values = {}) {
    const time = Math.floor(Date.now() / 1000);
    const headers = this.authHeaders(time);
    const body = this.form(values);
    /** @type {unknown} */
    let lastError = null;
    for (let offset = 0; offset < this.hosts.length; offset += 1) {
      const index = (this.hostCursor + offset) % this.hosts.length;
      const host = this.hosts[index];
      /** @type {SourceHttpResponse<string>} */
      let response;
      try {
        response =
          method === 'POST'
            ? await Hazuki.http.post(
                'https://' + host + path,
                { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
              )
            : await Hazuki.http.get('https://' + host + path, headers);
      } catch (error) {
        lastError = error;
        Hazuki.log('JM host ' + host + ' failed: ' + String(error), 'warn');
        continue;
      }
      if (response.status === 401) throw Hazuki.error('AUTH_EXPIRED', 'JM session expired');
      if (response.status !== 200) throw new Error('JM HTTP ' + response.status);
      const envelope = JSON.parse(response.body);
      if (typeof envelope.data !== 'string') {
        throw new Error(envelope.errorMsg || envelope.msg || 'invalid_jm_data');
      }
      const data = this.decode(envelope.data, time + JM.dataSecret);
      this.hostCursor = index;
      return data;
    }
    throw lastError || new Error('JM network unavailable');
  }

  async refreshHosts() {
    for (const url of JM.publishUrls) {
      try {
        const response = await Hazuki.http.get(url, this.baseHeaders());
        if (response.status !== 200) throw new Error('JM domain HTTP ' + response.status);
        const payload = this.decode(response.body, JM.publishSecret);
        const hosts = asArray(payload.Server ?? payload.Setting).filter(
          (item) => typeof item === 'string' && /^[a-z0-9.-]+$/i.test(item),
        );
        if (!hosts.length) throw new Error('invalid_jm_domains');
        this.hosts = hosts.slice(0, 4);
        this.hostCursor = 0;
        return;
      } catch (error) {
        Hazuki.log('JM domain source failed: ' + String(error), 'warn');
      }
    }
    Hazuki.log('JM kept the current API hosts', 'warn');
  }

  async refreshImageHost() {
    const shunt = String(Hazuki.settings.get('imageStream') ?? '1');
    const data = await this.request(
      'GET',
      '/setting?' + this.form({ app_img_shunt: shunt, express: '' }),
    );
    if (typeof data.jm3_version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(data.jm3_version)) {
      this.appVersion = data.jm3_version;
    }
    if (typeof data.img_host === 'string' && data.img_host.trim()) {
      const host = data.img_host.trim();
      this.imageBase = jmNormalizeUrl(
        /^https?:\/\//i.test(host) ? host : 'https://' + host.replace(/^\/\//, ''),
      ).replace(/\/+$/, '');
    }
  }

  async bootstrap() {
    if (!this.boot) {
      this.boot = (async () => {
        if (Hazuki.settings.get('refreshDomainsOnStart')) await this.refreshHosts();
        try {
          await this.refreshImageHost();
        } catch (error) {
          Hazuki.log(String(error), 'warn');
        }
      })();
    }
    await this.boot;
  }

  async maybeCheckIn() {
    if (Hazuki.settings.get('dailyCheckInTask') && Hazuki.storage.get('uid')) {
      try {
        await this.checkIn();
      } catch (error) {
        Hazuki.log(String(error), 'warn');
      }
    }
  }

  /** @param {string} path */
  async get(path) {
    await this.maybeCheckIn();
    return this.request('GET', path);
  }

  /** @param {string} path @param {Record<string, unknown>} values */
  async post(path, values) {
    await this.maybeCheckIn();
    return this.request('POST', path, values);
  }

  /** @param {string | null} folderId @param {number} page @param {string} order */
  async folderPage(folderId, page, order = 'mr') {
    const data = await this.get(
      '/favorite?' +
        this.form({
          folder_id: folderId ?? '0',
          page,
          o: order,
        }),
    );
    return this.parsePage(data.list, data.total, 20);
  }

  /** @param {string | null} folderId @param {number} page @returns {Promise<ComicPage>} */
  async favoritePage(folderId, page) {
    const selected = String(Hazuki.settings.get('favoriteOrder') || 'mr');
    if (this.favoritePaginationOrder !== selected) {
      this.favoritePagination.clear();
      this.favoritePaginationOrder = selected;
    }
    const order = selected === 'mp' || selected === 'mp_reverse' ? 'mp' : 'mr';
    const reverse = selected === 'mr_reverse' || selected === 'mp_reverse';
    if (!reverse) return this.folderPage(folderId, page, order);

    const key = String(folderId ?? '0') + ':' + order;
    let pagination = this.favoritePagination.get(key);
    /** @type {ComicPage | undefined} */
    let firstPage;
    if (page === 1 || !pagination) {
      // Publish a new snapshot before awaiting. An older request can finish
      // after a refresh without overwriting the new pagination state.
      pagination = { maxPage: 0 };
      this.favoritePagination.set(key, pagination);
      firstPage = await this.folderPage(folderId, 1, order);
      pagination.maxPage = Math.max(0, Number(firstPage.maxPage) || 0);
    }
    const apiPage = pagination.maxPage - page + 1;
    if (apiPage < 1) return { comics: [], maxPage: pagination.maxPage };
    const result =
      apiPage === 1 && firstPage
        ? firstPage
        : await this.folderPage(folderId, apiPage, order);
    return {
      comics: result.comics.slice().reverse(),
      maxPage: pagination.maxPage,
    };
  }

  /** @param {string} folderId @param {string} comicId */
  async folderContains(folderId, comicId) {
    let page = 1;
    let maxPage = 1;
    do {
      const data = await this.folderPage(folderId, page);
      if (data.comics.some((comic) => comic.id === String(comicId))) return true;
      maxPage = Number(data.maxPage || 0);
      page += 1;
    } while (page <= maxPage && page <= 100);
    return false;
  }

  /** @param {string} comicId @param {number} page */
  async commentRoots(comicId, page) {
    const data = await this.get(
      '/forum?' + this.form({ mode: 'manhua', aid: comicId, page }),
    );
    const roots = asArray(data.list);
    for (const root of roots) {
      JM_COMMENT_CACHE.set(String(comicId) + ':' + String(root.CID), {
        rootId: String(root.CID),
        replys: asArray(root.replys),
      });
    }
    return {
      roots,
      maxPage: Math.ceil(Number(data.total || 0) / 10),
    };
  }

  /** @param {string} comicId @param {string} replyTo */
  async commentThread(comicId, replyTo) {
    const comicKey = String(comicId) + ':';
    const direct = JM_COMMENT_CACHE.get(comicKey + replyTo);
    if (direct) return direct;
    let page = 1;
    let maxPage = 1;
    do {
      const data = await this.commentRoots(comicId, page);
      maxPage = data.maxPage;
      for (const [key, entry] of JM_COMMENT_CACHE) {
        if (!key.startsWith(comicKey)) continue;
        if (
          entry.rootId === replyTo ||
          entry.replys.some((row) => String(row.CID) === replyTo)
        ) {
          return entry;
        }
      }
      page += 1;
    } while (page <= maxPage && page <= 30);
    return null;
  }

  /**
   * Delete a favorite folder. "clear" deletes the folder and its comics in one
   * request, even when the folder is not empty; the ordinary delete action
   * refuses a non-empty folder. Do not re-read `/favorite` afterwards: that
   * list can still contain the folder right after deletion, and treating that
   * stale read as a failure makes the host keep the already-deleted folder.
   * The mutation response may report HTTP-level success with a failed `status`,
   * so it is checked explicitly.
   * @param {string} id
   */
  async deleteFolder(id) {
    const result = await this.post('/favorite_folder', {
      type: 'clear',
      folder_id: id,
    });
    if (
      result.status === 'fail' ||
      result.status === 'error' ||
      (typeof result.code === 'number' && result.code >= 400)
    ) {
      throw new Error(result.msg || 'Failed to delete folder');
    }
  }

  /** @param {string} account @param {string} password */
  async login(account, password) {
    const data = await this.request('POST', '/login', {
      username: account,
      password,
    });
    if (!data.uid) throw new Error(data.msg || 'invalid_login_result');
    const profile = {
      nickname: data.nickname,
      username: data.username || account,
      photo: data.photo || data.avatar,
    };
    await Hazuki.storage.set('uid', data.uid);
    await Hazuki.storage.set('profile', profile);
    return this.profile(profile, data.uid, account);
  }

  /**
   * Ask for a website session only when a comment actually needs it.
   * openWebView imports the scoped cookies and the actual WebView UA into this
   * plugin session; it does not create or replace the account profile.
   */
  async ensureWebSession() {
    if (Hazuki.storage.get('webSession') === true) return true;
    if (typeof Hazuki.ui?.openWebView !== 'function') return false;
    try {
      const view = Hazuki.ui.openWebView({
        title: '禁漫网页登录（评论/下载）',
        url: 'https://' + JM.webHost + '/login',
        completion: 'manual',
        cookieScopes: [
          {
            url: 'https://' + JM.webHost + '/',
            names: ['AVS', 'cf_clearance'],
          },
        ],
        timeoutMs: 300000,
      });
      const result = await view;
      // Import happens on completed; close any window still displayed now.
      try {
        await view.close?.();
      } catch (error) {
        // The host may already have torn the window down.
      }
      if (result.status !== 'completed') return false;
      const check = await Hazuki.http.get('https://' + JM.webHost + '/');
      if (check.status === 403 || /Just a moment/i.test(check.body)) {
        return false;
      }
      await Hazuki.storage.set('webSession', true);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Post through the website endpoint, which has its own captcha and is not
   * subject to the app API's short-term comment limit.
   * @param {string} comicId
   * @param {string} text
   * @param {string | null | undefined} replyTo
   */
  async webComment(comicId, text, replyTo) {
    if (typeof Hazuki.http.fetchBytes !== 'function') {
      throw Hazuki.error('HOST_UNSUPPORTED', '当前宿主不支持网页评论');
    }
    if (
      typeof Hazuki.ui?.openDialog !== 'function' ||
      !(await Hazuki.ui.isAvailable())
    ) {
      throw Hazuki.error(
        'UI_UNAVAILABLE',
        '网页评论需要前台验证码弹窗',
      );
    }
    const origin = 'https://' + JM.webHost;
    const headers = {
      Referer: origin + '/album/' + comicId,
      Origin: origin,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    };
    const imageRes = await Hazuki.http.fetchBytes(
      'GET',
      origin + '/captcha?t=' + Date.now(),
      headers,
    );
    if (imageRes.status === 403) {
      await Hazuki.storage.set('webSession', false);
      throw new Error('JM 网页登录已被 Cloudflare 拦截，请重新网页登录');
    }
    if (imageRes.status !== 200 || !imageRes.body) {
      throw new Error('JM 网页验证码获取失败');
    }
    const image =
      imageRes.body instanceof Uint8Array
        ? imageRes.body
        : new Uint8Array(imageRes.body);
    const code = await jmRequestWebCaptcha(image);
    /** @type {Record<string, string>} */
    const fields = {
      video_id: comicId,
      comment: text,
      originator: '',
      invite_verification: code,
    };
    if (replyTo != null && String(replyTo).trim()) {
      fields.comment_id = String(replyTo).trim();
      fields.is_reply = '1';
      fields.forum_subject = '1';
    } else {
      fields.status = 'false';
    }
    const response = await Hazuki.http.sendRequest(
      'POST',
      origin + '/ajax/album_comment',
      {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      this.form(fields),
    );
    if (response.status === 403) {
      await Hazuki.storage.set('webSession', false);
      throw new Error('JM 网页登录已被 Cloudflare 拦截，请重新网页登录');
    }
    if (response.status !== 200) {
      throw new Error('JM 网页评论失败: HTTP ' + response.status);
    }
    /** @type {any} */
    let data = {};
    try {
      data = JSON.parse(response.body);
    } catch (error) {
      // Non-JSON success pages are not accepted as a confirmed comment.
    }
    if (data.comment_penalty) {
      throw new Error(String(data.comment_penalty_msg || data.comment_penalty));
    }
    if (
      data.status === 'fail' ||
      data.status === 'error' ||
      Number(data.code) >= 400
    ) {
      throw new Error(String(data.msg || 'JM 网页评论失败'));
    }
    const succeeded =
      data.status === 'ok' ||
      data.status === 'success' ||
      data.status === 1 ||
      data.status === '1' ||
      data.status === true ||
      data.success === true ||
      Number(data.code) === 200 ||
      Boolean(data.cid);
    if (!succeeded) {
      throw new Error(String(data.msg || 'JM 网页评论返回异常'));
    }
  }

  async checkIn() {
    if (this.checkInTask) return this.checkInTask;
    const task = (async () => {
      const uid = Hazuki.storage.get('uid');
      if (!uid) throw Hazuki.error('AUTH_EXPIRED', 'Missing uid');
      if (Hazuki.storage.get('lastCheckInDate') === this.today()) {
        return { status: /** @type {const} */ ('alreadyCheckedIn') };
      }
      const daily = await this.request('GET', '/daily?' + this.form({ user_id: uid }));
      if (daily.daily_id == null) throw new Error('invalid_daily_id');
      const result = await this.request('POST', '/daily_chk', {
        user_id: uid,
        daily_id: daily.daily_id,
      });
      const message = String(result.msg ?? '');
      const already = /今天已[经經]?[签簽]到|已[签簽]到|簽到過|签到过|已完成/.test(message);
      const success =
        /成功|Jcoin|EXP/i.test(message) || result.status === 'ok' || Number(result.code) === 0;
      if (!already && !success) throw new Error(message || 'invalid_check_in_result');
      await Hazuki.storage.set('lastCheckInDate', this.today());
      if (already) {
        return message ? { status: /** @type {const} */ ('alreadyCheckedIn'), message } : { status: /** @type {const} */ ('alreadyCheckedIn') };
      }
      return message ? { status: /** @type {const} */ ('success'), message } : { status: /** @type {const} */ ('success') };
    })();
    this.checkInTask = task;
    try {
      return await task;
    } finally {
      this.checkInTask = null;
    }
  }

  today() {
    const date = new Date();
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }

  /** @param {unknown} seconds */
  dateText(seconds) {
    const date = new Date(Number(seconds) * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }

  /** @param {string} path */
  image(path) {
    return jmNormalizeUrl(this.imageBase + path);
  }

  /** @param {unknown} id */
  cover(id) {
    return this.image('/media/albums/' + encodeURIComponent(String(id)) + '_3x4.jpg');
  }

  /** @param {unknown} photo @param {unknown} uid */
  avatar(photo, uid = '') {
    let name = String(photo || (uid ? String(uid) + '.jpg' : '')).trim();
    if (!name) return '';
    if (/^https?:\/\//i.test(name)) return jmNormalizeUrl(name);
    if (name.startsWith('//')) return jmNormalizeUrl('https:' + name);
    if (!name.startsWith('/media/')) name = '/media/users/' + name.replace(/^\/+/, '');
    return this.image(name);
  }

  /** @param {any} comic @returns {SourceComic} */
  parseComic(comic) {
    return {
      id: String(comic.id),
      title: String(comic.name ?? ''),
      cover: this.cover(comic.id),
      tags: [comic.category?.title, comic.category_sub?.title].filter(Boolean),
    };
  }

  /**
   * @param {any} items
   * @param {unknown} total
   * @param {number} pageSize
   * @returns {ComicPage}
   */
  parsePage(items, total, pageSize) {
    return {
      comics: asArray(items).map((item) => this.parseComic(item)),
      maxPage: Math.ceil(Number(total || 0) / pageSize),
    };
  }

  /** @param {string} value */
  matchId(value) {
    return new RegExp(JM.idPattern, 'i').exec(String(value).trim())?.[1] ?? null;
  }

  /**
   * @param {any} profile
   * @param {unknown} uid
   * @param {string} [fallback]
   * @returns {SourceProfile}
   */
  profile(profile, uid, fallback = '') {
    const name = profile.nickname || profile.username || fallback;
    const avatar = this.avatar(profile.photo || profile.avatar, uid);
    return {
      ...(name ? { displayName: String(name) } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
    };
  }
}

const runtime = new JmSession();

/** @param {unknown} value */
function jmCommentText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @param {any} row @param {string} fallback */
function jmCommentParent(row, fallback) {
  const raw = row?.parent_CID ?? row?.comment_id ?? row?.pid;
  const value = raw == null ? '' : String(raw).trim();
  return value && value !== '0' ? value : fallback;
}

/** @param {any} row @param {number} replyCount @param {string} [parentName] @returns {SourceComment} */
function jmCommentRow(row, replyCount, parentName = '') {
  const text = jmCommentText(row.content);
  return {
    id: String(row.CID ?? row.id ?? ''),
    userName: String(row.username ?? row.nickname ?? ''),
    avatar: runtime.avatar(row.photo),
    content: parentName ? '@' + parentName + ' ' + text : text,
    time: String(row.addtime ?? ''),
    replyCount: Number(replyCount) || 0,
  };
}

/** @param {Uint8Array} image @param {string} [title] @returns {Promise<string>} */
async function jmRequestWebCaptcha(image, title = '网页评论验证码') {
  if (
    typeof Hazuki.ui?.openDialog !== 'function' ||
    !(await Hazuki.ui.isAvailable())
  ) {
    throw Hazuki.error(
      'UI_UNAVAILABLE',
      '网页评论需要新版宿主的验证码弹窗',
    );
  }
  const dialog = await Hazuki.ui.openDialog({
    title,
    content: [
      {
        id: 'image',
        type: 'image',
        image,
        description: '请输入图片中的计算结果',
      },
      {
        id: 'code',
        type: 'input',
        label: '验证码',
        required: true,
        keyboardType: 'number',
      },
    ],
    buttons: [{ id: 'submit', text: '提交', role: 'primary', validate: true }],
  });
  try {
    for (;;) {
      const event = await dialog.nextEvent();
      if (event.type === 'closed') {
        throw new Hazuki.ui.PluginDialogCancelledError(event.reason);
      }
      if (event.type !== 'action') continue;
      const code = event.values.code;
      if (typeof code === 'string' && code.trim()) return code.trim();
    }
  } finally {
    await dialog.close();
  }
}

/** @type {{name: string; type: 'fixed'; itemType: 'category' | 'search'; categories: string[]; categoryParams?: string[]}[]} */
const JM_CATEGORY_PARTS = [
  {
    name: '每週必看',
    type: 'fixed',
    categories: ['每週必看'],
    itemType: 'category',
  },
  {
    name: '成人A漫',
    type: 'fixed',
    categories: [
      '最新A漫',
      '同人',
      '單本',
      '短篇',
      '其他類',
      '韓漫',
      '美漫',
      'Cosplay',
      '3D',
      '禁漫漢化組',
    ],
    itemType: 'category',
    categoryParams: [
      '0',
      'doujin',
      'single',
      'short',
      'another',
      'hanman',
      'meiman',
      'another_cosplay',
      '3D',
      '禁漫漢化組',
    ],
  },
  {
    name: '主題A漫',
    type: 'fixed',
    categories: [
      '無修正',
      '劇情向',
      '青年漫',
      '校服',
      '純愛',
      '人妻',
      '教師',
      '百合',
      'Yaoi',
      '性轉',
      'NTR',
      '女裝',
      '癡女',
      '全彩',
      '女性向',
      '完結',
      '禁漫漢化組',
    ],
    itemType: 'search',
  },
  {
    name: '角色扮演',
    type: 'fixed',
    categories: [
      '御姐',
      '熟女',
      '巨乳',
      '貧乳',
      '女性支配',
      '教師',
      '女僕',
      '護士',
      '泳裝',
      '眼鏡',
      '連褲襪',
      '其他制服',
      '兔女郎',
    ],
    itemType: 'search',
  },
  {
    name: '特殊PLAY',
    type: 'fixed',
    categories: [
      '群交',
      '足交',
      '束縛',
      '肛交',
      '阿黑顏',
      '藥物',
      '扶他',
      '調教',
      '野外露出',
      '催眠',
      '自慰',
      '觸手',
      '獸交',
      '亞人',
      '怪物女孩',
      '皮物',
      'ryona',
      '騎大車',
    ],
    itemType: 'search',
  },
  {
    name: '其他',
    type: 'fixed',
    categories: ['CG', '重口', '獵奇', '非H', '血腥暴力', '站長推薦'],
    itemType: 'search',
  },
];

/** @type {Record<string, string | Record<string, string>>} */
const JM_SEARCH_ORDERS = {
  mr: { zh: '最新', en: 'Latest' },
  mv: { zh: '总排行', en: 'Top overall' },
  mv_m: { zh: '月排行', en: 'Top monthly' },
  mv_w: { zh: '周排行', en: 'Top weekly' },
  mv_t: { zh: '日排行', en: 'Top daily' },
  mp: { zh: '最多图片', en: 'Most images' },
  tf: { zh: '最多喜欢', en: 'Most likes' },
};

/** @type {SourcePresentation} */
const JM_PRESENTATION = {
  showComments: true,
  commentReplies: true,
  buttons: [
    { id: 'checkIn', location: 'homeProfile' },
    { id: 'autoCheckIn', location: 'other' },
    { id: 'copyComicId', location: 'comicDetailInfo' },
    { id: 'relatedComics', location: 'comicDetailTabs' },
  ],
  directComicIdRules: { patterns: [JM.idPattern], extractDigits: true },
  dailyRecommendation: { searchOrder: 'mr' },
  showComicId: true,
  refreshCloudFavorites: true,
  listTagGroups: ['Tag'],
  favoriteOrderAliases: { '-datetime_updated': 'mp' },
  localFavoriteOrders: { mr: 'savedNewest', mp: 'updatedNewest' },
  dailyCheckIn: true,
  searchDefaultOrder: 'mr',
  searchOrders: JM_SEARCH_ORDERS,
  favoriteOrders: ['mr', 'mr_reverse', 'mp', 'mp_reverse'],
  favoriteDefaultOrder: 'mr',
  favoriteOrderSetting: 'favoriteOrder',
  favoriteOrderLabels: {
    mr: { zh: '收藏时间', en: 'Date added' },
    mr_reverse: { zh: '收藏时间（倒序）', en: 'Date added (reverse)' },
    mp: { zh: '更新时间', en: 'Last updated' },
    mp_reverse: { zh: '更新时间（倒序）', en: 'Last updated (reverse)' },
  },
  favoriteMenu: [
    {
      id: 'added',
      title: { zh: '收藏时间', en: 'Date added' },
      children: [
        { order: 'mr', title: { zh: '正序', en: 'Forward' } },
        { order: 'mr_reverse', title: { zh: '倒序', en: 'Reverse' } },
      ],
    },
    {
      id: 'updated',
      title: { zh: '更新时间', en: 'Last updated' },
      children: [
        { order: 'mp', title: { zh: '正序', en: 'Forward' } },
        { order: 'mp_reverse', title: { zh: '倒序', en: 'Reverse' } },
      ],
    },
  ],
  actions: [
    { id: 'refreshLines', title: '刷新线路', location: 'lines' },
    { id: 'webCommentStatus', title: '网页评论状态', location: 'other' },
  ],
};

/** @type {Record<string, SourceSetting>} */
const JM_SETTINGS = {
  refreshDomainsOnStart: {
    location: 'lines',
    title: 'Refresh Domain List on Startup',
    type: 'switch',
    default: true,
  },
  apiDomain: {
    location: 'lines',
    onChanged: async () => {
      await runtime.refreshImageHost();
    },
    title: 'Api Domain',
    type: 'select',
    options: [
      { value: '1', label: { zh: '线路 1', en: 'Line 1' } },
      { value: '2', label: { zh: '线路 2', en: 'Line 2' } },
      { value: '3', label: { zh: '线路 3', en: 'Line 3' } },
      { value: '4', label: { zh: '线路 4', en: 'Line 4' } },
    ],
    default: '1',
  },
  imageStream: {
    location: 'lines',
    onChanged: async () => {
      await runtime.refreshImageHost();
    },
    title: 'Image Stream',
    type: 'select',
    options: [
      { value: '1', label: { zh: '图源 1', en: 'Stream 1' } },
      { value: '2', label: { zh: '图源 2', en: 'Stream 2' } },
      { value: '3', label: { zh: '图源 3', en: 'Stream 3' } },
      { value: '4', label: { zh: '图源 4', en: 'Stream 4' } },
    ],
    default: '1',
  },
  favoriteOrder: {
    title: 'Favorite Order',
    type: 'select',
    options: [
      { value: 'mr', text: 'Add Time' },
      {
        value: 'mr_reverse',
        label: { zh: '收藏时间（倒序）', en: 'Date added (reverse)' },
      },
      { value: 'mp', text: 'Update Time' },
      {
        value: 'mp_reverse',
        label: { zh: '更新时间（倒序）', en: 'Last updated (reverse)' },
      },
    ],
    default: 'mr',
  },
  dailyCheckInTask: {
    title: 'Daily Check-in Task',
    type: 'switch',
    default: false,
  },
};

/** @satisfies {HazukiSourceDefinition} */
const source = {
  id: 'jm',
  name: 'JMComic',
  version: '2.8.0',
  apiVersion: 1,

  async init() {
    await runtime.bootstrap();
  },

  account: {
    login: async (account, password) => {
      // A new app account must not reuse a previous account's website session.
      await Hazuki.cookies.delete('https://' + JM.webHost + '/');
      await Hazuki.storage.delete('webSession');
      return runtime.login(account, password);
    },
    loadProfile: async () => {
      const uid = Hazuki.storage.get('uid');
      if (!uid) throw Hazuki.error('AUTH_EXPIRED', 'Missing uid');
      const profile = Hazuki.storage.get('profile') || {};
      const account = Hazuki.storage.get('account');
      return runtime.profile(
        profile,
        uid,
        Array.isArray(account) ? String(account[0] ?? '') : '',
      );
    },
    logout: async () => {
      runtime.favoritePagination.clear();
      runtime.favoritePaginationOrder = '';
      const hosts = new Set([...JM.apiSeeds, ...runtime.hosts, JM.webHost]);
      for (const host of hosts) {
        await Hazuki.cookies.delete('https://' + host + '/');
      }
      for (const key of [
        'uid',
        'profile',
        'lastCheckInDate',
        'avatar_url',
        'display_name',
        'webSession',
      ]) {
        await Hazuki.storage.delete(key);
      }
    },
    checkInStatus: async () => Hazuki.storage.get('lastCheckInDate') === runtime.today(),
    checkIn: () => runtime.checkIn(),
  },

  explore: [
    {
      title: '禁漫天堂',
      type: 'multiPartPage',
      load: async () => {
        const data = await runtime.get('/promote?page=0');
        return asArray(data)
          .filter((section) => !['library', 'novels'].includes(section.type))
          .map((section) => ({
            title: section.title,
            comics: asArray(section.content).map((comic) => runtime.parseComic(comic)),
            viewMore:
              'category:' +
              section.title +
              '@' +
              (section.type === 'category_id' ? section.slug : section.id),
            offersInitialComicsFilter: ['最新上市', '更新', '最新更新'].includes(section.title),
          }));
      },
    },
  ],

  category: {
    title: '禁漫天堂',
    parts: JM_CATEGORY_PARTS,
  },

  categoryComics: {
    load: async (category, param, options, page) => {
      if (category === '每週必看') {
        const data = await runtime.get(
          '/week/filter?' +
            runtime.form({ id: options[0], type: options[1], page: 0 }),
        );
        return {
          comics: asArray(data.list).map((comic) => runtime.parseComic(comic)),
          maxPage: 1,
        };
      }
      const data = await runtime.get(
        '/categories/filter?' +
          runtime.form({ o: options[0] || 'mr', c: param ?? category, page }),
      );
      return runtime.parsePage(data.content, data.total, 80);
    },
    optionLoader: async (category) => {
      if (category !== '每週必看') {
        return [
          {
            label: '排序',
            options: [
              'mr-最新',
              'mv-總排行',
              'mv_m-月排行',
              'mv_w-周排行',
              'mv_t-日排行',
              'mp-最多圖片',
              'tf-最多喜歡',
            ],
          },
        ];
      }
      const data = await runtime.get('/week');
      return [
        {
          label: '時間',
          options: asArray(data.categories).map((item) => item.id + '-' + item.time),
        },
        { label: '類型', options: ['manga-日漫', 'hanman-韓漫', 'another-其他'] },
      ];
    },
    ranking: {
      options: ['mv-總排行', 'mv_m-月排行', 'mv_w-周排行', 'mv_t-日排行'],
      load: (option, page) =>
        runtime
          .get('/categories/filter?' + runtime.form({ o: option, c: '0', page }))
          .then((data) => runtime.parsePage(data.content, data.total, 80)),
    },
  },

  search: {
    load: async (keyword, options, page) => {
      const id = runtime.matchId(keyword);
      if (id) {
        try {
          const album = await runtime.get('/album?' + runtime.form({ id }));
          if (!album || typeof album.name !== 'string' || !album.name.trim()) {
            throw new Error('invalid_jm_album');
          }
          return {
            comics: page === 1 ? [runtime.parseComic({ ...album, id })] : [],
            maxPage: 1,
          };
        } catch (error) {
          Hazuki.log(String(error), 'warn');
        }
      }
      const query = runtime
        .form({ search_query: keyword.trim(), o: options[0] || 'mr' })
        .replace(/%20/g, '+');
      const data = await runtime.get(
        '/search?' + query + (page > 1 ? '&page=' + page : ''),
      );
      return runtime.parsePage(data.content, data.total, 80);
    },
  },

  favorites: {
    singleFolderForSingleComic: true,
    loadComics: async (page, folderId) => runtime.favoritePage(folderId, page),
    loadFolders: async (comicId) => {
      const data = await runtime.get('/favorite');
      /** @type {Record<string, string>} */
      const folders = { 0: '全部' };
      /** @type {string[]} */
      const realFolders = [];
      for (const folder of asArray(data.folder_list)) {
        const id = String(folder.FID);
        folders[id] = String(folder.name);
        if (id !== '0') realFolders.push(id);
      }
      if (!comicId) return { folders, favorited: [] };
      const id = runtime.matchId(comicId) ?? String(comicId).trim();
      const album = await runtime.get('/album?' + runtime.form({ id }));
      if (!album?.is_favorite) return { folders, favorited: [] };
      /** @type {string[]} */
      const favorited = [];
      for (const folderId of realFolders) {
        if (await runtime.folderContains(folderId, id)) {
          favorited.push(folderId);
          break;
        }
      }
      if (!favorited.length) favorited.push('0');
      return { folders, favorited };
    },
    addFolder: async (name) => {
      await runtime.post('/favorite_folder', { type: 'add', folder_name: name });
    },
    renameFolder: async (id, name) => {
      const result = await runtime.post('/favorite_folder', {
        type: 'edit',
        folder_id: id,
        folder_name: name,
      });
      if (
        result.status === 'fail' ||
        result.status === 'error' ||
        (typeof result.code === 'number' && result.code >= 400)
      ) {
        throw new Error(result.msg || 'Failed to rename folder');
      }
    },
    deleteFolder: async (id) => runtime.deleteFolder(id),
    addOrDelFavorite: async (comicId, folderId, adding) => {
      const id = runtime.matchId(comicId) ?? String(comicId).trim();
      const album = await runtime.get('/album?' + runtime.form({ id }));
      const favorite = Boolean(album?.is_favorite);
      const target = String(folderId ?? '0').trim() || '0';
      if (adding) {
        if (target === '0') {
          if (favorite) {
            // A move to "0" is ignored by the API. Toggle off/on to return the
            // comic to the default (unfiled) view while keeping it favorite.
            await runtime.post('/favorite', { aid: id });
            try {
              await runtime.post('/favorite', { aid: id });
            } catch (error) {
              try {
                await runtime.post('/favorite', { aid: id });
              } catch (ignored) {}
              throw error;
            }
          } else {
            await runtime.post('/favorite', { aid: id });
          }
          return;
        }
        if (!favorite) await runtime.post('/favorite', { aid: id });
        await runtime.post('/favorite_folder', {
          type: 'move',
          folder_id: target,
          aid: id,
        });
      } else if (favorite) {
        await runtime.post('/favorite', { aid: id });
      }
    },
  },

  comic: {
    loadInfo: async (comicId) => {
      const id = runtime.matchId(comicId) ?? comicId.trim().replace(/^jm/i, '');
      const album = await runtime.get('/album?' + runtime.form({ id }));
      /** @type {Record<string, string>} */
      const chapters = {};
      const series = asArray(album.series)
        .slice()
        .sort((left, right) => Number(left.sort) - Number(right.sort));
      for (const chapter of series) {
        const title = String(chapter.name ?? '').trim() || '第' + chapter.sort + '話';
        chapters[String(chapter.id)] = title;
      }
      if (!Object.keys(chapters).length) chapters[id] = '第1話';
      const likes = Number(album.likes || 0);
      const views = album.total_views == null ? '' : album.total_views;
      return {
        id,
        title: String(album.name ?? ''),
        cover: runtime.cover(id),
        description: String(album.description ?? ''),
        likesCount: likes,
        chapters,
        tags: {
          Author: asArray(album.author),
          Tag: asArray(album.tags),
          Work: asArray(album.works),
          Actor: asArray(album.actors),
          View: views === '' ? [] : [String(views)],
        },
        infoFields: [
          { label: { zh: '作者', en: 'Author' }, values: asArray(album.author), action: 'search' },
          { label: { zh: '标签', en: 'Tags' }, values: asArray(album.tags), action: 'search' },
          { label: { zh: '作品', en: 'Work' }, values: asArray(album.works), action: 'search' },
          { label: { zh: '角色', en: 'Characters' }, values: asArray(album.actors), action: 'search' },
        ],
        viewsCount: views,
        headerStats: [
          {
            text: { zh: likes + '点赞', en: likes + ' likes' },
            action: 'like',
          },
          {
            text: views === '' ? '' : { zh: views + '浏览量', en: views + ' views' },
          },
        ],
        recommend: asArray(album.related_list).map((comic) => runtime.parseComic(comic)),
        isFavorite: Boolean(album.is_favorite),
        isLiked: Boolean(album.liked),
        updateTime: runtime.dateText(album.addtime),
      };
    },
    loadEp: async (comicId, chapterId) => {
      const data = await runtime.get('/chapter?' + runtime.form({ id: chapterId }));
      return {
        images: asArray(data.images).map((name) =>
          runtime.image('/media/photos/' + encodeURIComponent(chapterId) + '/' + name),
        ),
      };
    },
    onImageLoad: (url, comicId, chapterId) => {
      const id = Number(chapterId);
      const file = (url.split('?')[0].split('/').pop() || '').replace(/\.[^.]+$/, '');
      let segments = 0;
      if (!/\.gif(?:\?|$)/i.test(url)) {
        if (id >= 220980 && id < 268850) {
          segments = 10;
        } else if (id >= 268850) {
          const hash = Hazuki.convert.hexEncode(
            Hazuki.convert.md5(Hazuki.convert.encodeUtf8(String(id) + file)),
          );
          segments = (hash.charCodeAt(hash.length - 1) % (id > 421926 ? 8 : 10)) * 2 + 2;
        }
      }
      return {
        url: jmNormalizeUrl(url),
        headers: runtime.imageHeaders(),
        ...Hazuki.images.reverseVerticalTiles(segments),
      };
    },
    likeComic: async (id, isLike) => {
      if (isLike === false) {
        throw new Error(
          Hazuki.translate({
            zh: '该源不支持取消点赞',
            en: 'This source does not support unliking',
          }),
        );
      }
      const result = await runtime.post('/like', { id });
      const message = String(result.msg || result.errorMsg || '');
      if (/已經評價|已经评价|already/i.test(message)) return;
      if (result.code !== 200 || result.status === 'error') {
        throw new Error(message || 'Failed to like comic');
      }
    },
    loadComments: async (id, subId, page, replyTo) => {
      const comicId = String(id);
      if (replyTo != null && String(replyTo).trim()) {
        const target = String(replyTo).trim();
        const entry = await runtime.commentThread(comicId, target);
        if (!entry) return { comments: [], maxPage: 1 };
        const rows = entry.replys;
        const byId = new Map(rows.map((row) => [String(row.CID), row]));
        /** @param {any} row */
        const parentOf = (row) => jmCommentParent(row, entry.rootId);
        const selected =
          target === entry.rootId
            ? rows
            : rows.filter((row) => {
                let parent = parentOf(row);
                let guard = 0;
                while (parent && guard < 100) {
                  if (parent === target) return true;
                  if (parent === entry.rootId) return false;
                  const next = byId.get(parent);
                  if (!next) return false;
                  parent = parentOf(next);
                  guard += 1;
                }
                return false;
              });
        const childCount = new Map();
        for (const row of rows) {
          const parent = parentOf(row);
          childCount.set(parent, (childCount.get(parent) || 0) + 1);
        }
        return {
          comments: selected.map((row) => {
            const parent = byId.get(parentOf(row));
            const parentName =
              parent && parentOf(row) !== entry.rootId
                ? String(parent.nickname || parent.username || '')
                : '';
            return jmCommentRow(row, childCount.get(String(row.CID)) || 0, parentName);
          }),
          maxPage: 1,
        };
      }
      const data = await runtime.commentRoots(comicId, page);
      return {
        comments: data.roots.map((root) =>
          jmCommentRow(root, asArray(root.replys).length, ''),
        ),
        maxPage: data.maxPage,
      };
    },
    sendComment: async (id, subId, text, replyTo) => {
      if (await runtime.ensureWebSession()) {
        await runtime.webComment(String(id), String(text), replyTo);
        for (const key of [...JM_COMMENT_CACHE.keys()]) {
          if (key.startsWith(String(id) + ':')) JM_COMMENT_CACHE.delete(key);
        }
        return;
      }
      /** @type {Record<string, unknown>} */
      const payload = { aid: id, comment: text };
      if (replyTo != null && String(replyTo).trim()) {
        payload.comment_id = String(replyTo).trim();
      }
      const result = await runtime.post('/comment', payload);
      if (result?.type === 'auth_fail') {
        throw Hazuki.error('AUTH_EXPIRED', 'JM comment login required');
      }
      if (
        result?.status === 'fail' ||
        result?.status === 'error' ||
        (typeof result?.code === 'number' && result.code >= 400)
      ) {
        throw new Error(result.msg || 'Failed to send comment');
      }
      for (const key of [...JM_COMMENT_CACHE.keys()]) {
        if (key.startsWith(String(id) + ':')) JM_COMMENT_CACHE.delete(key);
      }
    },
  },

  settings: JM_SETTINGS,
  presentation: JM_PRESENTATION,

  translation: {
    en: {
      刷新线路: 'Refresh lines',
      线路已刷新: 'Lines refreshed',
    },
    zh_CN: {
      'Refresh Domain List': '刷新域名列表',
      Refresh: '刷新',
      'Refresh Domain List on Startup': '启动时刷新域名列表',
      'Api Domain': 'Api域名',
      'Image Stream': '图片分流',
      'Favorite Order': '收藏夹排序',
      'Daily Check-in Task': '每日自动签到',
      'Manual Check-In': '手动签到',
      'Check-In': '签到',
      'Add Time': '添加时间',
      'Update Time': '更新时间',
      All: '全部',
      Author: '作者',
      Tag: '标签',
      Work: '作品',
      Actor: '角色',
      View: '浏览量',
    },
  },

  actions: {
    refreshLines: async () => {
      await runtime.refreshHosts();
      await runtime.refreshImageHost();
      return '线路已刷新';
    },
    webCommentStatus: async () => {
      if (Hazuki.storage.get('webSession') !== true) {
        return '未启用网页登录：评论走 App API';
      }
      try {
        const response = await Hazuki.http.get('https://' + JM.webHost + '/');
        if (
          response.status === 403 ||
          /Just a moment/i.test(response.body)
        ) {
          return '网页登录已失效：请重新网页登录';
        }
        return '网页登录有效：评论走网页接口';
      } catch (error) {
        return '网页登录检查失败：' + String(error);
      }
    },
  },
  lines: {
    snapshot: () => ({
      hosts: runtime.hosts.slice(),
      imageBase: runtime.imageBase,
      appVersion: runtime.appVersion,
    }),
  },
};

Hazuki.registerSource(source);
