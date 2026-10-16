# 插件开发

本仓库文档由 AI 编写。

正式插件放在仓库根目录，每个插件是可直接导入的单个 JS 文件，无需打包。

[API 规范](API.md) · [类型声明](hazuki-source.d.ts) · [最小示例](examples/example.js)

开发文档、类型声明和示例集中在 `docs/`，测试及开发工具位于 `dev/`。

## 本地检查

使用 Node.js 22 或更新的受支持版本，以下命令均从仓库根目录运行：

```powershell
npm --prefix dev ci
npm --prefix dev run check
npm --prefix dev run format:check
```

按修改范围运行对应测试，例如：

```powershell
node --test dev/test/relamanhua.test.cjs
```

完整测试使用 `npm --prefix dev test`。测试代码位于 `dev/test/`，固定样本位于
`dev/test/fixtures/`，使用模拟宿主离线运行，不依赖 Flutter 或真实账号。
通过测试不代表当前网站可用或账号流程已实测。

## 自动更新索引

新增、修改或删除根目录 JS 并推送到 `main` 后，[工作流](../.github/workflows/update-plugin-index.yml)
自动更新并由 bot 提交 `plugins.json`，也支持手动运行。发布修改时更新插件自身的 `version`，
无需手工维护索引。根目录仅放发布插件，开发脚本放在 `dev/`。

生成器只静态读取元数据，不执行插件。ID、名称和版本使用字符串字面量或顶层 `const`
字符串；名称和版本可省略，默认值见 API 规范。重复 ID、无效元数据或语法错误会终止生成。
下载链接使用当前仓库 `main` 分支的 jsDelivr 地址。本地默认仓库为 `LuckyLxi/Sources`，
Fork 可通过 `GITHUB_REPOSITORY` 环境变量指定。手动生成或检查：

```powershell
npm --prefix dev run index:update
npm --prefix dev run index:check
```

自动提交使用内置 `GITHUB_TOKEN`，仓库权限及分支规则须允许 bot 写入 `main`。
[开发检查工作流](../.github/workflows/check.yml) 会执行静态检查、格式检查和测试。

## 宿主回归与许可

Hazuki 主仓库的 `test/fixtures/source_plugins/` 是宿主回归快照。更新时将插件复制到对应的
`<插件 ID>/main.js`，保留类型引用注释、来源说明和离线样本，按该目录 README 运行 Flutter 测试。
快照使用实际 QuickJS 和宿主接口，无需检出 Sources。

保留插件头部及 `dev/upstream/<插件 ID>/UPSTREAM.md` 中的来源说明。
Hazuki 集成部分沿用 GPL-3.0 许可，见根目录 [LICENSE](../LICENSE)。
