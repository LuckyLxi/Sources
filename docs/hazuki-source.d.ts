/** Hazuki Source API v1. Ship one UTF-8 JS file. */
type Awaitable<T> = T | Promise<T>;
/** Current language, then English, then the first nonempty provided value. */
type SourceText = string | Record<string, string>;
interface SourceComic {
  /** subTitle is for non-author information only; authors belong in infoFields. */
  id: string; title: string; cover: string; subTitle?: string; tags?: string[];
}
/** A website recommendation/banner. All items open their source's comic detail.
 * imageUrl is optional promotional art, separate from the original comic cover.
 */
interface SourceDailyRecommendationItem extends Omit<SourceComic, 'cover'> {
  cover?: string;
  imageUrl?: string;
  /** Optional promotional title; falls back to the comic title when blank. */
  bannerTitle?: string;
  /** Optional short overlay text: author, recommendation reason, section name, etc. */
  caption?: string;
}
interface ComicPage { comics: SourceComic[]; maxPage?: number | null; }
/** Rows render in declaration order; empty values hide the row. */
interface SourceComicInfoField {
  label: SourceText;
  /** A single value or explicit values. Punctuation is preserved. */
  values: string | string[];
  /** Default: none. All values support the existing long-press copy gesture. */
  action?: 'none' | 'search' | 'copy';
}
/** Compact header item above the read button. Short text only: never descriptions,
 * author lists, announcements or other large text. Put long content in infoFields
 * or description. The host renders one line with ellipsis when needed.
 */
interface SourceComicHeaderStat {
  text: SourceText;
  /** Built-in icon name (comicHeaderVersion >= 2); unknown names render no icon. */
  icon?: SourceDialogIcon;
  /**
   * comicHeaderVersion >= 2: actions render as borderless buttons.
   * 'plugin' calls comic.onHeaderAction(comicId, id); 'link' opens url in the system browser;
   * 'search' / 'copy' use value, falling back to the displayed text.
   * 'like' is the retired host like button: older hosts only; newer hosts show it as plain text.
   */
  action?: 'none' | 'plugin' | 'link' | 'search' | 'copy' | 'like';
  /** Required for 'plugin', 1–64 characters. */
  id?: string;
  /** Required for 'link', http(s) only. */
  url?: string;
  value?: string;
}
/** Short badge under the title (comicHeaderVersion >= 2); at most 3 are shown. */
interface SourceComicHeaderBadge {
  text: SourceText;
  /** 'warning' uses the theme's tertiary color. */
  tone?: 'normal' | 'primary' | 'warning' | 'error';
}
/** Returned by comic.onHeaderAction; omitted fields keep the current content. */
interface SourceComicHeaderActionResult {
  headerStats?: SourceComicHeaderStat[];
  headerBadges?: SourceComicHeaderBadge[];
  /** Silently reloads the details; the current content stays until it succeeds. */
  reload?: boolean;
}
interface SourceComicDetails {
  /** The detail header does not display subTitle; never put authors here. */
  id?: string; title: string; cover?: string; subTitle?: string;
  description?: string; updateTime?: string; likesCount?: number | string; viewsCount?: number | string;
  chapters?: Record<string, string> | Map<string, string>;
  /** Ordered arrays take precedence over chapters. IDs must be unique per comic. */
  chapterGroups?: SourceChapterGroup[];
  /** Arbitrary detail rows; the host does not infer rows from tags or uploader. */
  infoFields?: SourceComicInfoField[];
  /** Declaration order is preserved. Omitted/empty hides the statistics content.
   * Do not put large amounts of text here; use infoFields or description.
   */
  headerStats?: SourceComicHeaderStat[];
  /** Replaces the legacy showComicStatus badge when non-empty. */
  headerBadges?: SourceComicHeaderBadge[];
  /** Structured data for listTagGroups and existing header status, not detail rows. */
  tags?: Record<string, string[]>; recommend?: SourceComic[];
  /** isLiked is read only by older hosts (comicHeaderVersion < 2). */
  isFavorite?: boolean; isLiked?: boolean; uploader?: string; pageCount?: number | string; subId?: string;
}
interface SourceChapterGroup {
  id: string; title: string; chapters: {id: string; title: string}[];
}
interface SourceReadingProgress {
  comicId: string; chapterId: string;
  /** One-based original image page, including in double-page mode. */
  page: number; totalPages: number;
  visiblePages: number[];
  reason: 'initial' | 'page' | 'chapter' | 'exit' | 'background';
}
interface SourceCloudReadingProgress {
  chapterId: string;
  /** One-based original image page. */
  page: number;
  totalPages?: number;
  updatedAtMs?: number;
}
interface SourceCookie {
  name: string; value: string; domain?: string; path?: string;
  /** Unix epoch milliseconds. Omit for session cookies. */
  expiresAt?: number | null;
  secure?: boolean; httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none' | null;
  /** Omitted: true for host names, false for dot-prefixed domains. */
  hostOnly?: boolean;
}
interface SourceLoginMethod {
  id: string; title: SourceText;
  input: 'credentials' | 'account' | 'none';
}
type SourceLoginImage = Uint8Array | number[] | string;
interface SourceLoginContext {
  readonly method: string;
  /** Foreground isolated login only. Exact HTTPS callbacks; cancellation aborts login.
   * Default timeout 300000 ms; allowed 30000..600000. Cookie import is opt-in.
   * The plugin must validate the returned credential and provider state.
   */
  requestBrowserAuthorization(options: {
    title?: SourceText; url: string;
    callbacks?: {origin: string; path: string; requiredQueryKeys?: string[]}[];
    /** Default callback. Manual completion may omit callbacks. */
    completion?: 'callback' | 'manual';
    /** Required exact names, including HttpOnly, imported only from this browser.
     * Also binds the actual WebView UA to each exact HTTPS origin (including port).
     * Overrides explicit HTTP UA; Cookie and UA commit/rollback together.
     * Existing cookie sessions need reauthorization to establish the UA binding.
     */
    cookieScopes?: {url: string; names: string[]}[];
    timeoutMs?: number;
  }): Promise<{status: 'completed'; url: string} | {status: 'timeout'}>;
  /** Foreground only. createUrl runs inside the plugin; functions never cross
   * the JS bridge. Validate the website credential and provider state yourself.
   * Cancellation aborts the entire login attempt. No provider-specific SDK.
   */
  requestExternalAuthorization(options: {
    title?: SourceText;
    createUrl: (callbackUrl: string) => Awaitable<string>;
    allowedSchemes: string[];
    androidPackage?: string;
    timeoutMs?: number;
  }): Promise<{status: 'completed'; url: string} | {status: 'timeout'}>;
  /** Empty input cannot be submitted. Cancellation rejects the entire login. */
  requestText(options: {title: SourceText; message?: SourceText; initialValue?: string;
    obscure?: boolean; keyboardType?: 'text' | 'number'}): Promise<string>;
  /** Image data must be bytes or a base64 image Data URL. No URL fetching by UI. */
  requestClickCaptcha(options: {title: SourceText; message?: SourceText;
    image: SourceLoginImage; hintImage?: SourceLoginImage; pointCount?: number}):
      Promise<{status: 'refresh'} | {status: 'submitted'; points: {x: number; y: number}[]}>;
}
interface SourceProfile { token?: string; displayName?: string; avatarUrl?: string; }
/** Same isolated browser options as login authorization. openWebView defaults to
 * manual completion when callbacks are omitted, and callback completion otherwise.
 */
