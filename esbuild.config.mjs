import * as esbuild from "esbuild";
import { createRequire } from "module";

const pkg = createRequire(import.meta.url)("./package.json");

await esbuild.build({
  entryPoints: ["src/skill/teo-run-entry.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "bin/teo-run.js",
  external: ["node:*"],
  define: { TEO_VERSION: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
  sourcemap: "external",
});
