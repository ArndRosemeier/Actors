#!/usr/bin/env node
// Builds the installable packages (@actors/core, human, animal, drone, three, generator) into release/.
//
// For each package: esbuild bundles every `exports` entry into dist/*.js (three and the other
// @actors packages stay external), tsc writes the .d.ts files, and a package.json pointing at
// dist/ is written next to them. `npm pack` then makes release/actors-<name>-<version>.tgz.
//
// Internal dependencies point at the sibling tarballs on the GitHub release (v<version>), so an
// app only installs @actors/generator and npm fetches the rest. `--local` points them at the
// local tarballs instead (used by check-consumer.mjs before a release exists).
// If the asset packs were imported (apps/viewer/public/packs), they are archived as
// release/actors-packs-<version>.tar.gz for `npx actors-packs`.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "release");
const stageRoot = join(out, "stage");
const local = process.argv.includes("--local");
const REPO = "https://github.com/ArndRosemeier/Actors";

// Dependency order: each package's types are built before the packages that import it.
const PACKAGES = ["core", "human", "animal", "drone", "three", "generator"];
const DESCRIPTIONS = {
  core: "Renderer-free actor runtime: pack format, morphs, skeleton and garment fitting, clip retargeting, Web Worker evaluation.",
  human: "Adult human actor on the MakeHuman CC0 assets: macro and detail sliders, races, expressions, worker entry.",
  animal: "Generated animal actors (dog breeds and squirrels on a shared CC0 quadruped rig, deer on Quaternius' CC0 deer rig): shape sliders, coats, clips, worker entry.",
  drone: "Procedural futuristic drones from building blocks: roles, palettes, rotor rigs and opt-in weapons.",
  three: "three.js adapter for Actors: skinned meshes, skin/eye/cloth materials, dual-quaternion skinning, clip playback.",
  generator: "Reusable three.js character generator: one JSON config for shape, looks, outfit and animation, plus stage, editor and glTF export.",
};

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const pkgs = PACKAGES.map((dir) => ({ dir, src: join(root, "packages", dir), json: readJson(join(root, "packages", dir, "package.json")) }));
const version = pkgs[0].json.version;
for (const p of pkgs) {
  if (p.json.version !== version) throw new Error(`${p.json.name} is ${p.json.version}, expected ${version}: keep all package versions equal`);
}

const tarball = (name) => `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
const depSpec = (name) => (local ? `file:${join(out, tarball(name))}` : `${REPO}/releases/download/v${version}/${tarball(name)}`);
const isInternal = (name) => name.startsWith("@actors/");

rmSync(out, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

for (const p of pkgs) {
  const stage = join(stageRoot, p.dir);
  const dist = join(stage, "dist");
  mkdirSync(dist, { recursive: true });

  // "./worker": "./src/worker.ts" -> dist/worker.js + dist/worker.d.ts
  const entries = Object.entries(p.json.exports).map(([key, file]) => {
    const base = file.replace(/^\.\/src\//, "").replace(/\.ts$/, "");
    return { key, file: join(p.src, file), js: `./dist/${base}.js`, dts: `./dist/${base}.d.ts` };
  });

  await build({
    entryPoints: Object.fromEntries(entries.map((e) => [e.js.slice("./dist/".length, -3), e.file])),
    outdir: dist,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    sourcemap: true,
    external: ["three", "three/*", "@actors/*"],
    logLevel: "warning",
  });

  // Declarations: resolve the other @actors packages to their already-built .d.ts files.
  const paths = {};
  for (const q of pkgs) {
    for (const [key, file] of Object.entries(q.json.exports)) {
      const spec = key === "." ? q.json.name : `${q.json.name}/${key.slice(2)}`;
      paths[spec] = [join(stageRoot, q.dir, "dist", file.replace(/^\.\/src\//, "").replace(/\.ts$/, ".d.ts"))];
    }
  }
  const tsconfig = join(stage, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      compilerOptions: { declaration: true, emitDeclarationOnly: true, noEmit: false, rootDir: join(p.src, "src"), outDir: dist, types: [], paths },
      include: [join(p.src, "src")],
      exclude: [join(p.src, "src/**/*.test.ts")],
    }),
  );
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", tsconfig], { stdio: "inherit" });
  rmSync(tsconfig);

  const rewrite = (deps) => deps && Object.fromEntries(Object.entries(deps).map(([n, v]) => [n, isInternal(n) ? depSpec(n) : v]));
  const manifest = {
    name: p.json.name,
    version,
    description: DESCRIPTIONS[p.dir],
    license: "MIT",
    type: "module",
    repository: { type: "git", url: `git+${REPO}.git`, directory: `packages/${p.dir}` },
    homepage: `${REPO}#readme`,
    main: entries[0].js,
    types: entries[0].dts,
    exports: Object.fromEntries(entries.map((e) => [e.key, { types: e.dts, import: e.js, default: e.js }])),
    files: ["dist", "bin", "README.md", "LICENSE", "NOTICE-ASSETS.md"],
    ...(existsSync(join(p.src, "bin")) ? { bin: Object.fromEntries(Object.entries(p.json.bin ?? {})) } : {}),
    dependencies: rewrite(p.json.dependencies),
    peerDependencies: p.json.peerDependencies,
  };
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (existsSync(join(p.src, "bin"))) cpSync(join(p.src, "bin"), join(stage, "bin"), { recursive: true });
  for (const f of ["README.md"]) if (existsSync(join(p.src, f))) cpSync(join(p.src, f), join(stage, f));
  for (const f of ["LICENSE", "NOTICE-ASSETS.md"]) cpSync(join(root, f), join(stage, f));

  execFileSync("npm", ["pack", "--silent", "--pack-destination", out], { cwd: stage, stdio: ["ignore", "ignore", "inherit"] });
  console.log(`release/${tarball(p.json.name)}`);
}

const packs = join(root, "apps/viewer/public/packs");
if (local) {
  // check-consumer.mjs loads the assets from the dev server or the hosted packs.
} else if (existsSync(join(packs, "human/manifest.json"))) {
  const archive = join(out, `actors-packs-${version}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", dirname(packs), "packs"], { stdio: "inherit" });
  console.log(relative(root, archive));
} else {
  console.log("no imported packs (run `npm run import:human`), skipped the asset archive");
}
