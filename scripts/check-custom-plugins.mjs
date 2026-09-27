import fs from "node:fs";
import path from "node:path";

const base = "plugin-custom";
const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;

// Read lucide icons to verify
const lucidePath = path.resolve("node_modules/lucide-react-native/dist/cjs/lucide-react-native.js");
const lucideContent = fs.readFileSync(lucidePath, "utf8");

function isValidLucideIcon(name) {
  if (!name || typeof name !== "string") return false;
  // Match export of the exact PascalCase name
  const regex = new RegExp(`exports\\.${name}\\s*=`);
  return regex.test(lucideContent);
}

for (const dir of fs.readdirSync(base)) {
  const p = path.join(base, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  console.log(`\n========================================`);
  console.log(`🔎 Auditing custom plugin: [${dir}]`);
  console.log(`========================================`);

  // 1. Check paseo-plugin.json
  const manifestPath = path.join(p, "paseo-plugin.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`  ❌ Missing paseo-plugin.json!`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!manifest.id || !CONTRIBUTION_ID.test(manifest.id)) {
        console.error(`  ❌ Manifest id "${manifest.id}" invalid`);
      } else {
        console.log(`  ✅ Manifest id: "${manifest.id}"`);
      }
      if (!manifest.requirements?.paseo) {
        console.warn(`  ⚠️ Manifest requirements.paseo missing`);
      } else {
        console.log(`  ✅ Manifest requirements: ${JSON.stringify(manifest.requirements)}`);
      }
    } catch (e) {
      console.error(`  ❌ Invalid JSON in paseo-plugin.json:`, e.message);
    }
  }

  // 2. Check index.server.ts
  const serverPath = path.join(p, "index.server.ts");
  if (fs.existsSync(serverPath)) {
    const serverCode = fs.readFileSync(serverPath, "utf8");
    const hasDefaultExport = /export\s+default\s+function\s+contribute\b/.test(serverCode);
    const returnsCleanup = /return\s+.*=>/.test(serverCode);
    console.log(`  index.server.ts:`);
    console.log(`    - default export contribute: ${hasDefaultExport ? "✅" : "❌"}`);
    console.log(
      `    - returns cleanup function: ${returnsCleanup ? "✅" : "⚠️ (optional for server but recommended)"}`,
    );
  }

  // 3. Check index.client.tsx
  const clientPath = path.join(p, "index.client.tsx");
  if (fs.existsSync(clientPath)) {
    const clientCode = fs.readFileSync(clientPath, "utf8");
    const hasDefaultExport = /export\s+default\s+function\s+contribute\b/.test(clientCode);
    const returnsCleanup = /return\s+.*=>/.test(clientCode);
    console.log(`  index.client.tsx:`);
    console.log(`    - default export contribute: ${hasDefaultExport ? "✅" : "❌"}`);
    console.log(`    - returns cleanup function: ${returnsCleanup ? "✅" : "❌ REQUIRED"}`);

    // Parse IDs
    for (const match of clientCode.matchAll(/\bid:\s*["']([^"']+)["']/g)) {
      const id = match[1];
      const valid = CONTRIBUTION_ID.test(id);
      console.log(
        `    - contribution id "${id}": ${valid ? "✅ VALID" : "❌ INVALID (must match /^[a-z][a-z0-9-]*$/)"}`,
      );
    }

    // Parse Icons
    for (const match of clientCode.matchAll(/\bicon:\s*["']([^"']+)["']/g)) {
      const icon = match[1];
      const valid = isValidLucideIcon(icon);
      console.log(
        `    - icon "${icon}": ${valid ? "✅ VALID Lucide icon" : "❌ INVALID Lucide icon (will crash runtime!)"}`,
      );
    }
  }
}
