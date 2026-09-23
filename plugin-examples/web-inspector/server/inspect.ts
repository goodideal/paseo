import { chromium } from "playwright";
import { searchInspectorRpc, type InspectOutput } from "../shared/inspect";
import type { PluginAttachmentSearchPayload } from "@getpaseo/plugin";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { authSettings } from "../shared/settings";

type AuthSettings = typeof authSettings.schema;

export async function handleInspectUrl(
  input: { url: string },
  settings: PluginSettings<AuthSettings>,
): Promise<InspectOutput> {
  const browser = await chromium.launch({ headless: true });
  const contextOptions: Parameters<typeof browser.newContext>[0] = {};

  const state = await settings.read();
  if (state.status === "ready") {
    if (state.values.extraHeaders) {
      try {
        const headers = JSON.parse(state.values.extraHeaders);
        contextOptions.extraHTTPHeaders = headers;
      } catch (e) {
        // Skip invalid JSON headers
      }
    }
  }

  const context = await browser.newContext(contextOptions);

  if (state.status === "ready" && state.values.cookieString) {
    try {
      const urlObj = new URL(input.url);
      const domain = urlObj.hostname;
      const cookies = state.values.cookieString.split(";").map((c) => {
        const [name, ...rest] = c.trim().split("=");
        return {
          name,
          value: rest.join("="),
          domain,
          path: "/",
        };
      });
      await context.addCookies(cookies);
    } catch (e) {
      // Ignore invalid cookies or URL
    }
  }

  const page = await context.newPage();

  const consoleLogs: InspectOutput["consoleLogs"] = [];
  const networkErrors: InspectOutput["networkErrors"] = [];

  page.on("console", (msg) => {
    const type = msg.type();
    let mappedType: "log" | "warn" | "error" | "info" | "debug" = "log";
    if (["warning"].includes(type)) mappedType = "warn";
    else if (["error"].includes(type)) mappedType = "error";
    else if (["info"].includes(type)) mappedType = "info";
    else if (["debug"].includes(type)) mappedType = "debug";

    consoleLogs.push({
      type: mappedType,
      text: msg.text(),
      location: msg.location().url
        ? `${msg.location().url}:${msg.location().lineNumber}`
        : undefined,
    });
  });

  page.on("response", (res) => {
    if (res.status() >= 400) {
      networkErrors.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
        method: res.request().method(),
      });
    }
  });

  try {
    await page.goto(input.url, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) {
    consoleLogs.push({
      type: "error",
      text: `Navigation failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const screenshotBuffer = await page.screenshot({ fullPage: false, type: "jpeg", quality: 80 });
  const screenshotBase64 = screenshotBuffer.toString("base64");

  await browser.close();

  return {
    url: input.url,
    screenshotBase64,
    consoleLogs,
    networkErrors,
    diagnostics: `Found ${consoleLogs.filter((l) => l.type === "error").length} console errors and ${networkErrors.length} network errors.`,
  };
}

export async function handleAttachmentSearch(
  input: { query: string },
  settings: PluginSettings<AuthSettings>,
): Promise<PluginAttachmentSearchPayload> {
  if (!input.query.startsWith("http")) {
    return { items: [] };
  }

  const data = await handleInspectUrl({ url: input.query }, settings);

  let text = `## Web Diagnostics Report for ${data.url}\n\n`;

  const errors = data.consoleLogs.filter((l) => l.type === "error");
  if (errors.length > 0) {
    text += `### Console Errors (${errors.length})\n`;
    for (const err of errors) {
      text += `- \`${err.text}\` ${err.location ? `(at ${err.location})` : ""}\n`;
    }
    text += `\n`;
  }

  if (data.networkErrors.length > 0) {
    text += `### Failed Network Requests (${data.networkErrors.length})\n`;
    for (const net of data.networkErrors) {
      text += `- \`${net.method} ${net.url}\` -> **${net.status} ${net.statusText}**\n`;
    }
    text += `\n`;
  }

  if (errors.length === 0 && data.networkErrors.length === 0) {
    text += `No console errors or failed network requests detected.\n`;
  }

  return {
    items: [
      {
        id: `web-diag-${Date.now()}`,
        identifier: data.url,
        title: `Diagnostics: ${data.url}`,
        subtitle: data.diagnostics,
        url: data.url,
        text,
        resourceType: "Web Diagnostics",
      },
    ],
  };
}
