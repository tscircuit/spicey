import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const packageDirectory = path.resolve(import.meta.dirname, "..")
const stagingDirectory = mkdtempSync(path.join(tmpdir(), "spicey-build-"))
const circuitJsonPackagePath = Bun.resolveSync(
  "circuit-json/package.json",
  packageDirectory,
)
const dependenciesDirectory = path.dirname(path.dirname(circuitJsonPackagePath))

try {
  cpSync(
    path.join(packageDirectory, "lib"),
    path.join(stagingDirectory, "lib"),
    { recursive: true },
  )
  cpSync(
    path.join(packageDirectory, "tsconfig.json"),
    path.join(stagingDirectory, "tsconfig.json"),
  )
  symlinkSync(
    dependenciesDirectory,
    path.join(stagingDirectory, "node_modules"),
    "dir",
  )

  const buildResult = Bun.spawnSync({
    cmd: ["bun", "run", "build"],
    cwd: packageDirectory,
    env: {
      ...process.env,
      SPICEY_BUILD_ROOT: stagingDirectory,
      SPICEY_BUILD_OUTPUT: path.join(packageDirectory, "dist"),
    },
    stdout: "inherit",
    stderr: "inherit",
  })

  if (buildResult.exitCode !== 0) {
    throw new Error(
      `Unable to prepare spicey package (exit ${buildResult.exitCode})`,
    )
  }
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true })
}
