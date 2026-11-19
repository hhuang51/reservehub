// Writes dist/version.json so anyone (and the pipeline) can see which
// commit a static site build came from: GET /version.json
import { writeFileSync } from "node:fs";

const info = {
  commit: process.env.RENDER_GIT_COMMIT || "unknown",
  service: process.env.RENDER_SERVICE_NAME || "local",
  builtAt: new Date().toISOString(),
};

writeFileSync("dist/version.json", `${JSON.stringify(info, null, 2)}\n`);
console.log("Wrote dist/version.json", info);
