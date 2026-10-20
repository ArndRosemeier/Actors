#!/usr/bin/env node
// Installs the release tarballs into a fresh Vite + TypeScript app outside the monorepo and checks
// that it typechecks and builds, the way another project would use @actors/generator.
//
//   node scripts/release/check-consumer.mjs [appDir]
//
// Runs `build.mjs --local` first, so the internal dependencies come from the local tarballs.
// Keeps the app in appDir (default: a temp folder) so it can be served for a manual look.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run(process.execPath, [join(root, "scripts/release/build.mjs"), "--local"], root);

const version = JSON.parse(readFileSync(join(root, "packages/generator/package.json"), "utf8")).version;
const devVersion = (name) => {
  const pkg = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  return pkg.version;
};

const app = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "actors-consumer-"));
mkdirSync(join(app, "src"), { recursive: true });
writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "actors-consumer-check",
      private: true,
      type: "module",
      dependencies: {
        "@actors/generator": `file:${join(root, "release", `actors-generator-${version}.tgz`)}`,
        three: devVersion("three"),
      },
      devDependencies: {
        "@types/three": devVersion("@types/three"),
        typescript: devVersion("typescript"),
        vite: devVersion("vite"),
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(app, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: false, types: ["vite/client"], lib: ["ES2022", "DOM"] },
    include: ["src"],
  }),
);
writeFileSync(
  join(app, "index.html"),
  `<!doctype html><html><body style="margin:0;display:flex;height:100vh"><div id="view" style="flex:1"></div><div id="panel" style="width:320px;overflow:auto"></div><script type="module" src="/src/main.ts"></script></body></html>\n`,
);
writeFileSync(
  join(app, "src/main.ts"),
  `import { createCharacterGenerator, type CharacterConfig } from "@actors/generator";
import { ActorRuntime } from "@actors/core";
import { sanitizeParams } from "@actors/human";
import HumanWorker from "@actors/human/worker?worker";

async function main(): Promise<void> {
const pack = new URLSearchParams(location.search).get("pack") ?? "/packs/human/manifest.json";
const { character } = await createCharacterGenerator({
  pack,
  view: document.getElementById("view")!,
  panel: document.getElementById("panel")!,
  worker: new HumanWorker(),
});
const config: CharacterConfig = character.config;
console.log("loaded", typeof ActorRuntime, typeof sanitizeParams, Object.keys(config).length);
await character.wear("casual");
await character.play("walk");
(window as unknown as { ready: boolean }).ready = true;
}
main().catch((e) => console.error(e));
`,
);

// --install-links copies the file: tarballs instead of linking, like a registry install.
run("npm", ["install", "--no-audit", "--no-fund", "--install-links"], app);
run(join(app, "node_modules/.bin/tsc"), ["-p", "."], app);
run(join(app, "node_modules/.bin/vite"), ["build", "--logLevel", "warn"], app);
console.log(`consumer app OK: ${app}`);
