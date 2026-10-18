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

The public JavaScript bundles identify these routes and the catalog/rank option
values. Tests additionally construct malformed/error responses and chapter
ordering edge cases from these snapshots; those cases are not claimed to be
captured server responses. Tests run offline and do not fetch the image URLs.

Account config, captcha metadata, login success, user profiles, OAuth start URLs,
and reading-record success responses used in `zaimanhua.test.cjs` are constructed
samples based on the public desktop bundles. They are not captured account
success responses. Credentials and tokens in those tests are synthetic strings;
no real account information is checked in. Point coordinates are mock user input.

Subscription success and membership responses are also constructed samples. The
account center's public `788.d09de41f.js` declares `subList`/`total` and the
`status`/`firstLetter`/`page`/`size` list parameters; its renderer uses each comic's
`id`, `title`, `cover`, and update fields. Tests reuse public search items for the
mock subscription pages. No real user's subscription library was captured.

Cloud-reading success records in `zaimanhua.test.cjs` are constructed samples.
The captured anonymous `detail.json` includes the real zero-valued
`data.readingRecord` placeholder. The account center's public
`624.2c99a1ba.js` declares the history request `source=mh`, `page`, `pageSize`,
and response `data.recordList`; its renderer reads `biz_id`, `title`, `cover`,
`chapter_id`, `chapter_name`, `record`, and `viewing_time`. It displays `record`
as the page number. No real account history or successful authenticated reading
response was captured. `total_num` is not assumed to be an image count.