type SourceWebViewOptions = Parameters<SourceLoginContext['requestBrowserAuthorization']>[0];
type SourceWebViewResult = Awaited<ReturnType<SourceLoginContext['requestBrowserAuthorization']>>
  | {status: 'closed'; reason: 'plugin'};
/** Await this request for its outcome, or call close() before it completes.
 * close() also cancels queued requests and waits for exit/resource cleanup.
 */
interface SourceWebViewRequest extends Promise<SourceWebViewResult> {
  close(): Promise<void>;
}
interface SourceSetting {
  title: SourceText; type: 'input' | 'select' | 'switch' | 'bool';
  default: string | number | boolean;
  options?: (string | {value: string; label?: SourceText; text?: SourceText})[];
  onChanged?: (value: unknown) => Awaitable<void>;
  /** Default: plugin. Lines controls belong to the active plugin. */
  location?: 'plugin' | 'lines';
}
interface SourceComment {
  id: string; userName: string; avatar?: string; content: string;
  time?: string; score?: number; isLiked?: boolean; replyCount?: number; voteStatus?: number;
  /** Website citation floors, oldest first. Each retains its own like/reply ID.
   * Only one level is rendered; quoted items' quotedComments are ignored.
   */
  quotedComments?: Omit<SourceComment, 'quotedComments'>[];
  /** Default true. False disables the like action after a successful like. */
  canUnlike?: boolean;
}
interface SourceOptionGroup {
  /** Encode each option as "value-label" or just "value". */
  options: string[]; label?: string; showWhen?: string[]; notShowWhen?: string[];
}
interface SourceExploreSection {
  title: string; comics: SourceComic[]; viewMore?: string;
  offersInitialComicsFilter?: boolean;
}
type SourceExplore =
  | {title: string; type: 'multiPartPage'; load(page: number | null): Awaitable<SourceExploreSection[]>}
  | {title: string; type: 'singlePageWithMultiPart'; load(): Awaitable<Record<string, SourceComic[]>>}
  | {title: string; type: 'multiPageComicList'; load(page: number): Awaitable<ComicPage>};
