import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite"

const repoRoot = path.resolve(import.meta.dirname, "../..")
const packDir = path.resolve(repoRoot, process.env.EVENT_FACTORY_PACK ?? "packs/order-processing")
const virtualId = "virtual:pack"
const resolvedVirtualId = `\0${virtualId}`

// `import pack from "virtual:pack"` is the default export of the chosen pack's
// pack.ts. EVENT_FACTORY_PACK swaps the domain without touching app code.
function packPlugin(): Plugin {
  return {
    name: "event-factory-pack",
    resolveId: (id) => (id === virtualId ? resolvedVirtualId : undefined),
    load: (id) =>
      id === resolvedVirtualId ? `export { default } from ${JSON.stringify(path.join(packDir, "pack.ts"))}` : undefined,
  }
}

export default defineConfig({
  plugins: [packPlugin(), react(), tailwindcss()],
  // A pack outside the repo still gets this app's copy of the engine.
  resolve: { dedupe: ["@event-factory/engine", "effect"] },
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), packDir] } },
})
