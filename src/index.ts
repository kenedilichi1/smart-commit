#!/usr/bin/env node

import { styleText, parseArgs } from "node:util";
import { createRequire } from "node:module";
import commit from "./commands/commit.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

// Handle help documentation natively
if (values.help) {
  console.log(styleText("cyan", "\n🤖 AI Commit CLI"));
  console.log("\nUsage:\n  ai-commit");
  console.log(
    "\nOptions:\n  -h, --help     Show this help documentation\n  -v, --version  Show current version",
  );
  process.exit(0);
}

// Handle version dynamically from package.json
if (values.version) {
  console.log(version);
  process.exit(0);
}

console.log(styleText("yellow", "\n========================================"));
console.log(styleText("yellow", "           🤖 AI COMMIT CLI             "));
console.log(styleText("yellow", "========================================"));

try {
  await commit.handler();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(styleText("red", `\n❌ Execution Error: ${message}`));
  process.exit(1);
}
