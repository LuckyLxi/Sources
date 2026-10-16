# Hazuki 漫画源插件 API v1

插件负责网站请求、签名、登录、解析和图片规则；宿主负责展示、收藏存储、阅读与下载。新增源通过本规范注册，无需修改宿主。

## 仓库列表与单文件插件

公开 GitHub 仓库根目录的 `plugins.json` 是插件列表：

```json
{"schemaVersion":1,"plugins":[
  {"id":"example","name":"Example","version":"1.0.0","downloadUrl":"https://example.com/example-1.0.0.js"}
]}
```

`downloadUrl` 指向单个 UTF-8 JS 文件，可托管在 GitHub Releases 或其他 HTTPS 服务。发布时将示例中的 `example.com` 替换为实际下载地址。

应用使用内置索引 `https://raw.githubusercontent.com/LuckyLxi/Sources/main/plugins.json`，支持在线安装和本地 JS 导入，不随安装包附带源脚本。每次启动下载一次索引，与已安装插件的 ID、版本比较，提示用户选择更新；停用插件也参与检查。进入或切换插件列表使用缓存，点击“刷新列表”重新下载；网络失败保留已安装记录和缓存。

高级设置中的“更新链接线路”支持 jsDelivr、GitHub 原始文件和 ghproxy，仅影响索引刷新与更新检查。插件下载始终使用索引中的原始 `downloadUrl`；切换线路不改变插件身份或已有数据。

