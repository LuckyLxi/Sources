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
  /** Mobile inline like action; requires comic.likeComic. Otherwise text only. */
  action?: 'none' | 'like';
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
  /** Structured data for listTagGroups and existing header status, not detail rows. */
  tags?: Record<string, string[]>; recommend?: SourceComic[];
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
    /** Required exact names, imported only from this isolated browser. */
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
}
/** Parsed static HTML. Call dispose() after extracting data. */
declare class HtmlDocument {
  constructor(html: string);
  querySelector(query: string): HtmlElement | null;
  querySelectorAll(query: string): HtmlElement[];
  getElementById(id: string): HtmlElement | null;
  dispose(): void;
}
declare class HtmlElement {
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
declare class HtmlNode {
  readonly text: string;
  readonly type: 'text' | 'element' | 'comment' | 'document' | 'unknown';
  toElement(): HtmlElement | null;
}
interface ImageLoadConfig {
  url?: string; headers?: Record<string, string>;
  /** Number of equal-height vertical strips to reverse; zero means unchanged. */
  segments?: number;
}
type SourceActionLocation = 'plugin' | 'reading' | 'other' | 'lab' | 'advanced' | 'lines';
/** Fixed UI slots. Buttons reuse the app's existing layout and callbacks. */
type SourceButton = (
  | {id: 'checkIn'; location: 'homeProfile'}
  | {id: 'autoCheckIn'; location: 'other'}
  | {id: 'copyComicId'; location: 'comicDetailInfo'}
  | {id: 'relatedComics'; location: 'comicDetailTabs'}
  | {id: 'imageQuality'; location: 'reading' | 'reader'}
  | {id: 'resetDeviceInfo'; location: 'advanced'; action: string}
) & {title?: SourceText; subtitle?: SourceText; successMessage?: SourceText};
interface SourcePresentation {
  /** Every button must explicitly name its existing UI slot. */
  buttons?: SourceButton[];
  searchOrders?: Record<string, string | Record<string, string>>; searchDefaultOrder?: string;
  /** Detail tag groups to flatten into saved/list tags. */
  listTagGroups?: string[];
  /** Fetch details for missing list tags while this plugin is enabled. */
  enrichMissingTags?: boolean;
  /** Compatibility aliases for previously saved favorite sort values. */
  favoriteOrderAliases?: Record<string, string>;
  /** Migrate old local preferences once; local sorting is now owned by the host. */
  localFavoriteOrders?: Record<string, 'savedNewest' | 'savedOldest' | 'updatedNewest'>;
  /** Display labels for cloud favorite orders; unknown unlabeled orders show their code. */
  favoriteOrderLabels?: Record<string, SourceText>;
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
  /** Omitted location displays the action in this plugin's settings page. */
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
    /** Provides the desktop like button and enables mobile headerStats like actions. */
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
declare const Hazuki: {
  readonly apiVersion: 1;
  /** Current app language; changes without reloading the plugin. */
  readonly locale: 'zh_CN' | 'en_US';
  /** Resolve a language map or look up a string in this plugin's translation. */
  translate(text: SourceText): string;
  registerSource(source: HazukiSourceDefinition): void;
  /** Parse HTML without executing scripts or loading page resources. */
  html: {parse(html: string): HtmlDocument};
  http: {
    get(url: string, headers?: Record<string, string>, extra?: Record<string, unknown>): Promise<SourceHttpResponse<string>>;
    post(url: string, headers?: Record<string, string>, body?: unknown, extra?: Record<string, unknown>): Promise<SourceHttpResponse<string>>;
    sendRequest(method: string, url: string, headers?: Record<string, string>, body?: unknown, extra?: Record<string, unknown>): Promise<SourceHttpResponse<string>>;
    fetchBytes(method: string, url: string, headers?: Record<string, string>, body?: unknown, extra?: Record<string, unknown>): Promise<SourceHttpResponse<ArrayBuffer>>;
  };
  storage: {get(key: string): unknown; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>};
  secrets: {get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>};
  settings: {get(key: string): unknown; set(key: string, value: unknown): Promise<void>};
  resources: {readText(path: string): Promise<string>};
  cookies: {get(url: string): Promise<SourceCookie[]>; set(url: string, cookies: SourceCookie[]): Promise<void>; delete(url: string): Promise<void>};
  images: {reverseVerticalTiles(segments: number): ImageLoadConfig};
  convert: Record<string, (...args: any[]) => any>;
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
