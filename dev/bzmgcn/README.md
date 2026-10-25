# 包子漫画插件

入口：仓库根目录 `bzmgcn.js`；插件 ID：`bzmgcn`；版本：`1.3.0`。

适配站点：[包子漫画](https://cn.bzmgcn.com/)。独立编写，遵循仓库 GPL-3.0 许可证，未复制网站脚本。

## 功能

- 首页七个推荐分区、最新上架、分页漫画库；接入站点已有的六个“查看更多”入口。
- 按题材、地区、连载状态和首字母筛选。
- 搜索、漫画详情、完整章节目录及章节图片。
- 将详情页“猜你喜欢”中的漫画接入宿主“相关”标签页，保留站点顺序和原始封面，排除小说及动画链接。
- 合并同一章节的分页图片，去除跨页重复图片，不加载下一话。
- 遇到网站 Gatekeeper 验证时调用宿主现有 WebView，导入网站验证 Cookie 及对应 User-Agent；并发请求共用一次验证。插件设置提供重新验证入口。
- 邮箱密码登录、Cookie 会话保存、会话校验和本地退出。
- 网站书架读取、收藏状态查询、添加和取消收藏；修改后重新读取网站书架确认结果，已有收藏不会重复添加，以免重置网站阅读位置。

网站搜索和最新上架没有分页入口，插件将网站返回的全部条目作为一页，不重复请求后续页。分类使用网站的 `amp_comic_list` 分页 API。网站书架没有分组，显示为一个“网站书架”收藏夹；读取网站完整书架后作为单页返回。评论未实现。

首页“热门漫画”“推荐国漫”“推荐韩漫”“推荐日漫”“热血漫画”的网站“更多”链接均为 `/classify`，插件按原链接打开分类库，不按专栏名称额外限定地区或题材。分类库提供地区、状态、首字母及题材四项筛选，使用筛选结果分页；最新上架打开独立列表。网站“最近更新”分区没有“更多”链接，插件不为它指定其他列表。

## 使用

在宿主中导入根目录 `bzmgcn.js`。首次遇到验证时，等待浏览器显示“验证通过”，再点击宿主的完成按钮。需要支持 `Hazuki.ui.openWebView` 以及 Cookie / User-Agent 导入的宿主版本。取消或验证失败会终止当前请求，可重试。

验证 Cookie 名称从网站响应及 Cookie 存储读取，不内置个人 Cookie。验证窗口不会被当作账号登录，不会创建网站账号资料。

在插件账号入口选择“邮箱密码登录”，输入网站已有账号。插件使用网站的 `/api/bui/signin` 表单接口，按网站规则保存 `TSID` Cookie，并请求受保护的 `/user/my_bookshelf` 校验会话；返回登录表单、临时书架或未知页面均不会被当作登录成功。需要支持显式 `loginMethods` 和隔离登录事务的宿主，失败或取消由宿主回滚本次 Cookie 和存储改动。

账号显示名使用登录邮箱，不虚构昵称或头像。插件自身不保存密码，也不将 `TSID` 写入普通 JSON 存储；账号密码由宿主管理。退出会删除此插件的 `TSID` 和邮箱资料，保留网站访问验证 Cookie；本地退出不代表服务器撤销该会话。

登录后可以使用云端收藏页同步网站书架。未登录、会话失效或网站返回临时书架时，插件明确报错；网站页面结构变化也不会被当作空收藏。添加/取消收藏使用 `/user/operation_v2` 的 `set_bookmark` / `del_bookmark`，操作请求失败时不自动重放，结果不明时先刷新书架再重试。

## 验证记录（2026-10-26）

已用桌面 Chromium 和真实站点响应检查首页、搜索、分类两页、空分类、两部作品详情、短章节和长章节。火影忍者第一话在网站拆成两页，两页重叠四张，合并后为 96 张；已确认其图片 CDN 返回 `200 image/jpeg`。

已再次核对首页六个“更多”链接、分类页四组筛选及详情页“猜你喜欢”的漫画标记。新增固定样本 `catalog-romance-jp1.json`、`catalog-romance-jp2.json` 为日本恋爱题材的实际分类分页响应；测试覆盖从首页入口加载、组合筛选、筛选后分页以及剔除小说和动画推荐。未实测 Hazuki 客户端内点击这些入口后的完整界面流程。

妖神记最新一话的部分图片在网站自身也返回 404，插件保留网站实际图片地址，不猜测替代图片。封面使用站点原始 `static-tw.bzmgcn.com` 地址；当前网络中 curl 和 Chromium 请求该 CDN 均超时，封面实际加载尚未验证。阅读站点使用的旧封面域名也返回 403，未替换为该域名。

使用用户提供的“实力至上”复现并修复短篇详情失败：第二年篇只有 18 个倒序“最新章节”链接，没有 `chapter-items` / `chapters_other_list`，现在保留真实章节 ID 并反转为阅读顺序。三个搜索结果均已用实际响应回归详情解析；其中两部作品第一话分别解析出 33、45 张图片。旧搜索别名跳转后，续页使用阅读页的 canonical 路径匹配，避免因新旧别名不同截断图片。

已在真实浏览器观察到封面请求的 Referer 为 `https://cn.bzmgcn.com/`，插件现在按封面和正文分别提供请求头。用户也确认网站搜索结果的封面无法加载；当前无法确认代理是否为根因，封面 CDN 超时问题尚未解决。

未实测 Hazuki Windows WebView2 / Android WebView 的验证及实际阅读；桌面浏览器通过验证不代表两种宿主平台均已通过。

已检查网站当前登录脚本及邮箱密码接口，使用 `.invalid` 域名的无效账号确认失败码 `ERR_SIGNIN_NAME_OR_PASSWORD`；确认未登录访问 `/user/my_bookshelf` 会重定向到 `/user/signin`。未提供真实账号，因此成功登录、真实账号书架页面结构及宿主内完整登录流程尚未实测。

测试固定数据位于 `dev/test/fixtures/bzmgcn/`，来自上述日期的公开站点响应。HTML 只保留相关页面片段，移除了页面脚本和无关头部；不包含账户或验证凭据。分类 JSON 保留实际 API 字段，验证流程测试使用合成 Cookie 名称和值。

其中 `signin.html` 和 `signin-invalid.json` 来自实际匿名响应；`signin-success.json` 依据网站登录脚本使用的字段构造，`bookshelf-signed-in.html` 是基于书架公共布局的合成样本，均不代表真实账号成功响应。离线测试还模拟宿主的隔离登录提交/回滚，覆盖错误凭据、受保护页面拒绝、运行时重建、验证取消和退出时保留访问验证 Cookie。

`search-shili.html`、`detail-shili1.html` 至 `detail-shili3.html`、`reader-shili2.html`、`reader-shili3.html` 为本次实际匿名页面的相关片段。`bookshelf-populated.html` 为合成账号书架样本，不含真实账号数据。书架的 `.bookshelf-items` / `h4 a` 结构及收藏操作名称参考 [venera-app/venera-configs 的包子源](https://github.com/venera-app/venera-configs/blob/a04e05591f7832f7166d6660546613c114d6738a/baozi.js)，并与 [JunQianNuo/venera-sources 的账号接口核对记录](https://github.com/JunQianNuo/venera-sources/blob/b489d5e2d8c53e6a2a03af9a8bf87dab25a0df0a/docs/accounts-verification.md) 交叉核对。真实账号的收藏读取和增删尚未实测，离线通过不代表服务器写入已验收。

验证命令：

```powershell
npm --prefix dev run check
npm --prefix dev run format:check
node --test dev/test/bzmgcn.test.cjs
```
