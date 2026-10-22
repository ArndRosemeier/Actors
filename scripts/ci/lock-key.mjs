// Prints a hash of package-lock.json that ignores our own package versions, for the
// CI pack cache key: a release bump changes only those, and must not rebuild the packs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path.startsWith("node_modules/")) continue; // installed packages keep their versions
  delete entry.version; // the root and our workspace packages
  for (const field of ["dependencies", "devDependencies", "peerDependencies"])
    for (const name of Object.keys(entry[field] ?? {})) if (name.startsWith("@actors/")) entry[field][name] = "*";
}
delete lock.version;
console.log(createHash("sha256").update(JSON.stringify(lock)).digest("hex"));
