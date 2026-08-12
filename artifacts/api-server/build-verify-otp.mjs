import { build } from "esbuild";
import { resolve } from "path";

await build({
  entryPoints: ["src/scripts/verify-otp-attendance.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/verify-otp-attendance.mjs",
  external: [],
  packages: "bundle",
  alias: {
    "@workspace/db": resolve("../../lib/db/src/index.ts"),
    "@workspace/db/schema": resolve("../../lib/db/src/schema/index.ts"),
  },
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
  sourcemap: true,
});
console.log("Build OK → dist/verify-otp-attendance.mjs");
