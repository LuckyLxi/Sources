// Minimal HTML parser + CSS selector engine covering the subset that
// Hazuki's HtmlDocument exposes and that plugins in this repository use:
// tag, .class, #id and descendant combinators.
const VOID_TAGS = new Set([
  "br",
  "img",
  "input",
  "meta",
  "link",
  "hr",
  "source",
  "area",
  "base",
  "col",
  "embed",
  "param",
  "track",
  "wbr",
]);

function findTagEnd(html, start) {
  let quote = null;
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, ownText: "" };
  const stack = [root];
  let i = 0;
  const current = () => stack[stack.length - 1];
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      current().ownText += html.slice(i);
      break;
    }
    if (lt > i) current().ownText += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      current().ownText += html.slice(lt);
      break;
    }
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.charAt(0) === "/") {
      const name = raw.slice(1).trim().toLowerCase().split(/\s/)[0];
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([A-Za-z0-9:_-]+)/.exec(body);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const attrs = {};
    const attrRe = /([A-Za-z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    attrRe.lastIndex = nameMatch[0].length;
    let am;
    while ((am = attrRe.exec(body)) !== null) {
      if (!am[1]) continue;
      attrs[am[1].toLowerCase()] =
        am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
    }
    const node = { tag, attrs, children: [], parent: current(), ownText: "" };
    current().children.push(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) {
      if (tag === "script" || tag === "style") {
        const close = new RegExp("</" + tag + "\\s*>", "i");
        const rest = html.slice(i);
        const cm = close.exec(rest);
        i = cm ? i + cm.index + cm[0].length : html.length;
      } else {
        stack.push(node);
      }
    }
  }
  return root;
}

function classList(node) {
  return (node.attrs.class || "").split(/\s+/).filter(Boolean);
}

function matchesSimple(node, sel) {
  const tagMatch = /^[A-Za-z0-9:_-]+/.exec(sel);
  if (tagMatch && node.tag !== tagMatch[0].toLowerCase()) return false;
  const classes = [...sel.matchAll(/\.([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
  if (classes.length) {
    const have = classList(node);
    for (const c of classes) if (!have.includes(c)) return false;
  }
  const ids = [...sel.matchAll(/#([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
  for (const id of ids) if (node.attrs.id !== id) return false;
  return true;
}

function matchesSelector(node, selector) {
  const parts = selector.trim().split(/\s+/);
  if (!matchesSimple(node, parts[parts.length - 1])) return false;
  let cursor = node.parent;
  for (let p = parts.length - 2; p >= 0; p--) {
    let found = false;
    while (cursor) {
      if (matchesSimple(cursor, parts[p])) {
        found = true;
        cursor = cursor.parent;
        break;
      }
      cursor = cursor.parent;
    }
    if (!found) return false;
  }
  return true;
}

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function textOf(node) {
  let out = node.ownText;
  for (const child of node.children) out += textOf(child);
  return out;
}

function wrap(node) {
  return {
    get text() {
      return textOf(node);
    },
    get attributes() {
      return node.attrs;
    },
    get children() {
      return node.children.map(wrap);
    },
    get innerHTML() {
      return "";
    },
    get parent() {
      return node.parent ? wrap(node.parent) : null;
    },
    get classNames() {
      return classList(node);
    },
    get id() {
      return node.attrs.id || null;
    },
    get localName() {
      return node.tag;
    },
    get previousElementSibling() {
      return null;
    },
    get nextElementSibling() {
      return null;
    },
    querySelector(sel) {
      for (const d of descendants(node)) if (matchesSelector(d, sel)) return wrap(d);
      return null;
    },
    querySelectorAll(sel) {
      return descendants(node)
        .filter((d) => matchesSelector(d, sel))
        .map(wrap);
    },
  };
}

class HtmlDocument {
  constructor(html) {
    this.root = parseHtml(html);
  }
  querySelector(sel) {
    for (const d of descendants(this.root)) if (matchesSelector(d, sel)) return wrap(d);
    return null;
  }
  querySelectorAll(sel) {
    return descendants(this.root)
      .filter((d) => matchesSelector(d, sel))
      .map(wrap);
  }
  getElementById(id) {
    return this.querySelector("#" + id);
  }
  dispose() {}
}

module.exports = { HtmlDocument, parseHtml };