interface SourceHttpResponse<T> {
  status: number; body: T; headers: Record<string, string | string[]>;
  /** Final URL after followed redirects; the request URL when none were followed. */
  url: string;
}
/** Unknown keys or out-of-range values throw plugin_invalid_http_extra. */
interface SourceHttpExtra {
  /** Send and receive timeout, integer 1000..120000. Connect timeout stays host-defined. */
  timeoutMs?: number;
  /** false returns 3xx responses directly; read the location header yourself. */
  followRedirects?: boolean;
  /** Integer 0..20. */
  maxRedirects?: number;
}
type SourceBytes = ArrayBuffer | Uint8Array | number[];
/** AES never pads: ECB/CBC input must be 16-byte aligned, CFB/OFB input a multiple
 * of blockSize (1..16 bytes, default 16). Keys are 16/24/32 bytes, IVs 16 bytes.
 */
interface SourceConvert {
  encodeUtf8(text: string): ArrayBuffer; decodeUtf8(bytes: SourceBytes): string;
  encodeGbk(text: string): ArrayBuffer; decodeGbk(bytes: SourceBytes): string;
  encodeBase64(bytes: SourceBytes): string; decodeBase64(text: string): ArrayBuffer;
  md5(bytes: SourceBytes): ArrayBuffer; sha1(bytes: SourceBytes): ArrayBuffer;
  sha256(bytes: SourceBytes): ArrayBuffer; sha512(bytes: SourceBytes): ArrayBuffer;
  hmac(key: SourceBytes, value: SourceBytes, hash: 'md5' | 'sha1' | 'sha256' | 'sha512'): ArrayBuffer;
  hmacString(key: SourceBytes, value: SourceBytes, hash: 'md5' | 'sha1' | 'sha256' | 'sha512'): string;
  encryptAesEcb(value: SourceBytes, key: SourceBytes): ArrayBuffer;
  decryptAesEcb(value: SourceBytes, key: SourceBytes): ArrayBuffer;
  encryptAesCbc(value: SourceBytes, key: SourceBytes, iv: SourceBytes): ArrayBuffer;
  decryptAesCbc(value: SourceBytes, key: SourceBytes, iv: SourceBytes): ArrayBuffer;
  encryptAesCfb(value: SourceBytes, key: SourceBytes, iv: SourceBytes, blockSize?: number): ArrayBuffer;
  decryptAesCfb(value: SourceBytes, key: SourceBytes, iv: SourceBytes, blockSize?: number): ArrayBuffer;
  encryptAesOfb(value: SourceBytes, key: SourceBytes, iv: SourceBytes, blockSize?: number): ArrayBuffer;
  decryptAesOfb(value: SourceBytes, key: SourceBytes, iv: SourceBytes, blockSize?: number): ArrayBuffer;
  /** key: PEM (PKCS#1 / PKCS#8) string or DER bytes. */
  decryptRsa(value: SourceBytes, key: string | SourceBytes, padding?: 'pkcs1' | 'oaep'): ArrayBuffer;
  hexEncode(bytes: SourceBytes): string;
  /** Even-length hex string, case-insensitive; otherwise throws plugin_invalid_hex. */
  hexDecode(hex: string): ArrayBuffer;
  /** Cryptographically secure bytes; length is an integer 1..1024. */
  randomBytes(length: number): ArrayBuffer;
  /** Lowercase RFC 4122 version 4 UUID from secure random bytes. */
  randomUUID(): string;
}
/** Parsed static HTML from Hazuki.html.parse(). Call dispose() after extracting data. */
interface HtmlDocument {
  querySelector(query: string): HtmlElement | null;
  querySelectorAll(query: string): HtmlElement[];
  getElementById(id: string): HtmlElement | null;
  dispose(): void;
}
interface HtmlElement {
  readonly text: string;
  readonly attributes: Record<string, string>;
  readonly children: HtmlElement[];
  readonly nodes: HtmlNode[];
  readonly innerHTML: string;
  readonly parent: HtmlElement | null;
  readonly classNames: string[];
  readonly id: string | null;
  readonly localName: string;
  readonly previousElementSibling: HtmlElement | null;
  readonly nextElementSibling: HtmlElement | null;
  querySelector(query: string): HtmlElement | null;
  querySelectorAll(query: string): HtmlElement[];
}
interface HtmlNode {
  readonly text: string;
  readonly type: 'text' | 'element' | 'comment' | 'document' | 'unknown';
  toElement(): HtmlElement | null;
}
interface ImageLoadConfig {
  url?: string; headers?: Record<string, string>;
  /** Number of equal-height vertical strips to reverse; zero means unchanged. */
  segments?: number;
}
/** Copies the source rectangle (sx, sy, sw, sh) unscaled to (dx, dy) on the output canvas. */
interface ImageRegion { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number }
/** Output canvas defaults to the source size; uncovered pixels are transparent. */
interface ImageRegionLayout { width?: number; height?: number; regions: ImageRegion[] }
type SourceActionLocation = 'plugin' | 'reading' | 'other' | 'lab' | 'advanced' | 'lines';
/** Fixed UI slots. Buttons reuse the app's existing layout and callbacks.
 * checkIn and resetDeviceInfo check presentation.menus['plugin.buttons.<id>'];
 * {value: 'default'} runs the existing host callback. copyComicId always copies
 * directly. autoCheckIn and relatedComics remain a switch
 * and a tab; imageQuality uses the existing reader.imageQuality selection menu.
 */
