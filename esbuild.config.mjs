import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/skill/teo-run-entry.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "bin/teo-run.js",
  external: ["node:*"],
  define: { TEO_VERSION: JSON.stringify("1.0.0") },
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
});
