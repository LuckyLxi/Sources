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

应用使用内置索引 `https://raw.githubusercontent.com/LuckyLxi/Sources/main/plugins.json`，支持在线安装和本地 JS 导入，不提供添加或移除仓库入口，也不随安装包附带源脚本；用户选择安装后才下载 JS。每次启动下载一次索引，保存为插件存储目录中的 `plugins.json`，与市场安装插件的 ID、版本比较，仅在发现较新版本时提示用户选择更新；停用的市场插件也参与检查。本地导入插件不参与在线更新检查，也不显示在线重新下载入口；同 ID 的市场插件不会覆盖本地导入插件，改变来源需先卸载。

安装记录统一保存在插件存储目录的 `installed_plugins.json` 中，`plugins` 列表记录各插件的 `id`、`version` 及恢复安装状态所需的元数据。安装、更新、卸载使用临时文件写入后原子替换；失败保留已提交记录。旧版 `registry-*.json` 在首次加载时迁移，并保留原文件。进入或切换插件列表只读取共享索引，点击“刷新列表”重新下载；网络失败保留已安装记录和缓存，可切换线路后手动重试。

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

原有四个插件的位置声明示例：

- 禁漫天堂：个人资料签到、其他设置自动签到、详情 ID 复制、相关推荐；刷新线路通过 `presentation.actions` 放在线路页。提供 `comic.likeComic`，并用 `headerStats` 声明手机点赞项。
- 拷贝漫画：高级设置设备重置、阅读设置及阅读器画质选择；插件自身设置页也保留设备重置操作，显式填写 `location: 'plugin'`。
- 哔咔漫画：个人资料签到、其他设置自动签到、阅读设置及阅读器画质选择。提供 `comic.likeComic`，并用 `headerStats` 声明手机点赞项。
- 热辣漫画：阅读设置及阅读器画质选择；自定义域名和画质配置位于插件设置页。

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

跨页面操作需在注册时声明，显示所属插件名称，按安装和声明顺序排列在页面原有内容下方。入口来自所有已启用插件，禁用或卸载后移除；展示时无需初始化，点击时初始化所属插件并执行操作，不切换当前源。不支持设置首页、关于、隐私、存储/缓存、云同步或显示页面；未知位置在安装时被拒绝。

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

宿主按能力声明处理展示与网络规则，不按源 ID 分支。以下均为可选的 `presentation` 字段：

- `listTagGroups: string[]`：从详情 `tags` 中提取哪些分组作为列表、收藏和历史标签；分组名忽略大小写和首尾空格，标签去重。未声明时不从详情提取列表标签，已有记录标签仍保留。
- `enrichMissingTags: boolean`：为缺少标签的列表条目调用所属插件的 `comic.loadInfo`；默认不补查。收藏和历史补查最多四个并发，切源或停用后忽略过期结果，失败不阻断列表。
- `favoriteOrderAliases: Record<string,string>`：将旧收藏排序值映射到当前 `favoriteOrders` 中的值。已支持的值优先，否则尝试别名、插件默认值、首个选项；没有选项时返回空值。
- `favoriteOrderLabels: Record<string, string | Record<string,string>>`：为 `favoriteOrders` 中的云收藏排序值声明标签，支持字符串或 `{zh, en}` 语言映射。未声明的旧编码保留兼容文案，其他值直接显示编码。例如 `favoriteOrders: ['recent'], favoriteOrderLabels: {recent: {zh: '最近收藏', en: 'Recently saved'}}`。
- 本地收藏排序由宿主独立管理，固定支持 `savedNewest`（收藏时间倒序）、`savedOldest`（收藏时间正序）、`updatedNewest`（更新时间倒序），与当前插件的云收藏排序无关，偏好保存通用策略值。
- `localFavoriteOrders`：兼容旧偏好，将历史插件排序值映射到上述通用策略；仅在迁移旧偏好时使用，迁移后切换漫画源不会改变本地排序。
- 搜索排序的选中值和实际请求统一校验 `searchOrders`，无效值回退到有效的 `searchDefaultOrder` 或首个选项；未声明选项时使用空值，并隐藏排序入口。
- 分类筛选按插件声明的选项分组顺序传递，`-全部` 表示值为空字符串、标签为“全部”。空值会保留位置；没有可用选项或选项加载失败时传空数组，由插件选择默认值，宿主不注入站点排序编码。
- 已安装插件的运行时 `presentation` 按字段覆盖安装时声明，未覆盖的字段保留；搜索、聚合搜索、收藏和页面文案使用相同的合并结果。停用或卸载后，运行时声明不再生效。
- 详情信息栏使用 `comic.loadInfo().infoFields`，不使用旧 `showUploader`、`showCategories`、`showChineseTeam` 或 `detailTagGroups`。