type SourceButton = (
  | {id: 'checkIn'; location: 'homeProfile'}
  | {id: 'autoCheckIn'; location: 'other'}
  | {id: 'copyComicId'; location: 'comicDetailInfo'}
  | {id: 'relatedComics'; location: 'comicDetailTabs'}
  | {id: 'imageQuality'; location: 'reading' | 'reader'}
  | {id: 'resetDeviceInfo'; location: 'advanced'; action: string}
) & {title?: SourceText; subtitle?: SourceText; successMessage?: SourceText};
/** id: 1-64 chars of [A-Za-z0-9_.-], unique per plugin. */
interface SourceDetailTab { id: string; title: SourceText }
/** Rendered top to bottom. Unknown types are skipped; malformed known types fail the tab.
 * text is plain text. images render 3 per row, cropped to 3:4, up to 300 per block.
 */
type SourceDetailTabBlock =
  | {type: 'text'; title?: string; text: string}
  | {type: 'images'; title?: string; urls: string[]};
/** Shared menu declarations. Each item selects a host value, runs an action,
 * or opens a submenu. Up to four levels and 100 items per menu.
 */
type SourceMenuEntry =
  | {value: string; title?: SourceText; order?: never; action?: never; id?: never; children?: never}
  | {order: string; title?: SourceText; value?: never; action?: never; id?: never; children?: never}
  | {action: string; title: SourceText; value?: never; order?: never; id?: never; children?: never}
  | {id: string; title: SourceText; children: SourceMenuEntry[]; value?: never; order?: never; action?: never};
