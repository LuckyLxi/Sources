# 再漫画 public API fixtures

Captured anonymously from `https://manhua.zaimanhua.com` on 2026-10-18.
Unless noted below, JSON was pretty-printed without changing response fields. No account, cookies,
authorization headers or personal credentials were used or captured.

| File          | Request path and relevant query                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| search.json   | `/app/v1/search/index?keyword=猫&source=0&page=1&size=20`                                                |
| search2.json  | same search, `page=2`                                                                                    |
| home.json     | `/api/v1/comic2/index`                                                                                   |
| banner-comics.json | `/api/v1/comic2/comic/detail?id=<obj_id>` for the six comics in `home.json`'s banner list; only `comicInfo.id/title/cover` retained, indexed by comic ID |
| update.json   | `/api/v1/comic2/update_list?page=1&size=20`                                                              |
| update2.json  | same update list, `page=2` (distinct next 20 comics)                                                    |
| catalog.json  | `/api/v1/comic1/filter?sortType=0&page=1&size=20&status=0&audience=0&theme=0&cate=0&zone=0&firstLetter=` |
| ranking.json  | `/api/v1/comic1/rank_list?page=1&size=20&duration=1&cate=1&tag=0&theme=0`                                |
| detail.json   | `/api/v1/comic2/comic/detail?id=80825`                                                                   |
| related.json  | `/api/v1/comic1/comic/same_list?comic_id=80825`                                                          |
| chapter.json  | `/api/v1/comic2/chapter/detail?comic_id=80825&chapter_id=170150`                                         |
| chapter2.json | same comic, `chapter_id=193700`                                                                          |
| comments.json | `/app/v1/comment/list?objId=80825&sortBy=1&type=4&page=1&size=16&top_status=0&is_goods=0` |
| comments2.json | same comment list, `page=2` (server reports `total=0` despite a full page) |
| comments-hot.json | same comment list, `sortBy=2&page=1` (popular order) |
| comments-hot2.json | same popular comment list, `page=2` |
| comments-empty.json | same comment list, `objId=999999999&page=1` |

The public JavaScript bundles identify these routes and the catalog/rank option
values. Tests additionally construct malformed/error responses and chapter
ordering edge cases from these snapshots; those cases are not claimed to be
captured server responses. Tests run offline and do not fetch the image URLs.

The banner metadata projection was captured anonymously on 2026-10-18. For
example, comic 77926 is titled `缺憾之恋的主角们`, while its banner says
`双向暗恋、全班都是cp粉`. Tests preserve the website's promotional title/art in
`bannerTitle`/`imageUrl` and the target comic's real title/cover separately.

Account config, captcha metadata, login success, user profiles, OAuth start URLs,
and comment creation/like success responses used in `zaimanhua.test.cjs` are constructed
samples based on the public desktop bundles. They are not captured account
success responses. Credentials and tokens in those tests are synthetic strings;
no real account information is checked in. Point coordinates are mock user input.

Subscription success and membership responses are also constructed samples. The
account center's public `788.d09de41f.js` declares `subList`/`total` and the
`status`/`firstLetter`/`page`/`size` list parameters; its renderer uses each comic's
`id`, `title`, `cover`, and update fields. Tests reuse public search items for the
mock subscription pages. No real user's subscription library was captured.

The captured anonymous `detail.json` includes a zero-valued `data.readingRecord`
placeholder. It is not evidence of usable cloud progress. Cloud progress callbacks
were removed in v1.3.0; the host keeps its normal local reading position.

Comment list snapshots are real anonymous responses. Public desktop bundles
`cptico.94872265.js` and `index.e1a7f684.js` expose the type=4 list, `addLike`,
and the JSON POST to `https://v4api.zaimanhua.com/app/v1/comment/create`
(`obj_id`, `content`, `to_comment_id`, `type`, `mentions`). Comma-separated
`commentIdList` entries reference the current comment followed by quoted ancestors.
The component's latest/popular tabs use `sortBy=1` and `sortBy=2` respectively.
The popular fixtures were captured anonymously on 2026-10-18 with `size=16`.
No real comment was sent, replied to, or liked during verification. Authenticated
write success is mocked and has not been verified with a real account. No unlike
endpoint or separate reply-thread endpoint has been established.

In v1.5.0 the plugin groups the mixed list into native reply threads using those
ancestor chains. Only roots enter the main list; replies retain their own content
and exact parent IDs. Raw batches use `size=100` (the server's observed maximum),
while host pages remain 16 items. Additional raw pages are read on demand to fill
main/reply pages, ignoring the unreliable `total`. The existing 16-item snapshots
are also used as short mocked batches; synthetic larger batches cover pagination,
self replies, nested replies, deleted ancestors, retries and cache invalidation.

Anonymous live reads on 2026-10-19 verified main/reply grouping in newest and
popular order, including the reported self reply on `猫咪日常` (comic 16210) and
cross-page threads on comic 80825. No new authenticated write was performed.

In v1.5.1 the home update preview links to the existing paginated update loader
through `viewMore: "explore:1"`. Anonymous live reads on 2026-10-19 verified that
pages 1 and 2 each return 20 distinct comics. The host QuickJS discovery gateway
was checked with the captured home/update snapshots to verify the link and page
parameters; the homepage preview does not consume or skip update-list page 1.

Check-in routes are declared by the account center's `app.6311fe13.js`:
GET `https://i.zaimanhua.com/lpi/v1/task/list` and bodyless POST
`https://i.zaimanhua.com/lpi/v1/task/sign_in`. Its `791.e4f28d59.js`
component reads the boolean `data.task.signInfo.currentSign` and signs only
through the separate button action. These requests use `Platform: pc` and the
same Bearer session; there are no comic API common query parameters.

On 2026-10-18, with the user's permission, the production plugin's check-in
callbacks were exercised in the authenticated website browser using a minimal
Hazuki HTTP/session bridge. Status changed from false to true after one POST
(`errno=0`, `errmsg="成功"`); a second callback returned `alreadyCheckedIn`
without another POST. The user had already signed in the official App, but
the website initially reported false; this observation does not establish
whether all App/website accounts share check-in state. The real host's QuickJS
account gateway was verified separately with a synthetic server/session.

Task/status and sign-in/error responses in unit tests are constructed samples
using the observed structure, not stored real account payloads. No account
credentials, account balances, task lists or session tokens were saved as fixtures.