源码维护在 [LuckyLxi/Sources](https://github.com/LuckyLxi/Sources)。开发文档、类型声明和示例位于本仓库的 `docs/`，测试位于 `dev/`。

## 单个 JS 文件与发布

文件直接包含插件实现，不需要特殊注释头或独立元数据：

```javascript
Hazuki.registerSource({
  id: 'example',
  name: 'Hazuki Example',
  version: '1.0.0',
  presentation: {searchDefaultOrder: 'latest', searchOrders: {latest: 'Latest'}},
  search: {load: async (keyword, options, page) => ({comics: [], maxPage: 1})},
  comic: {
    loadInfo: async id => ({id, title: 'Example', chapters: {'1': 'Chapter 1'}, tags: {}}),
    loadEp: async (comicId, chapterId) => ({images: []})
  },
  resources: {'about.txt': 'An embedded text resource'}
});
```

宿主从注册对象读取元数据：

- `id`（类式源也可用 `key`）：账号、收藏等数据的关联标识。小写字母开头，后续可用字母、数字、点、下划线、连字符，最多 64 字符；修改后视为另一个插件。
- `name`：默认使用 ID。
- `version`：默认 `0.0.0`。本地插件可用普通版本标签，在线发布建议使用 SemVer。
- `apiVersion`：可省略，显式声明时仅支持 `1`。

普通注释、BOM、前置代码不影响导入。

插件限单个 UTF-8 `.js` 文件，最大 8 MiB；不支持 ZIP、外部资源目录、npm、Node、原生模块或远程动态代码导入。实现与依赖须合并到单文件。静态数据可定义为 JS 常量，文本资源通过 `resources` 声明并用 `Hazuki.resources.readText(name)` 读取。

```powershell
dart run tool/build_source_plugin.dart ../HazukiSources/docs/examples/example.js
```

命令从 Hazuki 主仓库运行，假定本仓库检出在同级 `HazukiSources` 目录。工具复制源码到 `build/source_plugins/<输入文件名>`，第二个参数可指定输出位置；本地导入可直接使用源码。本仓库的索引由工作流自动生成，使用方法见 [开发文档](README.md#自动更新索引)。类型声明见 [hazuki-source.d.ts](hazuki-source.d.ts)，最小示例见 [example.js](examples/example.js)。

## 注册和数据接口

入口调用一次 `Hazuki.registerSource({...})`，或声明继承 `HazukiSource`、`ComicSource` 的类，由宿主实例化并注册。插件身份注册后锁定。联网和数据读写的初始化放在 `init()` 中，首次使用时执行；导入仅校验身份与接口，不执行 `init()` 或访问用户数据。必须提供：

- `search.load(keyword, options, page)`：页码从 1 开始，返回 `{comics, maxPage}`。
- `comic.loadInfo(id)`：返回详情，`chapters` 是章节 ID 到标题的映射；`tags` 是命名空间到标签数组的映射。
- `comic.loadEp(comicId, chapterId)`：返回 `{images: [url, ...]}`。

漫画摘要使用 `{id, title, cover, subTitle?, tags?}`。应用负责附加当前插件 ID，插件不应返回其他源的身份。可选能力的方法缺失时不提供对应操作。

详情信息栏统一通过 `comic.loadInfo().infoFields` 声明。栏目名称、内容、顺序和点击行为由插件决定，宿主沿用现有信息栏样式；不再从 `tags`、`uploader` 或展示开关推断作者、分类、汉化组等固定栏目。四个现有插件也使用同一格式，不提供旧信息栏回退。未声明或返回空数组时不显示这些栏目；ID 复制入口仍由原有按钮声明控制。

```javascript
infoFields: [
  {label: {zh: '作者', en: 'Author'}, values: ['作者甲', '作者乙'], action: 'search'},
  {label: {zh: '状态', en: 'Status'}, values: '连载中'},
  {label: {zh: '出版社', en: 'Publisher'}, values: '示例出版社', action: 'copy'}
]
```

`label` 为非空字符串或语言映射，普通字符串支持插件翻译表。`values` 为字符串或字符串数组，空白值会被去除，内容中的逗号、斜线等标点保持原样，不自动拆分。栏目按数组顺序显示，空栏目隐藏；非法结构或未知操作会使详情加载报错。`action` 可选 `none`（默认，仅展示）、`search`（使用当前源搜索）或 `copy`（复制所点内容）。各栏目仍支持原有长按复制。语言映射随应用语言切换显示，漫画内容不自动翻译。

`tags` 保留为列表、收藏、历史标签提取及现有头部状态使用的结构化数据，不再决定信息栏。`viewsCount` 可作为结构化浏览量数据保留；统计行只读取 `headerStats`，不从其他字段推断内容。作者应放入插件自己定义的信息栏，不得写入摘要或详情的 `subTitle` / `subtitle`；详情页头部不展示副标题。更新应用时应同步更新插件，旧格式不会被转换为信息栏。

可选 `explore` 支持分区首页、单页多分区及分页漫画列表；`category`、`favorites`、`comic` 的评论与点赞接口使用类型声明中的统一结构。`account.login` 返回标准化的 `{token?, displayName?, avatarUrl?}`，头像必须由插件转换成可用完整 URL；应用保存用户输入的账号供重新登录使用。`account.loadProfile` 用相同字段更新资料。

`account.checkIn` 返回 `{status: "success" | "alreadyCheckedIn" | "skipped", message?}`。账号能力和这些操作都作用于该插件，不能读取其他插件的凭据。

## 阅读按钮上方的短统计行

`comic.loadInfo().headerStats` 自由声明阅读按钮上方的短统计内容，名称、文案、数量和顺序由插件决定。宿主沿用现有文字样式、间距、加载占位和入场动画；不再根据 `likesCount`、`viewsCount`、`pageCount`、`tags` 或旧 `showPageCount` 开关自动拼接统计文案。省略或返回空数组时不显示统计内容。

**此处不可填写大量文本。** 这里只能放点赞数、浏览量、页数、评分、简短状态等短信息；不得放简介、长作者列表、公告或其他长段落。长文本必须放入 `infoFields` 或 `description`。建议只放少量简短项目，避免整行被截断；超出可用宽度时以省略号显示，不展开成长文本区域。

```javascript
headerStats: [
  {text: {zh: '123点赞', en: '123 likes'}, action: 'like'},
  {text: {zh: '456浏览量', en: '456 views'}},
  {text: {zh: '评分 9.8', en: 'Rating 9.8'}}
]
```

`text` 为字符串或语言映射，普通字符串支持插件翻译表。空文本项目自动隐藏，不重排其余项目。`action` 可选 `none`（默认）或 `like`；后者在手机端复用原点赞按钮和 `comic.likeComic` 回调，并保留点赞中防重复点击和选中状态。未提供点赞接口时该项目只显示文字。桌面统计行按声明顺序展示短文案，桌面原有的独立点赞按钮仍由 `comic.likeComic` 能力控制。语言映射随应用语言切换显示，点击点赞不会由宿主改写插件提供的统计文字。非法结构和未知操作会使详情加载报错。

四个现有插件均已迁移：禁漫提供点赞数和浏览量，哔咔提供点赞数和页数，拷贝及热辣提供简短状态。没有旧字段回退，需要同步更新或重新导入插件。

## 评论入口声明

插件必须在注册时显式声明 `presentation.showComments: true`，才会同时显示详情页评论标签和阅读器评论入口。省略或设为 `false` 时两处均隐藏；仅实现 `comic.loadComments`、`loadChapterComments` 或声明 `commentReplies` 不会自动显示入口。此字段只接受布尔值。离线阅读始终隐藏评论入口。

```javascript
presentation: {showComments: true, commentReplies: true}
```

禁漫、拷贝、哔咔已显式启用评论。热辣当前没有可用评论服务，不声明此字段，因此两处入口都隐藏。该声明不进入历史展示缓存，停用或卸载插件不会由旧缓存重新启用评论。详情页根据实际显示的标签数量建立控制器，隐藏评论时仍可正常切换相关推荐。

## 云端收藏夹接口

`favorites.loadFolders(comicId)` 返回 `{folders, favorited?}`。`folders` 是收藏夹 ID 到显示名称的映射，ID 由插件定义，无需包含 `'0'`。例如：

```javascript
{
  folders: {shelf: '书架'},
  favorited: ['shelf']
}
```

宿主保留插件返回的收藏夹及其顺序，不因缺少 `'0'` 额外添加“全部”。上例只显示“书架”；返回多个收藏夹时只显示这些收藏夹。收藏页保存的选择已不存在时，改选第一个返回的收藏夹。

`loadComics(page, folderId)`、`addOrDelFavorite(comicId, folderId, adding)` 和 `favorited` 使用同一套插件收藏夹 ID。查询漫画收藏状态时，`favorited` 返回该漫画所属的 ID，未收藏返回空数组；只查询收藏夹列表时，`comicId` 为 `null`，可省略 `favorited`。`singleFolderForSingleComic` 仅表示一部漫画能否同时放入多个收藏夹，不表示网站只有一个收藏夹。

网站没有分组时，可以只实现 `loadComics` 和收藏操作，省略 `loadFolders`。未提供收藏夹接口或返回的列表为空时，宿主显示一个默认“全部”入口。为兼容既有插件，`'0'` 仍是可选的旧版“全部”ID；其显示、不可删除规则，以及 `loadComics` 的 `null` / `'0'` 聚合加载兼容行为保持不变。需要保留这个入口的分组插件应显式返回它；普通收藏夹无需使用这个 ID。

## 宿主 SDK

- `Hazuki.http`：通用 GET、POST 等请求，返回状态、响应头、正文和可选错误；网站状态含义由插件判断。
- `Hazuki.html.parse(html)`：解析静态 HTML，返回支持 CSS 选择器的文档；也可使用 `new HtmlDocument(html)`。支持文本、属性、子节点、父元素及相邻元素读取，使用后调用 `dispose()` 释放文档。文档按插件引擎隔离，关闭或替换引擎时自动清理。
- `Hazuki.cookies`：插件私有 Cookie；`Hazuki.storage`：插件私有 JSON 数据。写操作必须 `await`，特别是登录后要立即读取的 token。
- `Hazuki.secrets`：插件作用域的安全字符串存储；现有 `account`、`token` 和 Cookie 仍使用原安全存储，便于升级关联。
- `Hazuki.settings`：读取声明的默认值或用户设置，写入当前插件的设置。
- `Hazuki.convert`：UTF-8、Base64、MD5、SHA、HMAC、AES-ECB；其他算法可以随单文件入口打包实现。
- `Hazuki.resources.readText`：读取注册对象中嵌入的文本资源，不访问宿主文件系统。
- `Hazuki.images.reverseVerticalTiles(n)`：声明图片竖向分块重排；`comic.onImageLoad` 可同时提供下载 URL、请求头和 `segments`。自定义字节解密使用 `comic.transformImageBytes`。
- `Hazuki.log`、`delay`、`error`：日志、延时和错误。`Hazuki.error("AUTH_EXPIRED", message)` 可触发宿主的一次账号重试；更复杂的网站恢复逻辑放在插件中。
- `Hazuki.locale`：当前应用语言（`zh_CN` 或 `en_US`），跟随应用设置及系统语言；`Hazuki.translate(text)`：解析语言映射，或按插件的 `translation` 表翻译原字符串。类式源的 `this.translate(text)` 使用相同规则。

脚本在独立 QuickJS 引擎中运行，同步执行限制为 5 秒、内存限制为 64 MiB，初始化等待最多 90 秒。网络、Cookie、存储和资源均绑定已注册插件的 ID。

### 获取并解析 HTML

```javascript
const response = await Hazuki.http.get('https://example.com/comics', {
  'User-Agent': 'Mozilla/5.0'
});
if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
const doc = Hazuki.html.parse(response.body);
try {
  const comics = doc.querySelectorAll('.comic-item').map(item => {
    const link = item.querySelector('a');
    const image = item.querySelector('img');
    return {
      id: link?.attributes.href ?? '',
      title: link?.text.trim() ?? '',
      cover: image?.attributes.src ?? ''
    };
  });
  // 按网站规则转换 ID，并将相对图片地址转换为完整 URL。
  return {comics, maxPage: 1};
} finally {
  doc.dispose();
}
```

选择器无匹配时，`querySelector()` 返回 `null`，`querySelectorAll()` 返回空数组。释放后不可继续读取文档或其元素。解析器不会执行网页脚本或加载图片、样式等资源；仅通过 JavaScript 动态生成的内容需要插件请求网站的数据接口。

### 插件文案与语言切换

按钮标题、设置标题、下拉选项标签和操作返回的提示支持直接写成语言映射，也兼容原字符串与翻译表：

```javascript
Hazuki.registerSource({
  // 身份、search 和 comic 等必需字段略。
  settings: {
    quality: {
      title: {zh: '图片质量', en: 'Image quality'}, type: 'select', default: 'high',
      options: [{value: 'high', label: {zh: '高', en: 'High'}}]
    }
  },
  presentation: {actions: [{id: 'refresh', title: '刷新线路', location: 'lines'}]},
  translation: {
    zh_CN: {'Lines refreshed': '线路已刷新'},
    en: {'刷新线路': 'Refresh lines'}
  },
  actions: {refresh: async () => {
    // 在回调执行时读取当前语言，不要在注册时提前翻译并保存标题。
    Hazuki.log(Hazuki.locale);
    return Hazuki.translate('Lines refreshed');
    // 也可直接返回 {zh: '线路已刷新', en: 'Lines refreshed'}。
  }}
});
```

应用切换语言时自动刷新控件文案。跨页面按钮使用安装时保存的翻译表，无需初始化插件；新增翻译表后需更新或重新导入插件。

语言键支持 `zh`、`en` 以及 `zh_CN`/`zh-CN`、`en_US`/`en-US`；当前区域键优先于语言键。语言映射缺少当前语言时，依次回退到英文、首个非空字符串；翻译表没有匹配项时保留原文。控件实际保存的 `value`、用户输入、URL 和漫画内容不做自动翻译。

## 设置与显示能力

### 现有按钮的位置声明

`presentation.buttons` 将源功能放入宿主已有控件，每项必须填写 `id` 和 `location`。修改声明后需更新或重新导入 JS。

桌面独立点赞按钮由可调用的 `comic.likeComic(id, isLike)` 控制；手机统计行通过 `headerStats` 的 `action: 'like'` 项提供入口。宿主在详情加载后重新检查能力。旧 `comicLike` 位置声明和 `showComicLike` 开关不再生效。

| id | location | 原有位置及调用 |
| --- | --- | --- |
| `checkIn` | `homeProfile` | 首页个人资料区域的签到按钮，调用插件 `account.checkIn()` |
| `autoCheckIn` | `other` | 设置 → 其他设置的自动签到开关，开启后的签到调用插件 `account.checkIn()` |
| `copyComicId` | `comicDetailInfo` | 漫画详情 → 信息中的 ID 复制入口；ID 来自插件 `comic.loadInfo()`，系统剪贴板由宿主处理 |
| `relatedComics` | `comicDetailTabs` | 漫画详情的相关推荐标签页，数据来自插件 `comic.loadInfo().recommend` |
| `imageQuality` | `reading` | 设置 → 阅读设置的画质选择，使用插件的设置键、选项和 `onChanged` |
| `imageQuality` | `reader` | 阅读器 → 阅读设置中的画质选择，使用同一插件设置 |
| `resetDeviceInfo` | `advanced` | 设置 → 高级设置原有的设备重置位置，必须通过 `action` 指向插件 `actions[action]()` |

设备重置支持 `title`、`subtitle`、`successMessage`，均可使用语言映射。导入时校验按钮位置及回调，拒绝相同按钮在相同位置重复声明。签到受登录状态和自动签到设置约束；`imageQuality` 需同时声明 `imageQualitySetting/imageQualityOptions/imageQualityDefault`。漫画 ID 识别与每日推荐使用独立能力声明，不能注册为按钮。

```javascript
presentation: {
  buttons: [
    {id: 'resetDeviceInfo', location: 'advanced', action: 'clearDeviceInfo',
     title: {zh: '清除设备信息', en: 'Clear device info'}}
  ]
},
actions: {clearDeviceInfo: async () => { /* 插件自己的设备清理逻辑 */ }}
```

`settings` 声明输入框、选择框和开关，字段见类型文件。设置页由应用渲染；插件不能创建 Flutter 控件。`presentation.actions` 提供 `{id,title,location?}` 列表，对应 `actions[id]()`；返回的文本由应用展示。设置改变时可提供 `settings[key].onChanged`。

操作的 `location` 可选值：

| 值 | 显示位置 |
| --- | --- |
| `plugin`（默认） | 设置 → 实验室 → 漫画源插件 → 该插件的设置 |
| `reading` | 设置 → 阅读设置 |
| `other` | 设置 → 其他设置 |
| `lab` | 设置 → 实验室 |
| `advanced` | 设置 → 高级设置 |
| `lines` | 首页侧边栏 → 线路 |

跨页面操作需在注册时声明，显示所属插件名称，按安装和声明顺序排列在页面原有内容下方。入口来自所有已启用插件，禁用或卸载后移除；展示时无需初始化，点击时初始化所属插件并执行操作，不切换当前源。未知位置在安装时被拒绝。

`settings[key].location` 仅支持 `plugin`（默认）和 `lines`，配置只在指定位置显示。线路页仅展示当前源的配置，复用设置保存与 `onChanged` 回调。

```javascript
Hazuki.registerSource({
  // 其他必需字段与方法略。
  presentation: {
    actions: [
      {id: 'refreshLines', title: '刷新线路', location: 'lines'},
      {id: 'checkConnection', title: '检查连接'} // 默认在该插件的设置页。
    ]
  },
  settings: {
    customHost: {
      title: '自定义域名', type: 'input', default: '', location: 'lines',
      onChanged: async value => { /* 应用新的配置。 */ }
    }
  },
  actions: {
    refreshLines: async () => { /* 刷新线路。 */ return '线路已刷新'; },
    checkConnection: async () => { /* 检查连接。 */ return '连接正常'; }
  }
});
```

在注册对象的可选 `presentation` 中声明排序标签与默认值、是否需要登录、签到、评论回复、详情字段、画质选项和操作入口。导入时保存这些信息供应用使用，运行时也可补充。搜索排序通过 `searchOrders/searchDefaultOrder` 声明，标签支持字符串或 `{zh, en}` 语言映射；收藏排序通过 `favoriteOrders/favoriteDefaultOrder/favoriteOrderSetting` 声明；画质通过 `imageQualitySetting/imageQualityOptions/imageQualityDefault` 声明。`recreateOnStatus` 是通用的运行时重建状态列表，网站选择哪些状态放进列表。

## 标签、排序与历史展示

以下均为可选的 `presentation` 字段：

- `listTagGroups: string[]`：从详情 `tags` 中提取哪些分组作为列表、收藏和历史标签；分组名忽略大小写和首尾空格，标签去重。未声明时不从详情提取列表标签，已有记录标签仍保留。
- `enrichMissingTags: boolean`：为缺少标签的列表条目调用所属插件的 `comic.loadInfo`；默认不补查。收藏和历史补查最多四个并发，切源或停用后忽略过期结果，失败不阻断列表。
- `favoriteOrderAliases: Record<string,string>`：将旧收藏排序值映射到当前 `favoriteOrders` 中的值。已支持的值优先，否则尝试别名、插件默认值、首个选项；没有选项时返回空值。
- `favoriteOrderLabels: Record<string, string | Record<string,string>>`：为 `favoriteOrders` 中的云收藏排序值声明标签，支持字符串或 `{zh, en}` 语言映射。未声明的旧编码保留兼容文案，其他值直接显示编码。例如 `favoriteOrders: ['recent'], favoriteOrderLabels: {recent: {zh: '最近收藏', en: 'Recently saved'}}`。
- 本地收藏排序由宿主独立管理，固定支持 `savedNewest`（收藏时间倒序）、`savedOldest`（收藏时间正序）、`updatedNewest`（更新时间倒序），与当前插件的云收藏排序无关，偏好保存通用策略值。
- `localFavoriteOrders`：兼容旧偏好，将历史插件排序值映射到上述通用策略；仅在迁移旧偏好时使用，迁移后切换漫画源不会改变本地排序。
- 搜索排序的选中值和实际请求统一校验 `searchOrders`，无效值回退到有效的 `searchDefaultOrder` 或首个选项；未声明选项时使用空值，并隐藏排序入口。
- 分类筛选按插件声明的选项分组顺序传递，`-全部` 表示值为空字符串、标签为“全部”。空值会保留位置；没有可用选项或选项加载失败时传空数组，由插件选择默认值，宿主不注入站点排序编码。
- 已安装插件的运行时 `presentation` 按字段覆盖安装时声明，未覆盖的字段保留；搜索、聚合搜索、收藏和页面文案使用相同的合并结果。停用或卸载后，运行时声明不再生效。
- 详情信息栏使用 `comic.loadInfo().infoFields`，不使用固定栏目开关。


宿主缓存最后一次安装成功的展示规则：`showComicId`、`showTags`、`showComicStatus`、`listTagGroups`。停用或卸载后，历史记录仍使用缓存展示，但不启用按钮、登录或联网补查。重新安装使用新声明，更新失败保留旧插件及缓存；无缓存的源使用通用展示，不改写原始记录。

## 漫画 ID 与每日推荐能力

通过 `presentation` 分别声明两项可选能力：

```js
presentation: {
  directComicIdRules: {
    patterns: ['^(?:jm)?(\\d{2,})$'],
    extractDigits: true,
  },
  dailyRecommendation: { searchOrder: 'mr' },
}
```

- `directComicIdRules.patterns` 是非空字符串数组。每条规则必须是有效的 Dart/ECMAScript 正则并至少包含一个捕获组；导入和更新时校验，失败保留旧插件。宿主忽略大小写、去除输入首尾空白并要求完整匹配，按声明顺序取首个非空的第一捕获组作为漫画 ID。
- `directComicIdRules.extractDigits` 必须是布尔值。为 `true` 且用户开启漫画 ID 搜索增强时，现有输入提示会从混合文本中提取至少三位数字；纯数字输入不显示提取提示。为 `false` 时不启用提取，仍可直接匹配 ID。
- 单源搜索只使用当前插件的规则；聚合搜索使用参与搜索的可用插件。仅一个插件匹配时直达详情，没有匹配或多个插件匹配时执行普通关键词搜索；详情加载失败也回退普通搜索。切源或新搜索后丢弃旧请求结果。
- 每日推荐支持两种独立模式。`{mode: 'authors', searchOrder: 'mr'}` 保留作者推荐；省略 `mode` 的旧 `{searchOrder: 'mr'}` 声明仍按作者模式处理。`searchOrder` 必须是插件支持的非空排序值。作者模式保留原有抽样目标，但不足 7 本也可展示。
- `{mode: 'plugin'}` 接入网站自己的每日推荐、编辑精选、排行榜或漫画轮播，必须实现根对象的 `dailyRecommendation.load()`。此模式不填写 `searchOrder`，不读取宿主作者名单、不调用作者搜索或补查作者，也不会在失败时退回作者模式。
- 推荐能力独立于漫画 ID 识别。缺少配置时不生成或展示缓存推荐；切源、关闭功能或切换推荐模式后，未完成请求的过期结果会被丢弃。

### 网站推荐与轮播接口

```javascript
Hazuki.registerSource({
  // 其他身份、search、comic 等必需字段略。
  presentation: {dailyRecommendation: {mode: 'plugin'}},
  dailyRecommendation: {
    load: async () => {
      // 插件自行请求和解析网站的推荐/轮播接口。
      return [
        {id: 'comic-a', title: '网站推荐漫画', cover: 'https://example.com/cover-a.jpg',
         imageUrl: 'https://example.com/banner-a.jpg', caption: '每日精选'},
        {id: 'comic-b', title: '另一部漫画', cover: 'https://example.com/cover-b.jpg'}
      ];
    }
  }
});
```

返回值是漫画条目数组，沿用漫画摘要的 `id`、`title`、`cover`，并可选填 `imageUrl` 和 `caption`。`imageUrl` 用于轮播宣传图，省略时使用漫画封面；宿主不会拿宣传图覆盖原封面，点击仍打开该插件下对应漫画的详情。`caption` 是可选短文案，可写作者、推荐理由或网站栏目名称，不填也可正常展示。

**插件直供不限制为 7 本：返回多少条就按原顺序显示多少条，不补齐、不随机打乱、不截取前 7 条。** 返回空数组表示当前没有推荐，会隐藏轮播；网络或解析失败应抛出错误，宿主保留本次运行中已显示的有效内容；刚启动时获取失败则不显示旧推荐。每项必须有非空 `id`、`title`，以及至少一张 `cover` 或 `imageUrl`。条目归属由宿主绑定当前插件，插件传入的其他源 ID 不生效；只接入可映射到漫画详情的轮播项目。

插件直供推荐仅保存在本次运行的内存中，下次启动重新获取，不读取上次启动的推荐；旧版保存的直供推荐缓存会被清除，作者模式保留原有持久化缓存。拿到条目后立即显示卡片，图片下载和解码期间持续显示占位图，直到首帧可以显示后才播放现有淡入与缩放动画，动画期间也保留底下的占位图；从图片缓存命中时也播放出现动画。推荐数据的清除不影响通用图片缓存。继续使用现有卡片样式、切换动画和开关。支持任意条数、无作者文案及独立宣传图；多条指示器超出宽度时可以横向滚动。设置入口为“设置 → 其他设置 → 发现页每日推荐”，需先切换到已声明能力的漫画源。新增声明后，应更新或重新导入插件。

现有插件：禁漫保留作者模式；拷贝、哔咔、热辣不接入每日推荐。直供接口由插件作者自行选择接入，示例脚本展示声明与返回格式，宿主不判断源 ID。

旧 `directComicId: true` 不再启用上述能力；缺少新声明的插件仍可普通搜索和阅读。新增声明需更新或重新导入 JS。

## 生命周期与升级

插件管理入口位于“设置 → 实验室 → 漫画源插件”。启用开关控制插件是否可用，首页的漫画源切换入口用于选择当前使用的插件。

本地与在线安装共用校验：在独立目录检查脚本身份与核心方法，成功后提交注册表，失败保留原脚本和记录。初始化失败报告运行错误并保留安装。不同来源的同 ID 插件需先卸载再导入；手动更新会提示覆盖本地编辑，并保留旧脚本备份。修改仓库源码不会自动更新已安装插件。

启停和卸载更新可用源列表。当前源被移除后选择首个启用源；没有可用源时进入无源状态。卸载保留账号、设置、收藏、进度、历史和下载内容；重新安装相同 ID 后恢复关联。缺失插件时可查看本地记录和离线下载，联网请求需要重新安装插件。

旧版升级时，原 JS 复制到插件存储目录的 `legacy_backup`，不覆盖原文件，也不自动执行或转换。沿用原 ID 可保持数据关联。插件来源及许可见脚本头部和 `dev/upstream/<插件 ID>/UPSTREAM.md`，发布时须遵守上游许可。

## 验证

在本仓库根目录运行：

```powershell
npm --prefix dev ci
npm --prefix dev run check
npm --prefix dev run format:check
npm --prefix dev test
```

类型检查使用 `hazuki-source.d.ts`；Node 测试使用离线样本和模拟宿主，无需真实账号。通过测试不代表当前网站可用或账号流程已实测。宿主 QuickJS 回归、快照更新及来源说明见 [开发文档](README.md)。