哔咔声明标签和分类分组并启用补查；禁漫只声明详情的 `Tag` 分组用于保存记录，列表展示保持原样。站点协议适配由插件负责，例如禁漫图片还原、域名与 HTTPS 端口修正，以及拷贝设备信息和限流恢复；宿主 HTTP 层不判断漫画源或域名。

宿主缓存最后一次安装成功的展示规则：`showComicId`、`showTags`、`showComicStatus`、`listTagGroups`。停用或卸载后，历史记录仍使用缓存展示，但不启用按钮、登录或联网补查。重新安装使用新声明，更新失败保留旧插件及缓存；旧注册表从现有安装清单初始化缓存，无缓存的源使用通用展示，不改写原始记录。

旧记录缺少源标识时的禁漫归属、下载 ID、旧 `jm.js` 文件和编辑状态兼容仍保留。

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

本地与在线安装共用校验：在独立目录检查脚本身份与核心方法，成功后提交注册表，失败保留原脚本和记录。初始化失败报告运行错误并保留安装。不同来源的同 ID 插件需先卸载再导入；手动更新会提示覆盖本地编辑。修改仓库源码不会自动更新已安装插件，在线更新与本地编辑备份的关系见下节。

启停和卸载更新可用源列表。当前源被移除后选择首个启用源；没有可用源时进入无源状态。卸载保留账号、设置、收藏、进度、历史和下载内容；重新安装相同 ID 后恢复关联。缺失插件时可查看本地记录和离线下载，联网请求需要重新安装插件。

旧版升级时，原 JS 复制到插件存储目录的 `legacy_backup`，不覆盖原文件，也不自动执行或转换。沿用原 ID 可保持数据关联。插件来源及许可见脚本头部和 `dev/upstream/<插件 ID>/UPSTREAM.md`；热辣为原创插件，来源说明保留在脚本头部及宿主快照中，发布时须遵守相应许可。

### 本地编辑备份与恢复

在应用内编辑并保存插件源码时，只保留上一次保存前的备份：A 保存为 B 时备份 A，B 保存为 C 时以 B 覆盖备份。备份和当前源码的引用随安装记录原子提交；保存失败时保留原源码和原备份，不影响正在运行的引擎。备份同时保留对应版本的元数据和编辑状态，重启后仍可恢复。

高级设置的“恢复本地备份”适用于市场插件和本地导入插件，仅在有可用备份时显示。恢复成功后清除备份，恢复失败则保留；恢复到上一版已编辑源码时仍标记为本地已编辑，重启应用后生效。

“重新下载插件”只对市场安装的插件显示，每次重新读取其仓库的 `plugins.json`，使用对应的 `downloadUrl` 下载并校验，即使版本相同也可以重新下载。在线重新下载或更新不创建或覆盖编辑备份。

## 验证

在本仓库根目录运行：

```powershell
npm --prefix dev ci
npm --prefix dev run check
npm --prefix dev run format:check
npm --prefix dev test
```

