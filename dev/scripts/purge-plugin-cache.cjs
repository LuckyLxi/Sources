const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

function purgeUrls(index, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("Invalid GitHub repository; expected owner/repo");
  }
  const prefix = `https://cdn.jsdelivr.net/gh/${repository}@main/`;
  // Purge plugins first, then the index that advertises their versions.
  return [
    ...new Set([
      ...index.plugins.map((plugin) => plugin.downloadUrl),
      `${prefix}plugins.json`,
    ]),
  ].map((url) => {
    if (typeof url !== "string" || !url.startsWith(prefix)) {
      throw new Error(`Unexpected plugin download URL: ${url}`);
    }
    return url.replace(
      "https://cdn.jsdelivr.net/",
      "https://purge.jsdelivr.net/",
    );
  });
}

async function purgeCache(
  urls,
  { fetch: request = globalThis.fetch, sleep = delay, log = console.log } = {},
) {
  async function get(url) {
    const response = await request(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  const failures = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let result = await get(url);
        for (
          let poll = 0;
          result.status !== "finished" &&
          result.status !== "failed" &&
          poll < 10;
          poll++
        ) {
          if (typeof result.id !== "string" || !result.id) break;
          await sleep(1000);
          result = await get(
            `https://purge.jsdelivr.net/status/${encodeURIComponent(result.id)}`,
          );
        }
        const entry = result.paths?.[new URL(url).pathname];
        const providers = Object.values(entry?.providers ?? {});
        if (
          result.status !== "finished" ||
          entry?.throttled ||
          !providers.length ||
          providers.some((success) => success !== true)
        ) {
          throw new Error(`Purge not confirmed: ${JSON.stringify(result)}`);
        }
        log(`CDN purge API confirmed: ${url}`);
        break;
      } catch (error) {
        log(`Purge attempt ${attempt}/3 failed for ${url}: ${error.message}`);
        if (attempt === 3) failures.push(url);
        else await sleep(2000 * attempt);
      }
    }
  }
  if (failures.length) {
    throw new Error(`CDN purge failed for: ${failures.join(", ")}`);
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(async () => {
      const index = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../../plugins.json"), "utf8"),
      );
      await purgeCache(
        purgeUrls(index, process.env.GITHUB_REPOSITORY || "LuckyLxi/Sources"),
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { purgeUrls, purgeCache };
