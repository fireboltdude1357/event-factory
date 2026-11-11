// The browser drive.mjs and shots.mjs use. It launches the machine's Chromium (CHROME_PATH, default
// /usr/sbin/chromium) headless with flags that render on the GPU, plus any in CHROME_ARGS, split on
// spaces. Without the flags headless Chromium renders on SwiftShader. WIN_CHROME_CDP=<url> connects
// to a running Chrome over CDP instead.
import { chromium } from "playwright-core"

export const browser = process.env.WIN_CHROME_CDP
  ? await chromium.connectOverCDP(process.env.WIN_CHROME_CDP)
  : await chromium.launch({
      executablePath: process.env.CHROME_PATH ?? "/usr/sbin/chromium",
      args: ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", ...(process.env.CHROME_ARGS ?? "").split(" ").filter(Boolean)],
    })
