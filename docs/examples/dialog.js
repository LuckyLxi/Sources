/// <reference path="../hazuki-source.d.ts" />

/** @param {SourceText} message @returns {SourceDialogComponent[]} */
function lineFields(message) {
  return [
    { id: "message", type: "text", text: message },
    {
      id: "line",
      type: "select",
      label: "线路",
      required: true,
      notifyChange: true,
      options: [
        { value: "primary", label: "主线路" },
        { value: "backup", label: "备用线路" },
      ],
    },
  ];
}

async function chooseLine() {
  if (
    typeof Hazuki.ui?.openDialog !== "function" ||
    !(await Hazuki.ui.isAvailable())
  ) {
    throw Hazuki.error(
      "UI_UNAVAILABLE",
      "请在支持交互弹窗的新版宿主中手动操作",
    );
  }
  const dialog = await Hazuki.ui.openDialog({
    title: "选择访问线路",
    content: lineFields("请选择一条线路"),
    buttons: [{ id: "save", text: "保存", role: "primary", validate: true }],
  });
  try {
    while (true) {
      const event = await dialog.nextEvent();
      if (event.type === "closed")
        throw new Hazuki.ui.PluginDialogCancelledError(event.reason);
      const line = event.values.line;
      if (typeof line !== "string") throw new Error("Invalid line");
      if (event.type === "change") {
        await dialog.update({ content: lineFields(`当前选择：${line}`) });
        continue;
      }
      await Hazuki.storage.set("line", line);
      return "线路已保存";
    }
  } finally {
    await dialog.close();
  }
}

/**
 * 图形验证码与普通表单使用同一接口。图片与网站验证仍由调用方提供。
 * @param {SourceDialogImage} image
 * @param {(code: string) => Promise<boolean>} verify
 */
async function requestImageCode(image, verify) {
  const dialog = await Hazuki.ui.openDialog({
    title: "输入验证码",
    content: [
      { id: "image", type: "image", image },
      { id: "code", type: "input", label: "验证码", required: true },
    ],
    buttons: [{ id: "submit", text: "提交", validate: true, role: "primary" }],
  });
  try {
    while (true) {
      const event = await dialog.nextEvent();
      if (event.type === "closed")
        throw new Hazuki.ui.PluginDialogCancelledError(event.reason);
      if (event.type !== "action") continue;
      const code = event.values.code;
      if (typeof code !== "string") throw new Error("Invalid code");
      if (await verify(code)) return code;
      await dialog.update({
        fieldErrors: { code: "验证码错误，请重试" },
      });
    }
  } finally {
    await dialog.close();
  }
}

async function setAccessCode() {
  if (
    typeof Hazuki.ui?.prompt !== "function" ||
    !(await Hazuki.ui.isAvailable())
  )
    throw Hazuki.error(
      "UI_UNAVAILABLE",
      "请在支持快捷弹窗的新版宿主中手动操作",
    );
  if (
    !(await Hazuki.ui.confirm({
      title: "设置访问码",
      message: "是否修改访问码？",
    }))
  )
    return;
  const code = await Hazuki.ui.prompt({
    title: "设置访问码",
    label: "访问码",
    obscure: true,
    required: true,
    maxLength: 64,
  });
  if (code === null) return;
  await Hazuki.secrets.set("accessCode", code);
  await Hazuki.ui.alert({ title: "设置访问码", message: "已保存" });
}

Hazuki.registerSource({
  id: "dialog_example",
  name: "交互弹窗示例",
  version: "1.1.0",
  presentation: {
    actions: [
      { id: "chooseLine", title: "选择线路" },
      { id: "setAccessCode", title: "设置访问码" },
    ],
  },
  actions: { chooseLine, setAccessCode },
  search: { load: async () => ({ comics: [] }) },
  comic: {
    loadInfo: async () => ({ title: "示例", chapters: {} }),
    loadEp: async () => ({ images: [] }),
  },
});