/** Compatibility alias; use SourceMenuEntry and presentation.menus for new menus. */
type SourceFavoriteMenuEntry = SourceMenuEntry;
interface SourcePresentation {
  /** Arbitrary host menu IDs, matched by SourcePluginMenuBinding.menuId.
   * Omitted/empty declarations keep the original menu. Unsupported values are
   * ignored; omitted supported host values are appended in selection menus.
   * Button/action menus use plugin.buttons.<id> / plugin.actions.<id>; their only
   * host value is 'default' (the original operation), which is never auto-appended.
   * Omit its title to use the original button title. Actions call actions[id]().
   */
  menus?: Record<string, SourceMenuEntry[]>;
  /** Every button must explicitly name its existing UI slot. */
  buttons?: SourceButton[];
  /** Up to 8 extra comic detail tabs after the built-in ones; requires comic.loadDetailTab. */
  detailTabs?: SourceDetailTab[];
  searchOrders?: Record<string, string | Record<string, string>>; searchDefaultOrder?: string;
  /** Detail tag groups to flatten into saved/list tags. */
  listTagGroups?: string[];
  /** Fetch details for missing list tags while this plugin is enabled. */
  enrichMissingTags?: boolean;
  /** Compatibility aliases for previously saved favorite sort values. */
  favoriteOrderAliases?: Record<string, string>;
  /** Migrate old local preferences once; local sorting is now owned by the host.
   * 'updatedNewest' is retired and treated as 'readNewest'; kept only for published plugins. */
  localFavoriteOrders?: Record<string, 'savedNewest' | 'savedOldest' | 'readNewest' | 'updatedNewest'>;
  /** Display labels for cloud favorite orders; unknown unlabeled orders show their code. */
  favoriteOrderLabels?: Record<string, SourceText>;
  /** Legacy alias for menus['favorites.cloud.sort']; an explicitly declared
   * menus entry (including []) takes precedence. Other menus use menus[menuId]. */
  favoriteMenu?: SourceFavoriteMenuEntry[];
  favoriteOrders?: string[]; favoriteDefaultOrder?: string; favoriteOrderSetting?: string;
  requiresLogin?: boolean; dailyCheckIn?: boolean; skipPeriodicRelogin?: boolean;
  /** Explicit opt-in for both the detail comments tab and reader comments entry.
   * Omitted/false hides both, regardless of whether loadComments is implemented.
   */
  showComments?: boolean;
  commentReplies?: boolean;
  /** Comment order codes and localized labels, shared by comic/chapter comments. */
  commentOrders?: Record<string, SourceText>;
  /** Falls back to the first declared order; omitted orders hide the sort menu. */
  commentDefaultOrder?: string;
  /** @deprecated Host no longer enables ID lookup or recommendations from this flag. */
  directComicId?: boolean;
  /** Case-insensitive full keyword match; use the first nonempty capture as the ID. */
  directComicIdRules?: {patterns: string[]; extractDigits: boolean};
  /** Independent opt-in; searchOrder must name a supported search ordering. */
  dailyRecommendation?:
    | {mode?: 'authors'; searchOrder: string}
    | {mode: 'plugin'};
  showComicId?: boolean;
  showTags?: boolean; showComicStatus?: boolean;
  legacyRanking?: boolean; recreateOnStatus?: number[];
  refreshCloudFavorites?: boolean;
  imageQualitySetting?: string; imageQualityDefault?: string;
  imageQualityOptions?: Record<string, string>; imageQualityTitle?: string;
  /** Omitted location displays the action in this plugin's settings page.
   * All locations automatically support menus['plugin.actions.<id>'].
   */
  actions?: {id: string; title: SourceText; location?: SourceActionLocation}[];
}
interface HazukiSourceDefinition {
  /** Stable data identity; class-based sources may use key instead. */
  id?: string;
  key?: string;
  name?: string;
  version?: string;
  apiVersion?: 1;
  init?: () => Awaitable<void>;
  search: {load(keyword: string, options: string[], page: number): Awaitable<ComicPage>};
  comic: {
    loadInfo(id: string): Awaitable<SourceComicDetails>;
    loadEp(comicId: string, chapterId: string): Awaitable<{images: string[]}>;
    /** Only logged-in online reader viewport events. Never image preload/download events. */
    onReadingProgress?: (progress: SourceReadingProgress) => Awaitable<void>;
    /** Declaring this makes online positions website-authoritative. No fallback
     * to local/cache on missing record, login or network failure. Offline stays local.
     */
    loadReadingProgress?: (comicId: string) => Awaitable<SourceCloudReadingProgress | null>;
    /** Requires loadReadingProgress. Pages start at 1; without maxPage an empty
     * page ends import. Return all pages, not just recently opened comics.
     */
    loadReadingHistory?: (page: number) => Awaitable<{
      items: {comic: SourceComic; progress: SourceCloudReadingProgress}[];
      maxPage?: number;
    }>;
    onImageLoad?: (url: string, comicId: string, chapterId: string) => Awaitable<ImageLoadConfig>;
    transformImageBytes?: (bytes: Uint8Array, url: string, comicId: string, chapterId: string) => Awaitable<{bytes: Uint8Array; extension?: string}>;
    /** Runs after transformImageBytes with the decoded size; a non-empty layout takes precedence over segments. GIFs are skipped. */
    mapImageRegions?: (width: number, height: number, url: string, comicId: string, chapterId: string) => Awaitable<ImageRegionLayout | null | undefined>;
    /** Required by presentation.detailTabs. Prefetched with the details; up to 100 blocks.
     * An empty array keeps the tab and shows an empty state.
     */
    loadDetailTab?: (comicId: string, tabId: string) => Awaitable<SourceDetailTabBlock[]>;
    /** Handles headerStats items with action 'plugin' (comicHeaderVersion >= 2).
     * May open dialogs; return new header content, {reload: true}, or nothing.
     */
    onHeaderAction?: (comicId: string, actionId: string) =>
      Awaitable<SourceComicHeaderActionResult | void | null>;
    /** Older hosts only (comicHeaderVersion < 2): host-placed like button. Ignored by newer hosts. */
    likeComic?: (id: string, isLike: boolean) => Awaitable<void>;
    /** Host passes the selected commentOrders code as the fifth argument, also for replies.
     * Without declared orders the host passes ''. Older four-argument plugins remain compatible.
     */
    loadComments?: (id: string, subId: string | null, page: number, replyTo: string | null, order?: string) => Awaitable<{comments: SourceComment[]; maxPage?: number}>;
    loadChapterComments?: (id: string, chapterId: string, page: number, replyTo: string | null, order?: string) => Awaitable<{comments: SourceComment[]; maxPage?: number}>;
    sendComment?: (id: string, subId: string | null, text: string, replyTo: string | null) => Awaitable<void>;
    sendChapterComment?: (id: string, chapterId: string, text: string, replyTo: string | null) => Awaitable<void>;
    likeComment?: (id: string, subId: string | null, commentId: string, isLike: boolean) => Awaitable<void>;
  };
  account?: {
    /** Omitted preserves the legacy credentials form and login runtime. */
    loginMethods?: SourceLoginMethod[];
    /** context is supplied for explicitly declared foreground login methods only. */
    login(account: string, password: string, context?: SourceLoginContext): Awaitable<SourceProfile | void>;
    logout?: () => Awaitable<void>;
    loadProfile?: () => Awaitable<SourceProfile>;
    checkInStatus?: () => Awaitable<boolean | null>;
    checkIn?: () => Awaitable<{status: 'success' | 'alreadyCheckedIn' | 'skipped'; message?: string}>;
  };
  explore?: SourceExplore[];
  category?: {title: string; parts: {
    name: string; type?: 'fixed'; itemType: 'search' | 'category';
    categories: string[]; categoryParams?: (string | null)[];
  }[]};
  categoryComics?: {
    load(category: string, param: string | null, options: string[], page: number): Awaitable<ComicPage>;
    optionList?: SourceOptionGroup[];
    optionLoader?: (category: string, param: string | null) => Awaitable<SourceOptionGroup[]>;
    ranking?: {options: string[]; load(option: string, page: number): Awaitable<ComicPage>};
  };
  favorites?: {
    /** Whether each comic can belong to at most one folder, not the number of folders. */
    singleFolderForSingleComic?: boolean;
    /** Receives the selected plugin folder ID; null / '0' retain legacy all-list semantics. */
    loadComics?: (page: number, folderId: string | null) => Awaitable<ComicPage>;
    loadNext?: (cursor: string | null, folderId: string) => Awaitable<{comics: SourceComic[]; next?: string}>;
    /**
     * Plugin IDs and names are preserved; no '0' entry is required or injected.
     * Only absent/empty folder lists use the host's default all entry.
     * favorited contains these same IDs for a comic; comicId is null for a folder listing.
     */
    loadFolders?: (comicId: string | null) => Awaitable<{folders: Record<string, string>; favorited?: string[]}>;
    addFolder?: (name: string) => Awaitable<void>;
    /** Enables long-press renaming in cloud favorites. Keep the folder ID unchanged; throw on failure. */
    renameFolder?: (id: string, name: string) => Awaitable<void>;
    deleteFolder?: (id: string) => Awaitable<void>;
    addOrDelFavorite?: (comicId: string, folderId: string, adding: boolean, favoriteId?: string | null) => Awaitable<void>;
  };
  /** Required for presentation.dailyRecommendation.mode='plugin'.
   * Return the website's full selected list in display order. No seven-item limit.
   * Empty results hide the carousel. Throw on failure to retain the last cache.
   */
  dailyRecommendation?: {load(): Awaitable<SourceDailyRecommendationItem[]>};
  settings?: Record<string, SourceSetting>;
  presentation?: SourcePresentation;
  actions?: Record<string, () => Awaitable<unknown>>;
  lines?: {snapshot?: () => Awaitable<Record<string, unknown>>};
  translation?: Record<string, Record<string, string>>;
  /** Optional text resources embedded in this JS file. */
  resources?: Record<string, string>;
}
/** Native foreground dialogs. All text uses the plugin's normal localization. */
type SourceDialogImage = SourceLoginImage;
type SourceDialogValue = string | string[] | boolean | number | {x: number; y: number}[];
/** 'navigated': the host closed the window to open a comic or search; the operation is not cancelled. */
type SourceDialogCloseReason = 'user' | 'plugin' | 'ownerGone' | 'superseded' |
  'sourceChanged' | 'background' | 'timeout' | 'runtimeDisposed' | 'operationFinished' | 'navigated';
