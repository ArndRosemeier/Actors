// Character load benchmark: opens bench.html headless and prints the timings.
// Usage: node scripts/bench.mjs [url]   e.g. http://localhost:5173/bench.html?n=6&compile
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:5173/bench.html";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => {
  console.error("page error:", String(e));
  process.exit(1);
});
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__bench?.done, null, { timeout: 900000, polling: 1000 });
const results = await page.evaluate(() => window.__bench.results);
console.table(results);
await browser.close();
