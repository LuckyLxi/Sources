const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../..");

// Read metadata without executing plugin code or calling init().
function readPluginMetadata(code, filename) {
  const file = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (file.parseDiagnostics.length) {
    throw new Error(`${filename}: invalid JavaScript`);
  }

  const constants = new Map();
  const classes = [];
  const registrations = [];
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          constants.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    if (
      ts.isClassDeclaration(statement) &&
      statement.heritageClauses?.some(
        (clause) =>
          clause.token === ts.SyntaxKind.ExtendsKeyword &&
          clause.types.some((type) =>
            ["HazukiSource", "ComicSource"].includes(
              type.expression.getText(file),
            ),
          ),
      )
    ) {
      classes.push(statement);
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const call = statement.expression;
    if (
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === "Hazuki" &&
      call.expression.name.text === "registerSource"
    ) {
      if (call.arguments.length !== 1) {
        throw new Error(`${filename}: registerSource requires one argument`);
      }
      registrations.push(call.arguments[0]);
    }
  }

  function resolve(node, seen = new Set()) {
    if (ts.isParenthesizedExpression(node))
      return resolve(node.expression, seen);
    if (!ts.isIdentifier(node)) return node;
    if (seen.has(node.text) || !constants.has(node.text)) {
      throw new Error(
        `${filename}: metadata must use literals or top-level const`,
      );
    }
    seen.add(node.text);
    return resolve(constants.get(node.text), seen);
  }

  if (registrations.length > 1) {
    throw new Error(`${filename}: multiple source registrations`);
  }
  let definition;
  if (registrations.length === 1) {
    definition = resolve(registrations[0]);
    if (!ts.isObjectLiteralExpression(definition)) {
      throw new Error(`${filename}: registerSource must receive an object`);
    }
  } else {
    if (classes.length !== 1) {
      throw new Error(
        `${filename}: expected one source registration or source class`,
      );
    }
    definition = classes[0];
  }

  const fields = new Map();
  for (const member of definition.properties ?? definition.members) {
    if (ts.isSpreadAssignment(member)) {
      throw new Error(`${filename}: source metadata cannot use object spreads`);
    }
    if (!member.name) continue;
    const key = member.name;
    if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) {
      if (ts.isComputedPropertyName(key)) {
        throw new Error(`${filename}: source fields must use static names`);
      }
      continue;
    }
    if (!["id", "key", "name", "version"].includes(key.text)) continue;
    if (fields.has(key.text)) {
      throw new Error(`${filename}: duplicate metadata field ${key.text}`);
    }
    const value = ts.isShorthandPropertyAssignment(member)
      ? member.name
      : member.initializer;
    if (!value) throw new Error(`${filename}: ${key.text} must be a string`);
    const literal = resolve(value);
    if (!ts.isStringLiteralLike(literal) || !literal.text.trim()) {
      throw new Error(
        `${filename}: ${key.text} must be a nonempty static string`,
      );
    }
    fields.set(key.text, literal.text);
  }

  const id = fields.get("id") ?? fields.get("key");
  if (!id || !/^[a-z][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`${filename}: invalid plugin ID`);
  }
  return {
    id,
    name: fields.get("name") ?? id,
    version: fields.get("version") ?? "0.0.0",
  };
}

function buildIndex(root, repository = "LuckyLxi/Sources", ref = "main") {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("Invalid GitHub repository; expected owner/repo");
  }
  const ids = new Set();
  const plugins = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".js"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => {
      if (!entry.isFile())
        throw new Error(`${entry.name}: expected a regular file`);
      const filename = path.join(root, entry.name);
      if (fs.statSync(filename).size > 8 * 1024 * 1024) {
        throw new Error(`${entry.name}: plugin exceeds 8 MiB`);
      }
      const metadata = readPluginMetadata(
        fs.readFileSync(filename, "utf8"),
        entry.name,
      );
      if (ids.has(metadata.id))
        throw new Error(`Duplicate plugin ID: ${metadata.id}`);
      ids.add(metadata.id);
      return {
        ...metadata,
        downloadUrl: `https://cdn.jsdelivr.net/gh/${repository}@${encodeURIComponent(ref)}/${encodeURIComponent(entry.name)}`,
      };
    });
  const indexPath = path.join(root, "plugins.json");
  const previous = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8")).plugins
    : [];
  if (!Array.isArray(previous))
    throw new Error("plugins.json must contain a plugins array");
  const positions = new Map(
    previous.map((plugin, position) => [plugin.id, position]),
  );
  // Keep installed-list ordering stable; append new plugins in filename order.
  plugins.sort(
    (a, b) =>
      (positions.get(a.id) ?? previous.length) -
      (positions.get(b.id) ?? previous.length),
  );
  return { schemaVersion: 1, plugins };
}

function updateIndex(root, { check = false, repository, ref } = {}) {
  const content =
    JSON.stringify(buildIndex(root, repository, ref), null, 2) + "\n";
  const filename = path.join(root, "plugins.json");
  const current = fs.existsSync(filename)
    ? fs.readFileSync(filename, "utf8")
    : "";
  if (current.replace(/\r\n/g, "\n") === content) return false;
  if (check)
    throw new Error(
      "plugins.json is stale; run npm --prefix dev run index:update",
    );
  fs.writeFileSync(filename, content, "utf8");
  return true;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--check"))
      throw new Error("Usage: update-plugin-index.cjs [--check]");
    const changed = updateIndex(ROOT, {
      check: args.includes("--check"),
      repository: process.env.GITHUB_REPOSITORY || "LuckyLxi/Sources",
    });
    console.log(
      changed ? "Updated plugins.json" : "plugins.json is up to date",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { readPluginMetadata, buildIndex, updateIndex };