/** Built-in icon names; unknown names render no icon. */
type SourceDialogIcon = 'like' | 'liked' | 'dislike' | 'favorite' | 'favorited' | 'star' |
  'star_outline' | 'eye' | 'comment' | 'share' | 'download' | 'link' | 'open' | 'copy' | 'search' |
  'tag' | 'person' | 'group' | 'time' | 'calendar' | 'update' | 'book' | 'pages' | 'image' | 'lock' |
  'paid' | 'coin' | 'vip' | 'gift' | 'fire' | 'trending' | 'rank' | 'language' | 'info' | 'warning' |
  'flag' | 'check' | 'close' | 'add' | 'remove' | 'edit' | 'delete' | 'refresh' | 'settings' | 'more';
type SourceDialogValueAction = 'search' | 'copy' | 'none';
/** Components allowed inside a row; `flex` 0 keeps intrinsic width. */
type SourceDialogRowChild = {id: string; flex?: number} & (
  | {type: 'text'; text: SourceText; tone?: 'normal' | 'error' | 'secondary'}
  | Extract<SourceDialogComponent, {type: 'richText' | 'image' | 'button' | 'rating' | 'tags' | 'progress'}>
);
type SourceDialogComponent = {id: string} & (
  | {type: 'text'; text: SourceText; tone?: 'normal' | 'error' | 'secondary'}
  | {type: 'image'; image: SourceDialogImage; description?: SourceText;
      /** 16–400, default 200. */ height?: number; shape?: 'rect' | 'circle'}
  /** Interactive unless readOnly; returns a number (0 = unrated). readOnly accepts any decimal. */
  | {type: 'rating'; label?: SourceText; initialValue?: number; max?: number; allowHalf?: boolean;
      readOnly?: boolean; required?: boolean; notifyChange?: boolean}
  | {type: 'row'; children: SourceDialogRowChild[]; align?: 'start' | 'center' | 'end' | 'spaceBetween'}
  /** Emits {type: 'action', id} like bottom buttons; id must not repeat a bottom button id. */
  | {type: 'button'; text: SourceText; icon?: SourceDialogIcon;
      style?: 'tonal' | 'filled' | 'outlined' | 'text' | 'icon'; enabled?: boolean; validate?: boolean}
  /** Tapping opens the comic's detail in this source and closes the window with reason 'navigated'. */
  | {type: 'comics'; title?: SourceText; layout?: 'row' | 'grid';
      items: {id: string; title: string; subtitle?: string; cover?: string}[]}
  | {type: 'tags'; label?: SourceText; values: string[]; action?: SourceDialogValueAction}
  | {type: 'info'; rows: {label: SourceText; values: string[]; action?: SourceDialogValueAction}[]}
  | {type: 'richText'; spans: {text: SourceText; bold?: boolean; italic?: boolean;
      tone?: 'normal' | 'secondary' | 'error' | 'primary'; link?: string}[]}
  | {type: 'input'; label: SourceText; initialValue?: string; placeholder?: SourceText;
      obscure?: boolean; keyboardType?: 'text' | 'number'; required?: boolean; maxLength?: number}
  | {type: 'select'; label: SourceText; options: {value: string; label: SourceText}[];
      multiple?: boolean; initialValue?: string | string[]; required?: boolean; notifyChange?: boolean}
  | {type: 'toggle'; label: SourceText; initialValue?: boolean; notifyChange?: boolean}
  | {type: 'clickImage'; image: SourceDialogImage; hintImage?: SourceDialogImage;
      description?: SourceText; pointCount?: number}
  | {type: 'progress'; text?: SourceText; value?: number}
  | {type: 'divider'}
);
interface SourceDialogButton {
  id: string; text: SourceText; role?: 'primary' | 'secondary'; enabled?: boolean; validate?: boolean;
}
interface SourceDialogOptions {
  /** 0–4 bottom buttons; the close button is always available. */
  title: SourceText; content: SourceDialogComponent[]; buttons: SourceDialogButton[];
  /** Fixed when opened; update cannot switch it. Defaults to 'dialog'. */
  presentation?: 'dialog' | 'sheet';
}
interface SourceDialogPatch {
  title?: SourceText; content?: SourceDialogComponent[]; buttons?: SourceDialogButton[];
  values?: Record<string, SourceDialogValue>; busy?: boolean;
  /** Replaces field errors; omitted updates clear errors, null entries clear that field. */
  fieldErrors?: Record<string, SourceText | null>;
}
interface SourceSimpleDialogOptions {
  title: SourceText; message?: SourceText; confirmText?: SourceText; cancelText?: SourceText;
}
interface SourcePromptOptions extends SourceSimpleDialogOptions {
  label: SourceText; initialValue?: string; placeholder?: SourceText; obscure?: boolean;
  keyboardType?: 'text' | 'number'; required?: boolean; maxLength?: number;
}
type SourceDialogEvent =
  | {type: 'action' | 'change'; id: string; values: Record<string, SourceDialogValue>}
  | {type: 'closed'; reason: SourceDialogCloseReason};
