# Hazuki Sources 开发资料

本目录存放类型声明、测试、示例和开发依赖。

## 仓库结构

公开的插件文件位于根目录：

| 文件 | 插件 |
| --- | --- |
| `../jm.js` | JMComic |
| `../copy_manga.js` | CopyManga |
| `../picacg.js` | Picacg |
| `../relamanhua.js` | 热辣漫画 |

根目录 `plugins.json` 是安装索引，格式示例见 [API 规范](API.md)。
插件可直接本地导入，无需安装开发依赖或打包。

开发参考：[API 规范](API.md)、[类型声明](hazuki-source.d.ts)、[最小示例](example.js)。

## 开发与检查

使用 Node.js 22 或更新的受支持版本，在本目录运行：

```powershell
npm ci
npm run check
npm run format:check
npm test
```

也可从仓库根目录运行 `npm --prefix dev run check` 等命令。

Node 测试使用离线样本和模拟宿主，不依赖 Flutter、Hazuki 源码或真实账号。
热辣样本位于 `test/fixtures/relamanhua/`，图片解密结果由 `node:crypto`
独立验证。登录、收藏与评论流程仅验证请求和模拟响应，未使用真实账号实测；
通过测试不代表当前网站可用。

## 自动更新索引

根目录 `.github/workflows/update-plugin-index.yml` 在 `main` 分支新增、修改或删除
根目录 JS 后，由 `github-actions[bot]` 自动更新并提交 `plugins.json`，也支持手动运行。
发布修改时只需更新插件的 `version`；删除 JS 后，对应索引条目自动移除。

生成器静态读取 `Hazuki.registerSource({...})`、顶层 `const` 对象或源类的元数据，
不执行插件。ID、名称和版本须使用字符串字面量或顶层 `const` 字符串；缺少名称或版本时
采用 API 默认值。重复 ID、无效元数据或语法错误会终止生成，保留原索引。
根目录仅放发布插件，开发脚本放在 `dev/`。

下载链接按实际文件名生成，使用当前仓库的 `main` 分支 jsDelivr 地址。本地默认仓库为
`LuckyLxi/Sources`；Fork 可通过 `GITHUB_REPOSITORY` 环境变量指定仓库。手动生成或检查：

```powershell
npm --prefix dev run index:update
npm --prefix dev run index:check
```

工作流使用内置 `GITHUB_TOKEN`，需要允许 Actions 写入仓库；若 `main` 的保护规则禁止
bot 直接推送，自动提交会失败，需要调整仓库规则。

本目录的 `.github/` 仍为开发检查模板；启用时需放入仓库根目录的 `.github/workflows/`。

## 宿主回归快照

Hazuki 主仓库的 `test/fixtures/source_plugins/` 使用实际 QuickJS 和宿主接口验证兼容性。
更新时，将根目录 `<插件 ID>.js` 复制到对应的 `<插件 ID>/main.js`，
保留原快照的类型引用注释、上游来源说明及离线样本，再按该目录 README 运行 Flutter 测试。
宿主快照自包含，无需检出 Sources。

## 来源与许可

根目录 JS 头部保留上游来源说明，本地副本在 `upstream/<插件 ID>/UPSTREAM.md`。
Hazuki 集成部分沿用原项目 GPL-3.0 许可，完整许可保留在根目录 `LICENSE`。
