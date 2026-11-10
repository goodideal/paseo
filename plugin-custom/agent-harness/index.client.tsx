import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(_client: PluginClientContext) {
  // Settings UI is intentionally deferred; server-side routing is active.
  // A dedicated settings screen will surface enable/disable and debug toggle in the future.
  return () => {};
}
