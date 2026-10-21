const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function example(events, quick = {}) {
  let source;
  const updates = [];
  const writes = [];
  let closed = 0;
  class Cancelled extends Error {
    constructor(reason) {
      super(`plugin_ui_cancelled:${reason}`);
      this.code = "plugin_ui_cancelled";
    }
  }
  const context = vm.createContext({
    Hazuki: {
      registerSource: (value) => {
        source = value;
      },
      error: (code, message) => new Error(`${code}:${message}`),
      storage: {
        set: async (key, value) => {
          writes.push([key, value]);
        },
      },
      secrets: {
        set: async (key, value) => {
          writes.push([key, value]);
        },
      },
      ui: {
        ...quick,
        isAvailable: async () => true,
        PluginDialogCancelledError: Cancelled,
        openDialog: async () => ({
          nextEvent: async () => events.shift(),
          update: async (patch) => {
            updates.push(patch);
          },
          close: async () => {
            closed++;
          },
        }),
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../docs/examples/dialog.js"),
      "utf8",
    ),
    context,
  );
  return {
    source,
    context,
    updates,
    writes,
    get closed() {
      return closed;
    },
  };
}

test("line form updates selection and saves only on submit", async () => {
  const host = example([
    { type: "change", id: "line", values: { line: "backup" } },
    { type: "action", id: "save", values: { line: "backup" } },
  ]);
  await host.source.actions.chooseLine();
  assert.equal(host.updates.length, 1);
  assert.deepEqual(host.writes, [["line", "backup"]]);
  assert.equal(host.closed, 1);
});

test("cancelled form writes nothing and always closes", async () => {
  const host = example([{ type: "closed", reason: "user" }]);
  await assert.rejects(
    host.source.actions.chooseLine(),
    (e) => e.code === "plugin_ui_cancelled",
  );
  assert.deepEqual(host.writes, []);
  assert.equal(host.closed, 1);
});

test("captcha retries in the same dialog", async () => {
  const host = example([
    { type: "action", id: "submit", values: { code: "wrong" } },
    { type: "action", id: "submit", values: { code: "right" } },
  ]);
  host.context.image = [1];
  host.context.verify = async (code) => code === "right";
  assert.equal(
    await vm.runInContext("requestImageCode(image, verify)", host.context),
    "right",
  );
  assert.equal(host.updates.length, 1);
  assert.equal(host.updates[0].fieldErrors.code, "验证码错误，请重试");
  assert.equal(host.closed, 1);
});

test("quick dialog example saves only after confirmation and a submitted value", async () => {
  for (const [confirmed, code] of [
    [false, "ignored"],
    [true, null],
    [true, "secret"],
  ]) {
    let alerts = 0;
    let prompts = 0;
    const host = example([], {
      confirm: async () => confirmed,
      prompt: async (options) => {
        prompts++;
        assert.equal(options.obscure, true);
        return code;
      },
      alert: async () => {
        alerts++;
      },
    });
    await host.source.actions.setAccessCode();
    assert.equal(prompts, confirmed ? 1 : 0);
    assert.deepEqual(
      host.writes,
      confirmed && code !== null ? [["accessCode", code]] : [],
    );
    assert.equal(alerts, confirmed && code !== null ? 1 : 0);
  }
});
