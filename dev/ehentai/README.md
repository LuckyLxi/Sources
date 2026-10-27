# E-Hentai 插件

`ehentai.js` 是 Hazuki API v1 单文件插件，版本 1.0.1。直接本地导入仓库根目录的文件即可；更新本地导入的插件后需重新导入该文件。

## 已实现

- E-Hentai / ExHentai 站点选择，默认 E-Hentai。
- 最新、热门、分类、关键词和命名空间标签搜索。列表按网站的 `next` 游标翻页；宿主跳到尚未访问的页时，需要依次取得前面的游标。
- 完整画廊链接或 `gid/token` 直达，不支持只有数字的 gid。
- 详情、原文标题、页数、评分、上传者和标签。作者通过 `artist` 信息栏展示。
- 画廊作为一个章节，遍历缩略图分页取得按原始页码排序的图片页链接；阅读、预加载或下载该页时，才解析 `#img` 获取实际图片地址。不提前逐张消耗网站图片配额。解析结果在内存中保留 60 秒、至多 64 项，避免宿主在下载后再次调用图片钩子检查分块信息时重复请求；不持久保存图片地址，换号、退出或切站点时清空。
- 原生账号密码登录、浏览器登录 E-Hentai、手动 Cookie 登录、网站验证账号资料和本地退出会话。登录失败依赖宿主的隔离登录事务回滚。

## 登录与网站设置

在 Hazuki 的账号入口选择“账号密码登录”，直接使用宿主现有表单输入账号和密码，不会自动打开 WebView。插件先取得 E-Hentai `/home.php` 的登录表单，读取当前隐藏字段，再向论坛 `index.php?act=Login&CODE=01` 提交。账号密码只用于本次登录请求，插件不会将其另存到设置、日志或文件中。

浏览器登录直接打开 E-Hentai `/home.php`，未登录时该页会显示用户名、密码表单，无需在画廊首页寻找入口。完成网站登录后点击完成登录。需要 `ipb_member_id` 和 `ipb_pass_hash`；两种登录方式都会通过论坛个人资料页的已登录账号链接验证身份，只有 Cookie 存在不会视为登录成功。

如果论坛要求验证码或 Cloudflare 安全验证，账号密码请求会明确报错，可手动选择浏览器登录。浏览器登录后的论坛资料请求仍可能被拦截；本版未验证该场景能否完成授权，不会忽略身份验证来提交账号。

Cookie 登录粘贴形如 `ipb_member_id=…; ipb_pass_hash=…; igneous=…` 的 Cookie 请求头。凭据只通过宿主 Cookie 接口保存，不写入设置、文档、日志或测试样例。ExHentai 需要有权限的账号和有效 `igneous`，可通过 Cookie 登录导入；E-Hentai 浏览器登录不声明已完成 ExHentai 授权。

网站应使用普通图片查看器。多页查看器、图片配额耗尽、临时 IP 限制、权限不足或解析失败会明确报错。插件不更改宿主界面、交互或动画。

本版未实现网站云收藏、评论、评分提交、原图付费下载和网站阅读进度。宿主本地收藏、历史和下载沿用现有能力。

## 验证范围

协议和解析规则参考用户提供的 `D:\Downloads\JHenTai-master`。2026-10-26 从当前本机网络抓取了公开首页、扩展布局首页、匿名 `/home.php` 和 `/favorites.php`；两个匿名账号页面都返回了向论坛提交的登录表单，字段包括 `UserName`、`PassWord`、`CookieDate`、`b` 和 `bt`。列表布局切换参数实测为 `inline_set=dm_e`，已替换原先不起作用的 `dm=e`。

抓取响应和浏览器调试文件只放在 `scratch/ehentai/`。本地固定 HTML 样例为人工合成或按公开登录表单结构裁剪，无真实账号或成人图片。测试覆盖游标隔离、跳页、刷新、分类、详情、缩略图分页、延迟解析、配额/权限错误、账号密码编码、验证码/Cloudflare 拦截和登录校验。运行：

```powershell
npm --prefix dev run check
npm --prefix dev run format:check
node --test dev/test/ehentai.test.cjs
```

论坛首页和登录页在本机 HTTP 请求及 Playwright 浏览器中都被 Cloudflare 拦截（HTTP 403），未取得论坛登录表单；E-Hentai `/home.php` 的登录表单可正常抓取。未使用真实账号提交，账号登录成功、ExHentai 权限和宿主阅读/下载仍需实机验证。固定样例通过不代表账号实测通过。

## 上游来源与许可证

参考 [JHenTai](https://github.com/jiangtian616/JHenTai)，作者 JTMonster（jiangtian616）及贡献者，Apache License 2.0。

参考文件：`lib/src/network/eh_request.dart`、`lib/src/utils/eh_spider_parser.dart`、`lib/src/model/search_config.dart`、`lib/src/network/eh_cookie_manager.dart`、`lib/src/consts/eh_consts.dart`。改动包括移植为 JavaScript、替换为 Hazuki HTTP/HTML/Cookie 接口、将网站游标映射为宿主页码，以及按需解析阅读图片地址。没有复制 JHenTai UI、账号配置或私有 API 密钥。

上游完整许可证保存为本目录 `JHenTai-LICENSE.txt`，同时嵌入单文件插件末尾，随插件分发。新增适配代码遵循仓库 GPL-3.0 许可证。
