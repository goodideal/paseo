export function resolveMarkdownImageSource(input: {
  source: string;
  documentPath: string;
  workspaceRoot?: string;
}): { kind: "direct"; uri: string } | { kind: "file"; cwd: string; path: string } | null {
  const { source, documentPath, workspaceRoot } = input;
  if (!source) return null;

  // strip query and hash
  let cleanSource = source;
  const hashIdx = cleanSource.indexOf("#");
  if (hashIdx !== -1) cleanSource = cleanSource.substring(0, hashIdx);
  const queryIdx = cleanSource.indexOf("?");
  if (queryIdx !== -1) cleanSource = cleanSource.substring(0, queryIdx);

  if (!cleanSource) return null;

  if (
    cleanSource.startsWith("http://") ||
    cleanSource.startsWith("https://") ||
    cleanSource.startsWith("data:") ||
    cleanSource.startsWith("blob:")
  ) {
    return { kind: "direct", uri: source };
  }

  if (!workspaceRoot) {
    return null;
  }

  // Handle absolute path to workspace root
  if (cleanSource.startsWith("/")) {
    const relativeToRoot = cleanSource.substring(1);
    if (!isSafePath(relativeToRoot)) {
      return null;
    }
    return { kind: "file", cwd: workspaceRoot, path: relativeToRoot };
  }

  // Handle relative to document
  // documentPath is relative to workspaceRoot or we treat it as such for navigation
  const docParts = documentPath.split("/").filter(Boolean);
  docParts.pop(); // remove file name to get directory

  const targetParts = cleanSource.split("/").filter(Boolean);

  for (const part of targetParts) {
    if (part === ".") continue;
    if (part === "..") {
      if (docParts.length === 0) {
        // Traversal outside workspace root
        return null;
      }
      docParts.pop();
    } else {
      docParts.push(part);
    }
  }

  const finalPath = docParts.join("/");
  if (!isSafePath(finalPath)) return null;

  return { kind: "file", cwd: workspaceRoot, path: finalPath };
}

function isSafePath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  let depth = 0;
  for (const part of parts) {
    if (part === "..") {
      depth--;
      if (depth < 0) return false;
    } else if (part !== ".") {
      depth++;
    }
  }
  return depth >= 0;
}
