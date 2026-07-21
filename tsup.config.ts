import path from "node:path"
import { defineConfig } from "tsup"

const projectDirectory = process.env.SPICEY_BUILD_ROOT ?? import.meta.dirname
const outputDirectory =
  process.env.SPICEY_BUILD_OUTPUT ?? path.join(projectDirectory, "dist")

export default defineConfig({
  entry: [path.join(projectDirectory, "lib/index.ts")],
  format: ["esm"],
  external: ["circuit-json"],
  dts: true,
  outDir: outputDirectory,
  tsconfig: path.join(projectDirectory, "tsconfig.json"),
  esbuildOptions(options) {
    options.alias = {
      lib: path.join(projectDirectory, "lib"),
    }
  },
})
