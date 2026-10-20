#!/usr/bin/env node
// Downloads the asset packs that match this @actors/generator version and unpacks them.
//
//   npx actors-packs                 -> ./public/packs  (load "/packs/human/manifest.json")
//   npx actors-packs static/packs    -> another folder
//   npx actors-packs --version 0.1.0 -> another release
//
// The archive is release asset actors-packs-<version>.tar.gz on github.com/ArndRosemeier/Actors.
// It is large (the whole wardrobe, hair and the CMU mocap library), so it is fetched once, on demand.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log("usage: actors-packs [dest=public/packs] [--version <x.y.z>] [--force]");
  process.exit(0);
}
const vi = args.indexOf("--version");
const own = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;
const version = vi >= 0 ? args[vi + 1] : own;
const dest = resolve(args.find((a, i) => !a.startsWith("-") && (vi < 0 || i !== vi + 1)) ?? "public/packs");
const force = args.includes("--force");

const stamp = join(dest, ".actors-packs-version");
if (!force && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  console.log(`${dest} already has the ${version} packs (--force to download again)`);
  process.exit(0);
}

// Only replace a folder this tool filled before (or an empty one), never someone's own files.
if (existsSync(dest) && !existsSync(stamp) && readdirSync(dest).length > 0 && !force) {
  console.error(`${dest} is not empty and was not created by actors-packs; pick another folder or pass --force`);
  process.exit(1);
}

// ACTORS_PACKS_BASE swaps in a mirror that serves the same v<version>/actors-packs-<version>.tar.gz paths.
const base = process.env.ACTORS_PACKS_BASE ?? "https://github.com/ArndRosemeier/Actors/releases/download";
const url = `${base}/v${version}/actors-packs-${version}.tar.gz`;
console.log(`downloading ${url}`);
const res = await fetch(url);
if (!res.ok || !res.body) {
  console.error(`download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const total = Number(res.headers.get("content-length")) || 0;
let done = 0;
let shown = -1;
const body = Readable.fromWeb(res.body);
body.on("data", (chunk) => {
  done += chunk.length;
  const pct = total ? Math.floor((done / total) * 100) : -1;
  if (pct !== shown && pct % 10 === 0 && process.stdout.isTTY) {
    shown = pct;
    process.stdout.write(`\r${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
  }
});
const archive = join(tmpdir(), `actors-packs-${version}-${process.pid}.tar.gz`);
await pipeline(body, createWriteStream(archive));
if (process.stdout.isTTY) process.stdout.write("\n");

// The archive holds packs/<actor>/...; strip "packs/" so it lands in dest.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
execFileSync("tar", ["-xzf", archive, "-C", dest, "--strip-components=1"], { stdio: "inherit" });
rmSync(archive, { force: true });
writeFileSync(stamp, version + "\n");
console.log(`unpacked to ${dest}`);
