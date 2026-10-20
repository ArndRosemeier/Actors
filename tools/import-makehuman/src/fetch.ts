import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Downloads a file once into the cache directory (uses curl so the system's
 * proxy settings apply) and returns its local path.
 */
export function fetchCached(cacheDir: string, url: string): string {
  const local = join(cacheDir, url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._/-]/g, "_"));
  if (!existsSync(local)) {
    mkdirSync(dirname(local), { recursive: true });
    console.log(`Downloading ${url}`);
    execFileSync("curl", ["-sSfL", "--retry", "3", "-o", local, url], { stdio: "inherit" });
  }
  return local;
}

export function fetchText(cacheDir: string, url: string): string {
  return readFileSync(fetchCached(cacheDir, url), "utf8");
}
