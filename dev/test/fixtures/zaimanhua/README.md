# 再漫画 public API fixtures

Captured anonymously from `https://manhua.zaimanhua.com` on 2026-10-18.
JSON was pretty-printed without changing response fields. No account, cookies,
authorization headers or personal credentials were used or captured.

| File          | Request path and relevant query                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| search.json   | `/app/v1/search/index?keyword=猫&source=0&page=1&size=20`                                                |
| search2.json  | same search, `page=2`                                                                                    |
| home.json     | `/api/v1/comic2/index`                                                                                   |
| update.json   | `/api/v1/comic2/update_list?page=1&size=20`                                                              |
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