类型检查使用 `hazuki-source.d.ts`；Node 测试使用离线样本和模拟宿主，无需真实账号。通过测试不代表当前网站可用或账号流程已实测。宿主 QuickJS 回归、快照更新及来源说明见 [开发文档](README.md#宿主回归与许可)，平台授权的实测范围与待验收项目见 [授权验证记录](plugin_authorization_verification.md)。

## 登录交互、章节分组和阅读进度

这些是 API v1 的可选扩展，需要包含这些能力的新版宿主。旧插件的账号密码登录、`chapters` 和阅读接口继续有效；插件不能自行创建 Flutter 控件。

### 多步登录

在 `account.loginMethods` 声明有序登录入口，每项为 `{id, title, input}`。`title` 支持语言映射；`input` 为 `credentials`（账号密码）、`account`（仅账号，例如手机号）或 `none`。未声明时使用原账号密码表单和旧运行时；声明必须为非空数组且 ID 唯一。

宿主调用 `account.login(account, password, context)`，`context.method` 是所选 ID。非密码方式的 password 为空字符串，初始账号为空仅限 `none`。通过 `context.requestText({title, message?, initialValue?, obscure?, keyboardType?})` 等待非空字符串；数字键盘用 `keyboardType: 'number'`。用户输入不自动裁剪。

通过 `context.requestClickCaptcha({title, message?, image, hintImage?, pointCount?})` 展示点选验证码。图片为 Uint8Array、字节数组或 Base64 图片 Data URL，由插件自行获取；界面不请求网站图片 URL。结果为 `{status:'submitted', points:[{x,y}, ...]}` 或 `{status:'refresh'}`。坐标按点击顺序返回，是从原图左上角开始的整数像素，图片缩放与留白由宿主换算。`pointCount` 应为 1–32 的整数；省略时允许 1–32 个点。支持撤销最后一点。

刷新后由插件请求新图并再次等待交互，新图不继承旧点；网站校验失败时继续循环，无需再次收集账号。取消会中止整个登录，插件不应捕获取消后继续尝试登录。

声明登录方式的登录在独立运行时执行，init、HTTP Cookie、私有 storage/settings 与 Secrets 写入均暂存。返回成功资料或正常完成后才提交；异常、取消、切源、停用和卸载丢弃本次写入，迟到的交互结果不会提交。成功后重建正常运行时，插件必须通过持久存储保留会话，不能只保存在临时 JS 变量里。每个插件同时只允许一个登录尝试。提交失败会尝试回滚，回滚自身失败会明确报告。

后台自动重登不会展示交互；这类账号需要用户重新打开登录入口。短信、验证码请求和网站业务校验始终由插件负责。无初始输入的成功登录使用独立会话标记，不要求保存密码；旧账号记录继续兼容。

### 浏览器授权（Android / Windows）

在隔离的前台登录中调用 `context.requestBrowserAuthorization({title?, url, callbacks?, completion?, cookieScopes?, timeoutMs?})`。`url` 必须为不含用户名密码的 HTTPS URL；默认 `completion: "callback"` 时，`callbacks` 为非空数组，每项是 `{origin, path, requiredQueryKeys?}`。宿主对完整 origin（含端口）、精确路径以及必要的非空查询字段进行匹配，不支持域名或路径前缀通配。只接受本次主窗口及受控弹窗的顶层导航，iframe 不会完成授权。

匹配时阻止继续加载回调地址，关闭全部授权窗口，返回 `{status:'completed', url}`；插件从 URL 提取凭据，校验网站账号及网站支持的 state，再保存会话并正常返回。宿主不解析网站字段，不把浏览器 Cookie 自动复制到 `Hazuki.cookies`。完整回调仅供插件在内存中处理，禁止记录 URL、令牌、Cookie 或认证头。

默认 5 分钟超时，可设置整数 30000～600000 毫秒，超时返回 `{status:'timeout'}`；关闭、返回、切源、停用或卸载会取消整个登录尝试。完成后仍需通过现有暂存事务提交；验证失败、取消和提交失败不能留下新登录态。网络或浏览器失败以脱敏错误码结束，不提供含 URL 的原生错误内容。

Windows 每次授权使用独立 WebView2 环境及目录；缺少运行时时提供安装入口。Android 每次使用独立 WebView Profile；系统 WebView 不支持 MULTI_PROFILE 时提示更新组件，原有账号密码功能照常使用。会话不复用，退出时清理，进程终止留下的数据在下次启动清理。外部浏览器及其它插件的 Cookie 不共享；外部 App 授权使用独立的 requestExternalAuthorization；Cookie 登录须显式声明 cookieScopes。插件没有任意网页脚本执行接口。

通用示例见 [browser-authorization.js](examples/browser-authorization.js)。平台真实授权结果应分别验证，不能把普通桌面浏览器的成功视为 Android 或内嵌浏览器已通过；已有实测与限制见 [授权验证记录](plugin_authorization_verification.md)。

### 章节分组

`comic.loadInfo` 可返回 `chapterGroups: [{id, title, chapters:[{id,title}, ...]}, ...]`，也适用于 `new ComicDetails({...})`。有非空分组时它优先于旧 `chapters`；仅用分组时可以省略旧字段。分组和组内章节均按数组顺序使用，章节 ID 必须在整部漫画内唯一；非法结构、重复组 ID 或重复章节 ID 会报错。普通对象的数字键顺序无法用于表达任意阅读顺序，旧插件应使用 Map。

详情和阅读器章节面板支持选组；阅读器默认当前章节所属组，上一章和下一章不跨组。下载全选作用于当前组，切组保留已选项，确认按整部漫画的源顺序提交。章节 ID 不添加组前缀；组内位置不能代替全局位置。新增下载元数据保存组信息，磁盘目录编号与阅读顺序分开管理；旧目录不因切组而改名，旧下载仍可读取。旧下载中缺失的分组不会从标题猜测恢复。

### 实际阅读进度通知

可选 `comic.onReadingProgress(progress)` 接收 `{comicId, chapterId, page, totalPages, visiblePages, reason}`。page 从 1 开始，totalPages 是原始图片总数；双页模式 page 取阅读顺序中的首张可见图片，visiblePages 是可见图片页码数组。条漫报告视口中实际可见图片的位置；导航目标、预加载和后台下载不触发通知。

首次有效显示上报一次，随后每 5 秒最多一次并合并到最新位置；切章、退出和进入后台补交最后位置。reason 分别为 `initial`、`page`、`chapter`、`exit`、`background`。同插件串行调用，切章补交先于新章初始位置。仅在线阅读、已登录且声明回调时调用；离线阅读和未登录不会调用。失败不阻塞阅读，不自动登录，也不建立持久重试队列。

插件自行将宿主页码转换为网站格式并发送请求。网站进度读取为独立可选能力，规则见下文；仅声明上报时仍沿用本地进度。示例见 Sources 仓库 `docs/examples/host-capabilities.js`。真实网站及账号成功流程仍需独立验证。

### 网站阅读位置与历史

可选 `comic.loadReadingProgress(comicId)` 返回 `{chapterId, page, totalPages?, updatedAtMs?}` 或 `null`；页码从 1 开始，按原始图片计数。声明后，在线阅读始终以网站为准，停止写入在线本地位置；仅声明上报不改变旧行为。离线下载继续保存、恢复本地位置。网站位置不写入 ReadingProgressEntries，也不进入 WebDAV 本地进度合并。

`comic.loadReadingHistory(page)` 返回 `{items:[{comic, progress}], maxPage?}`，必须同时声明读取位置接口。分页从 1 开始，没有 maxPage 时空页终止。登录后后台导入，打开历史时刷新全量记录，与浏览记录按插件和漫画 ID 去重展示。缓存使用独立、按当前账号会话隔离的内存存储；换号、退出、切源或停用时清空，旧请求不能更新新会话。缓存仅用于历史展示，不用作恢复位置的备选。读取接口运行在独立的账号读取运行时，存储与 Cookie 写入不提交正常运行时；插件应只读取网站数据。换号时关闭该运行时的 HTTP 客户端。

打开漫画及点击继续阅读均重新读取网站。未登录、读取失败或网站没有记录时，不恢复旧本地位置或缓存位置；可重新登录或重试，也可从所选章节第一页阅读。继续阅读按章节 ID 找到漫画范围的位置，再恢复原始图片页；显式点选章节从第一页开始。章节不存在时提示手动选择。图片和设置准备后只恢复一次，页码按实际图片数修正；双页定位到包含目标图片的阅读页，条漫定位目标图片。用户操作后不再自动恢复，恢复期间不会上报初始第一页。

### 外部应用授权

仅前台隔离登录可调用 `context.requestExternalAuthorization({title?, createUrl, allowedSchemes, androidPackage?, timeoutMs?})`。宿主先分配随机回调，SDK 在插件内调用 `await createUrl(callbackUrl)` 构造或向网站获取授权 URL，再通过平台 URI API 拉起；函数不会跨 JS 桥。仅允许本次声明的协议，拒绝文件、脚本、命令及 Android intent URL。Android 可指定包名，未安装时返回脱敏错误。返回 completed/timeout 与浏览器接口一致，默认 5 分钟，可配置 30 秒至 10 分钟；取消会结束整个登录事务。

回调协议区分正式、调试及 profile，随机路径绑定当前进程、插件和登录尝试。Android 消费冷启动/onNewIntent 地址后清除 Intent 数据；无待处理会话时丢弃。Windows 安装器注册 HKCU 协议，便携/调试版本首次使用注册安装位置专属协议。回调进程在 Flutter 启动前把结果发送给当前用户专属命名管道后退出；普通启动仍可多窗口。卸载只移除命令仍属于当前安装的协议项。重复、过期、错误路径及取消后的回调不能完成登录。

插件须自行验证授权码、令牌、账号和 provider state。宿主没有微信/QQ 专用 SDK；网站拒绝宿主回调或要求特定 AppID、签名、SDK 时，须另行验证兼容性。地址和结果仅在内存中传递，不写应用日志、命令诊断或重试队列。

### 浏览器 Cookie 登录

`completion: "manual"` 可省略 callbacks，显示“完成登录”。只有显式声明 `cookieScopes:[{url:"https://…",names:["session"]}]` 才读取本次隔离浏览器中匹配 URL 和精确名称的 Cookie。所需名称缺失时保持窗口打开，提示继续登录；完成后先导入当前登录事务的暂存 Cookie 层，再交由插件使用 Hazuki.http 校验账号。校验失败、取消或提交失败全部回滚。没有 cookieScopes 的旧回调模式不导入浏览器 Cookie；manual 返回的 url 为初始 HTTPS 地址，不代表网站已验证。

Cookie 属性包括 `domain/path/expiresAt`（毫秒）、`secure/httpOnly/sameSite/hostOnly`。旧记录与旧 set 调用仍可读取；省略 hostOnly 时，无点前缀的域名按主机 Cookie，点前缀按域 Cookie 解释。HTTPS、域名和路径边界必须匹配，同名不同路径优先发送长路径且保留各项。Windows 读取本次 WebView2 环境；Android 需同时支持 MULTI_PROFILE 和 GET_COOKIE_INFO，使用 Profile 的 CookieManagerCompat 获取属性，不使用网页 JS 降级。系统浏览器及其它插件的 Cookie 不参与导入。

通用示例见 [cloud-and-authorization.js](examples/cloud-and-authorization.js)。平台集成与真实网站结果见 [授权验证记录](plugin_authorization_verification.md)；示例不是任何生产网站的已验证实现。
