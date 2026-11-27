// Repo-specific oxlint rules. Each rule is its own name, so its burn-down list in .oxlintrc.json
// is one override that cannot interact with the `no-restricted-imports` burn-downs.

const PRESS_PRIMITIVE_SOURCES = new Set(["react-native", "react-native-gesture-handler"]);
const PRESS_PRIMITIVE_NAMES = new Set([
  "Pressable",
  "TouchableHighlight",
  "TouchableNativeFeedback",
  "TouchableOpacity",
  "TouchableWithoutFeedback",
]);

export const NO_RAW_PRESSABLE_MESSAGE =
  "A raw pressable has no standard press or hover feedback. Icon actions use ToolbarButton " +
  "(@/components/ui/pane-content-toolbar); rows on a menu surface use MenuItem or " +
  "ComposerTrackRow; other rows use PressHighlight (@/components/ui/press-highlight); labelled " +
  "buttons use Button. See docs/design.md §2.";

const noRawPressable = {
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!PRESS_PRIMITIVE_SOURCES.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            PRESS_PRIMITIVE_NAMES.has(specifier.imported.name)
          ) {
            context.report({ node: specifier, message: NO_RAW_PRESSABLE_MESSAGE });
          }
        }
      },
    };
  },
};

const SYNC_IO_MODULES = new Set(["fs", "node:fs", "child_process", "node:child_process"]);

function propertyName(node) {
  return node.type === "Identifier" ? node.name : node.value;
}

function findDefinition(node, sourceCode) {
  let scope = sourceCode.getScope(node);
  while (scope && !scope.set.has(node.name)) scope = scope.upper;
  return scope?.set.get(node.name)?.defs[0];
}

function isIoNamespaceImport(definition) {
  if (definition?.node.type === "TSImportEqualsDeclaration") {
    return SYNC_IO_MODULES.has(definition.node.moduleReference.expression?.value);
  }
  if (definition?.type !== "ImportBinding") return false;
  return (
    (definition.node.type !== "ImportSpecifier" ||
      propertyName(definition.node.imported) === "default") &&
    SYNC_IO_MODULES.has(definition.parent.source.value)
  );
}

// Follow only immutable namespace aliases. Resolve bindings rather than spelling so a parameter
// named `fs` is not mistaken for the imported namespace.
function isIoNamespace(node, sourceCode, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node.type === "AwaitExpression") return isIoNamespace(node.argument, sourceCode, seen);
  if (node.type === "ImportExpression") return SYNC_IO_MODULES.has(node.source.value);
  if (node.type === "CallExpression") {
    return (
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      SYNC_IO_MODULES.has(node.arguments[0]?.value)
    );
  }
  if (node.type !== "Identifier") return false;
  const definition = findDefinition(node, sourceCode);
  if (isIoNamespaceImport(definition)) return true;
  return (
    definition?.type === "Variable" &&
    definition.parent.kind === "const" &&
    definition.node.id.type === "Identifier" &&
    isIoNamespace(definition.node.init, sourceCode, seen)
  );
}

const noSyncIo = {
  meta: {
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const relativeFile = filename.split("/packages/server/src/")[1];
    const allowed = new Set(context.options[0]?.allow?.[relativeFile] ?? []);
    const unused = new Set(allowed);
    function check(node, name) {
      if (typeof name !== "string" || !name.endsWith("Sync")) return;
      if (allowed.has(name)) {
        unused.delete(name);
        return;
      }
      context.report({
        node,
        message: `Synchronous Node IO (${name}) blocks the daemon event loop. Use an asynchronous capability at the owning module boundary.`,
      });
    }
    return {
      "Program:exit"(node) {
        for (const name of unused) {
          context.report({ node, message: `Remove the unused sync IO exception for ${name}.` });
        }
      },
      ImportDeclaration(node) {
        if (node.importKind === "type" || !SYNC_IO_MODULES.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
            check(specifier, propertyName(specifier.imported));
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type" || !SYNC_IO_MODULES.has(node.source?.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.exportKind !== "type") check(specifier, propertyName(specifier.local));
        }
      },
      MemberExpression(node) {
        if (node.computed && node.property.type !== "Literal") return;
        const name = propertyName(node.property);
        if (typeof name !== "string" || !name.endsWith("Sync")) return;
        if (isIoNamespace(node.object, context.sourceCode)) {
          check(node.property, name);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !isIoNamespace(node.init, context.sourceCode)) {
          return;
        }
        for (const property of node.id.properties) {
          if (property.type === "Property") check(property, propertyName(property.key));
        }
      },
    };
  },
};

const VAGUE_FILENAME_PATTERN =
  /^(.+)-(utils|helpers|manager|controller)(?:\.(?:web|native|electron|ios|android|test|spec))*\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const DECORATIVE_DIVIDER_PATTERN = /={5,}/;
const BLOCK_DIVIDER_LINE_PATTERN = /^\s*(?:\*\s*)?={5,}\s*$/;

function stripCommentLinePrefix(line) {
  return line.replace(/^\s*(?:\*\s*)?/, "").trim();
}

function isDecorativeDividerComment(comment) {
  if (typeof comment?.value !== "string") {
    return false;
  }
  if (comment.type === "Line") {
    return DECORATIVE_DIVIDER_PATTERN.test(comment.value);
  }
  const lines = comment.value.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!BLOCK_DIVIDER_LINE_PATTERN.test(lines[i])) {
      continue;
    }
    const prevContent = i > 0 ? stripCommentLinePrefix(lines[i - 1]) : "";
    const isSetextUnderline = prevContent.length > 0 && !/^={5,}$/.test(prevContent);
    if (!isSetextUnderline) {
      return true;
    }
  }
  return false;
}

export function formatVagueFilenameMessage(filename, suffix) {
  return `Filename "${filename}" ends with vague suffix "-${suffix}". Rename it to a domain-specific noun such as "-catalog", "-resolver", "-store", or "-policy" (see docs/coding-standards.md).`;
}

export const NO_DECORATIVE_DIVIDER_MESSAGE =
  "Decorative divider comments (5+ consecutive '=') are prohibited. Use modules and cohesive functions to organize code instead (see docs/coding-standards.md).";

const noVagueFilename = {
  create(context) {
    const filename = (context.filename ?? "").replaceAll("\\", "/");
    const basename = filename.split("/").pop() ?? "";
    const match = VAGUE_FILENAME_PATTERN.exec(basename);
    if (!match) {
      return {};
    }
    const suffix = match[2];
    return {
      Program(node) {
        context.report({
          node,
          message: formatVagueFilenameMessage(basename, suffix),
        });
      },
    };
  },
};

const noDecorativeDivider = {
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode?.getAllComments?.() ?? [];
        for (const comment of comments) {
          if (isDecorativeDividerComment(comment)) {
            context.report({
              loc: comment.loc,
              message: NO_DECORATIVE_DIVIDER_MESSAGE,
            });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: "paseo" },
  rules: {
    "no-raw-pressable": noRawPressable,
    "no-sync-io": noSyncIo,
    "no-vague-filename": noVagueFilename,
    "no-decorative-divider": noDecorativeDivider,
  },
};
