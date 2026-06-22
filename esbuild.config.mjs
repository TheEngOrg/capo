import * as esbuild from "esbuild";
import { chmodSync } from "node:fs";

await esbuild.build({
  entryPoints: ["src/skill/teo-run-entry.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "bin/teo-run.js",
  external: ["node:*"],
  define: { TEO_VERSION: JSON.stringify("0.1.0") },
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
});
chmodSync("bin/teo-run.js", 0o755);
