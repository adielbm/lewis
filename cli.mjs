#!/usr/bin/env node
import process from "node:process";

const disabledMessage = [
  "CLI generation is currently disabled.",
  "Use the browser UI instead:",
  "1. Open index.html in a browser.",
  "2. Paste your DSL input.",
  "3. Click Generate SVG and then Download SVG.",
].join("\n");

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  process.stdout.write(`${disabledMessage}\n`);
  process.exitCode = 0;
} else {
  process.stderr.write(`${disabledMessage}\n`);
  process.exitCode = 1;
}
