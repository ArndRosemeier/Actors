import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ZipEntry, centralDirectoryRange, decompress, localHeaderLength, parseCentralDirectory } from "./zip";

const localPath = (cacheDir: string, url: string) => join(cacheDir, url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._/-]/g, "_"));

/**
 * Downloads a file once into the cache directory (uses curl so the system's
 * proxy settings apply) and returns its local path.
 */
export function fetchCached(cacheDir: string, url: string): string {
  const local = localPath(cacheDir, url);
  if (!existsSync(local)) {
    mkdirSync(dirname(local), { recursive: true });
    console.log(`Downloading ${url}`);
    execFileSync("curl", ["-sSfL", "--retry", "5", "--retry-all-errors", "-o", local, url], { stdio: "inherit" });
  }
  return local;
}

export function fetchText(cacheDir: string, url: string): string {
  return readFileSync(fetchCached(cacheDir, url), "utf8");
}

function fetchRange(url: string, start: number, end: number): Buffer {
  return execFileSync("curl", ["-sSfL", "--retry", "5", "--retry-all-errors", "-r", `${start}-${end}`, url], { maxBuffer: 1 << 30 });
}

function fetchSize(url: string): number {
  const head = execFileSync("curl", ["-sSfLI", "--retry", "5", "--retry-all-errors", url]).toString();
  const sizes = [...head.matchAll(/content-length:\s*(\d+)/gi)].map((m) => +m[1]);
  if (!sizes.length) throw new Error(`No content length for ${url}`);
  return sizes[sizes.length - 1];
}

const directories = new Map<string, ZipEntry[]>();

function directory(url: string): ZipEntry[] {
  if (!directories.has(url)) {
    const size = fetchSize(url);
    const cd = centralDirectoryRange(fetchRange(url, Math.max(0, size - 65557), size - 1));
    directories.set(url, parseCentralDirectory(fetchRange(url, cd.offset, cd.offset + cd.size - 1), cd.count));
  }
  return directories.get(url)!;
}

/**
 * Fetches single files out of a large remote ZIP with HTTP range requests, so
 * an asset pack of several hundred MB costs only the files actually used.
 * Each extracted file is cached under .cache/<url>/<entry>.
 */
export function fetchZipEntry(cacheDir: string, url: string, entry: string): string {
  const local = join(localPath(cacheDir, url), entry);
  if (existsSync(local)) return local;
  const e = directory(url).find((x) => x.name === entry);
  if (!e) throw new Error(`${url} has no ${entry}`);
  console.log(`Downloading ${entry} from ${url}`);
  const start = e.localHeader + localHeaderLength(fetchRange(url, e.localHeader, e.localHeader + 29));
  const data = e.compressedSize ? decompress(e, fetchRange(url, start, start + e.compressedSize - 1)) : Buffer.alloc(0);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, data);
  return local;
}

export function fetchZipText(cacheDir: string, url: string, entry: string): string {
  return readFileSync(fetchZipEntry(cacheDir, url, entry), "utf8");
}
