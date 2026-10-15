const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildIndex,
  readPluginMetadata,
  updateIndex,
} = require("../scripts/update-plugin-index.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hazuki-index-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "dev"));
  fs.writeFileSync(path.join(root, "dev/example.js"), "not a published plugin");
  return root;
}

function writePlugin(root, filename, id, version = "1.0.0") {
  fs.writeFileSync(
    path.join(root, filename),
    `Hazuki.registerSource({id: ${JSON.stringify(id)}, name: '测试源', version: ${JSON.stringify(version)}});`,
  );
}

test("index tracks additions, version changes, renames and deletions", (t) => {
  const root = fixture(t);
  writePlugin(root, "second.js", "second");
  writePlugin(root, "first.js", "first");
  assert.equal(updateIndex(root), true);
  assert.equal(updateIndex(root), false);
  let index = JSON.parse(
    fs.readFileSync(path.join(root, "plugins.json"), "utf8"),
  );
  assert.deepEqual(
    index.plugins.map((plugin) => plugin.id),
    ["first", "second"],
  );
  assert.equal(index.plugins[0].name, "测试源");

  writePlugin(root, "first.js", "first", "2.0.0");
  fs.renameSync(path.join(root, "second.js"), path.join(root, "renamed.js"));
  updateIndex(root);
  index = buildIndex(root);
  assert.equal(index.plugins[0].version, "2.0.0");
  assert.equal(
    index.plugins[1].downloadUrl,
    "https://cdn.jsdelivr.net/gh/LuckyLxi/Sources@main/renamed.js",
  );

  fs.unlinkSync(path.join(root, "first.js"));
  updateIndex(root);
  assert.deepEqual(
    buildIndex(root).plugins.map((plugin) => plugin.id),
    ["second"],
  );
  fs.unlinkSync(path.join(root, "renamed.js"));
  updateIndex(root);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "plugins.json"), "utf8")),
    { schemaVersion: 1, plugins: [] },
  );
});

test("preserves existing index order and appends new plugins", (t) => {
  const root = fixture(t);
  writePlugin(root, "a.js", "a");
  writePlugin(root, "b.js", "b");
  writePlugin(root, "c.js", "c");
  fs.writeFileSync(
    path.join(root, "plugins.json"),
    JSON.stringify({ schemaVersion: 1, plugins: [{ id: "b" }, { id: "a" }] }),
  );
  updateIndex(root);
  assert.deepEqual(
    buildIndex(root).plugins.map((plugin) => plugin.id),
    ["b", "a", "c"],
  );
  assert.equal(updateIndex(root), false);
});

test("reads const metadata and class fields without executing plugin code", () => {
  assert.deepEqual(
    readPluginMetadata(
      `
    throw new Error('must not execute');
    const version = '1.2.3';
    const source = {id: 'example', name: '示例', version};
    Hazuki.registerSource(source);
  `,
      "example.js",
    ),
    { id: "example", name: "示例", version: "1.2.3" },
  );
  assert.deepEqual(
    readPluginMetadata(
      `
    class Example extends ComicSource {
      key = 'example';
      name = 'Class example';
      version = '2.0.0';
    }
  `,
      "example.js",
    ),
    { id: "example", name: "Class example", version: "2.0.0" },
  );
  assert.deepEqual(
    readPluginMetadata("Hazuki.registerSource({id: 'minimal'});", "minimal.js"),
    { id: "minimal", name: "minimal", version: "0.0.0" },
  );
});

test("invalid metadata leaves the previous index untouched", (t) => {
  const root = fixture(t);
  writePlugin(root, "valid.js", "valid");
  updateIndex(root);
  const previous = fs.readFileSync(path.join(root, "plugins.json"), "utf8");
  for (const code of [
    "Hazuki.registerSource({id: 'INVALID'});",
    "Hazuki.registerSource({id: 'broken', version: getVersion()});",
    "Hazuki.registerSource({id: 'broken', name: ''});",
    "Hazuki.registerSource({id: 'one'}); Hazuki.registerSource({id: 'two'});",
    "Hazuki.registerSource({id: 'one', id: 'two'});",
    "Hazuki.registerSource({id: 'broken', ...extra});",
    "const source = source; Hazuki.registerSource(source);",
    "const source = {",
    "// Missing registration",
  ]) {
    fs.writeFileSync(path.join(root, "broken.js"), code);
    assert.throws(() => updateIndex(root));
    assert.equal(
      fs.readFileSync(path.join(root, "plugins.json"), "utf8"),
      previous,
    );
  }
  writePlugin(root, "broken.js", "valid");
  assert.throws(() => updateIndex(root), /Duplicate plugin ID/);
  assert.equal(
    fs.readFileSync(path.join(root, "plugins.json"), "utf8"),
    previous,
  );
});

test("check mode reports drift without writing and accepts CRLF", (t) => {
  const root = fixture(t);
  writePlugin(root, "example.js", "example");
  assert.throws(() => updateIndex(root, { check: true }), /stale/);
  assert.equal(fs.existsSync(path.join(root, "plugins.json")), false);
  updateIndex(root);
  const index = path.join(root, "plugins.json");
  fs.writeFileSync(
    index,
    fs.readFileSync(index, "utf8").replace(/\n/g, "\r\n"),
  );
  assert.equal(updateIndex(root, { check: true }), false);
  writePlugin(root, "example.js", "example", "2.0.0");
  const previous = fs.readFileSync(index, "utf8");
  assert.throws(() => updateIndex(root, { check: true }), /stale/);
  assert.equal(fs.readFileSync(index, "utf8"), previous);
});

test("download URLs use the actual filename and configured repository", (t) => {
  const root = fixture(t);
  writePlugin(root, "中文 name.js", "example");
  assert.equal(
    buildIndex(root, "owner/fork").plugins[0].downloadUrl,
    "https://cdn.jsdelivr.net/gh/owner/fork@main/%E4%B8%AD%E6%96%87%20name.js",
  );
  assert.throws(
    () => buildIndex(root, "invalid repository"),
    /Invalid GitHub repository/,
  );
});
