import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CliPackageJson {
  version?: unknown;
}

function getModTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function formatDisplayCliVersion(rawVersion: string): string {
  const value = rawVersion.trim();
  const bracketMatch = value.match(
    /^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)\s*\[(?:mod-|m)?([^\]]+)\]$/i,
  );
  if (bracketMatch) {
    return `v${bracketMatch[1]} [mod-${bracketMatch[2]}]`;
  }

  const customTimestampMatch = value.match(
    /^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)-custom[.-](?:mod-)?(\d{6}|\w+)$/i,
  );
  if (customTimestampMatch) {
    return `v${customTimestampMatch[1]} [mod-${customTimestampMatch[2]}]`;
  }

  const genericCustomMatch = value.match(/^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)-custom$/i);
  if (genericCustomMatch) {
    return `v${genericCustomMatch[1]} [mod-${getModTimestamp()}]`;
  }

  return value.startsWith("v") ? value : `v${value}`;
}

export function resolveCliVersion(): string {
  const packageJson = require("../package.json") as CliPackageJson;
  if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
    return packageJson.version.trim();
  }
  throw new Error("Unable to resolve @getpaseo/cli version from package.json.");
}
