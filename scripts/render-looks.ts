/**
 * Regenerates the README gallery (docs/looks) from the fictional demo profile:
 *   npm run looks
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildView, demoProfile, LOOK_IDS, LOOKS, SCHEMES } from "@readmeops/core";

const view = buildView(demoProfile(new Date("2026-09-26T12:00:00Z")));
const dir = new URL("../docs/looks/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const look of LOOK_IDS) {
  for (const scheme of SCHEMES) {
    writeFileSync(new URL(`${look}-${scheme}.svg`, dir), LOOKS[look].render("profile", view, scheme));
  }
}
console.log(`wrote ${LOOK_IDS.length * SCHEMES.length} files to docs/looks`);
