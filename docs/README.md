# 插件开发

本仓库文档由 AI 编写。

正式插件放在仓库根目录，每个插件是可直接导入的单个 JS 文件，无需打包。

[API 规范](API.md) · [类型声明](hazuki-source.d.ts) · [最小示例](examples/example.js)

开发文档、类型声明和示例集中在 `docs/`，测试及开发工具位于 `dev/`。
宿主 API 统一维护在 `API.md`；从 Hazuki 迁入的 `source_plugins.md` 已合并到该规范和本文。
[授权验证记录](plugin_authorization_verification.md) 保留宿主平台实测、历史检查结果及待验收范围；
[再漫画插件说明](../zaimanhua.md) 记录该插件自身的功能和验证范围。

可选扩展示例：[登录交互、章节分组与进度上报](examples/host-capabilities.js)、
[浏览器回调授权](examples/browser-authorization.js)、
[网站阅读历史、外部应用授权与 Cookie 登录](examples/cloud-and-authorization.js)。

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

以下命令在 **Hazuki 主仓库** 运行，先按宿主当前依赖构建原生测试库（输出位于
`packages/quickjs_engine/native/build`），再按修改范围选择相关测试：

```powershell
dart run tool/build_quickjs_test_library.dart
flutter test test/services/source/source_script_engine_test.dart
flutter test test/services/source/source_plugins_test.dart
flutter test test/services/source/migrated_source_plugins_test.dart
flutter test test/services/source/relamanhua_source_plugin_test.dart
```

宿主的 `SourceScriptEngine` 适配 QuickJS；迁入文档记录的依赖版本为 `quickjs_engine 0.1.6`，
`third_party/pub_overrides/quickjs_engine` 保留执行超时保护和运行时释放补丁，详见宿主该目录的
`HAZUKI_NOTES.md`。Windows 需要 Visual Studio C++ 工具链及 CMake；Linux 需要 CMake 和
C++ 编译器。Windows 授权浏览器构建还需要 NuGet CLI，可用时将其目录加入 `PATH`。
宿主完整验收还包括 Dart 格式检查、`flutter analyze`、测试和 Android/Windows 调试构建；
历史执行结果与未验收项目见 [授权验证记录](plugin_authorization_verification.md)。

迁入文档记录的协议测试覆盖签名、资料与头像兼容、登录失败保留 token、签到、会话重试、分页、
章节映射和图片排序。拷贝 HTTP 210 最多请求五次，评论等写操作不因限流重复提交；
哔咔资料查询兼容两种签名路径和旧客户端请求头，资料接口不可用时从 JWT 获取昵称，
保留已成功完成的登录。热辣 Node 测试使用离线 HTML/JSON 样本和独立 AES 解密结果，
宿主回归覆盖导入、搜索、详情、章节解密、画质及模拟账号收藏流程。

信息栏格式迁移时的历史版本为 JM `1.0.4`、哔咔 `1.0.3`、CopyManga `1.0.2`、热辣 `1.3.4`；
这些是迁移记录，当前发布版本以插件源码及生成的索引为准。源码修改不会自动升级已安装插件。

保留插件头部及 `dev/upstream/<插件 ID>/UPSTREAM.md` 中的来源说明。
Hazuki 集成部分沿用 GPL-3.0 许可，见根目录 [LICENSE](../LICENSE)。