interface SourcePluginDialog {
  nextEvent(): Promise<SourceDialogEvent>;
  update(patch: SourceDialogPatch): Promise<void>;
  close(): Promise<void>;
}
interface SourcePluginDialogCancelledError extends Error {
  readonly code: 'plugin_ui_cancelled'; readonly reason: SourceDialogCloseReason;
}

declare const Hazuki: {
  /** Optional API v1 extension: feature-detect on older hosts. Available to all
   * plugin operations, including initialization, background work and callbacks.
   * Requests made while the app is backgrounded wait for foreground display.
   */
  ui: {
    /** Absent on older hosts; 3 adds rating/row/button/comics/tags/info/richText, sheets and empty buttons. */
    readonly dialogVersion?: number;
    isAvailable(): Promise<boolean>;
    /** Opens the isolated WebView outside login too. Explicit cookieScopes import
     * cookies and the actual browser UA into this plugin's session on completion.
     * Login runtimes retain their existing staged commit/rollback semantics.
     */
    openWebView(options: SourceWebViewOptions): SourceWebViewRequest;
    /** Same behavior as the login context API, available from any plugin task. */
    requestBrowserAuthorization(options: SourceWebViewOptions): SourceWebViewRequest;
    alert(options: SourceSimpleDialogOptions): Promise<void>;
    confirm(options: SourceSimpleDialogOptions): Promise<boolean>;
    prompt(options: SourcePromptOptions): Promise<string | null>;
    /** Plugin chooses when to open, including after HTTP/Promise waits or in a
     * retained callback. Multiple requests share the global display queue.
     * Page changes do not revoke UI; explicit task/runtime cancellation still does.
     */
    openDialog(options: SourceDialogOptions): Promise<SourcePluginDialog>;
    PluginDialogCancelledError: new (reason?: SourceDialogCloseReason) => SourcePluginDialogCancelledError;
  };
  readonly apiVersion: 1;
  /** Absent on older hosts. 2 adds headerBadges, stat icons/actions and comic.onHeaderAction. */
  readonly comicHeaderVersion?: number;
  /** Current app language; changes without reloading the plugin. */
  readonly locale: 'zh_CN' | 'en_US';
  /** Resolve a language map or look up a string in this plugin's translation. */
  translate(text: SourceText): string;
  registerSource(source: HazukiSourceDefinition): void;
  /** Parse HTML without executing scripts or loading page resources. */
  html: {parse(html: string): HtmlDocument};
  http: {
    get(url: string, headers?: Record<string, string>, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    post(url: string, headers?: Record<string, string>, body?: unknown, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    put(url: string, headers?: Record<string, string>, body?: unknown, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    patch(url: string, headers?: Record<string, string>, body?: unknown, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    delete(url: string, headers?: Record<string, string>, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    sendRequest(method: string, url: string, headers?: Record<string, string>, body?: unknown, extra?: SourceHttpExtra): Promise<SourceHttpResponse<string>>;
    fetchBytes(method: string, url: string, headers?: Record<string, string>, body?: unknown, extra?: SourceHttpExtra): Promise<SourceHttpResponse<ArrayBuffer>>;
  };
  storage: {get(key: string): unknown; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>};
  secrets: {get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>};
  settings: {get(key: string): unknown; set(key: string, value: unknown): Promise<void>};
  resources: {readText(path: string): Promise<string>};
  cookies: {get(url: string): Promise<SourceCookie[]>; set(url: string, cookies: SourceCookie[]): Promise<void>; delete(url: string): Promise<void>};
  images: {
    reverseVerticalTiles(segments: number): ImageLoadConfig;
    regions(regions: ImageRegion[], size?: {width?: number; height?: number}): ImageRegionLayout;
  };
  convert: SourceConvert;
  log(message: unknown, level?: string): void;
  delay(ms: number): Promise<void>;
  error(code: 'AUTH_EXPIRED' | string, message: string): Error;
};

declare abstract class HazukiSource implements HazukiSourceDefinition {
  abstract search: HazukiSourceDefinition['search'];
  abstract comic: HazukiSourceDefinition['comic'];
  readonly key: string; readonly name: string; readonly version: string;
  loadData<T = any>(key: string): T;
  saveData(key: string, value: unknown): Promise<void>;
  deleteData(key: string): Promise<void>;
  loadSetting<T = any>(key: string): T;
  readonly isLogged: boolean;
  translate(text: SourceText): string;
  init(): Awaitable<void>;
}
