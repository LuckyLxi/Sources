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

源码维护在 [LuckyLxi/Sources](https://github.com/LuckyLxi/Sources)。类型声明、示例、测试和开发说明位于本仓库的 `dev/`。

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
dart run tool/build_source_plugin.dart ../HazukiSources/dev/example.js
```

命令从 Hazuki 主仓库运行，假定本仓库检出在同级 `HazukiSources` 目录。工具复制源码到 `build/source_plugins/<输入文件名>`，第二个参数可指定输出位置；本地导入可直接使用源码。本仓库的索引由工作流自动生成，使用方法见 [开发文档](README.md#自动更新索引)。类型声明见 [hazuki-source.d.ts](hazuki-source.d.ts)，最小示例见 [example.js](example.js)。

## 注册和数据接口

入口调用一次 `Hazuki.registerSource({...})`，或声明继承 `HazukiSource`、`ComicSource` 的类，由宿主实例化并注册。插件身份注册后锁定。联网和数据读写的初始化放在 `init()` 中，首次使用时执行；导入仅校验身份与接口，不执行 `init()` 或访问用户数据。必须提供：

- `search.load(keyword, options, page)`：页码从 1 开始，返回 `{comics, maxPage}`。
- `comic.loadInfo(id)`：返回详情，`chapters` 是章节 ID 到标题的映射；`tags` 是命名空间到标签数组的映射。
- `comic.loadEp(comicId, chapterId)`：返回 `{images: [url, ...]}`。

漫画摘要使用 `{id, title, cover, subTitle?, tags?}`。应用负责附加当前插件 ID，插件不应返回其他源的身份。可选能力的方法缺失时不提供对应操作。

可选 `explore` 支持分区首页、单页多分区及分页漫画列表；`category`、`favorites`、`comic` 的评论与点赞接口使用类型声明中的统一结构。`account.login` 返回标准化的 `{token?, displayName?, avatarUrl?}`，头像必须由插件转换成可用完整 URL；应用保存用户输入的账号供重新登录使用。`account.loadProfile` 用相同字段更新资料。

`account.checkIn` 返回 `{status: "success" | "alreadyCheckedIn" | "skipped", message?}`。账号能力和这些操作都作用于该插件，不能读取其他插件的凭据。

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

提供可调用的 `comic.likeComic(id, isLike)` 时，宿主自动在详情标题下方显示点赞按钮，并在详情加载后重新检查能力。无需按钮声明；旧 `comicLike` 位置声明和 `showComicLike` 开关不再生效。

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
- `localFavoriteOrders`：把插件的排序值映射到 `savedNewest`、`savedOldest` 或 `updatedNewest`，分别按收藏时间倒序、收藏时间正序、更新时间倒序排列本地收藏。缺少映射时按收藏时间倒序；保存偏好时保留插件原始值。
- `showUploader`、`showCategories`、`showChineseTeam`：布尔值，分别控制详情上传者、分类和汉化组行，仅在对应数据非空时显示。
- `detailTagGroups: string[]`：详情“标签”行使用的分组，忽略分组名大小写和首尾空白；与列表／历史用的 `listTagGroups` 分开。允许空数组，用于隐藏标签行。声明后不再从其他分组混合提取详情标签。

兼容旧插件时，`showUploader: true` 为未显式声明的字段提供默认值：`showCategories: true`、`showChineseTeam: true`、`detailTagGroups: ['tag', 'tags', '标签']`。显式值优先，包括 `false` 和空数组。未声明 `detailTagGroups` 且无旧声明兼容时，使用通用标签筛选。

宿主缓存最后一次安装成功的展示规则：`showComicId`、`showUploader`、`showCategories`、`showChineseTeam`、`showPageCount`、`showTags`、`showComicStatus`、`listTagGroups`、`detailTagGroups`。停用或卸载后，历史记录仍使用缓存展示，但不启用按钮、登录或联网补查。重新安装使用新声明，更新失败保留旧插件及缓存；无缓存的源使用通用展示，不改写原始记录。

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
- `dailyRecommendation.searchOrder` 必须是非空字符串，应填写插件支持的搜索排序值。该配置独立启用每日推荐，不能由 ID 能力推导；宿主保留现有作者资源和推荐算法，使用声明的排序。缺少配置时不生成或展示缓存推荐，切源后丢弃过期结果。

旧 `directComicId: true` 不再启用上述能力；缺少新声明的插件仍可普通搜索和阅读。新增声明需更新或重新导入 JS。

## 生命周期与升级

插件管理入口位于“设置 → 实验室 → 漫画源插件”。启用开关控制插件是否可用，首页的漫画源切换入口用于选择当前使用的插件。

本地与在线安装共用校验：在独立目录检查脚本身份与核心方法，成功后提交注册表，失败保留原脚本和记录。初始化失败报告运行错误并保留安装。不同来源的同 ID 插件需先卸载再导入；手动更新会提示覆盖本地编辑，并保留旧脚本备份。修改仓库源码不会自动更新已安装插件。

启停和卸载更新可用源列表。当前源被移除后选择首个启用源；没有可用源时进入无源状态。卸载保留账号、设置、收藏、进度、历史和下载内容；重新安装相同 ID 后恢复关联。缺失插件时可查看本地记录和离线下载，联网请求需要重新安装插件。

旧版升级时，原 JS 复制到插件存储目录的 `legacy_backup`，不覆盖原文件，也不自动执行或转换。沿用原 ID 可保持数据关联。插件来源及许可见脚本头部和 `upstream/<插件 ID>/UPSTREAM.md`，发布时须遵守上游许可。

## 验证

在本仓库根目录运行：

```powershell
npm --prefix dev ci
npm --prefix dev run check
npm --prefix dev run format:check
npm --prefix dev test
```

类型检查使用 `hazuki-source.d.ts`；Node 测试使用离线样本和模拟宿主，无需真实账号。通过测试不代表当前网站可用或账号流程已实测。宿主 QuickJS 回归、快照更新及来源说明见 [开发文档](README.md)。
