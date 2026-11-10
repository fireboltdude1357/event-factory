// Quick look at the game: screenshots of the level list, a level before play,
// mid-run and after a win, at one viewport. No assertions.
//
//   node .agents/skills/verify/scripts/shots.mjs --url http://localhost:5391/ --out <dir> [--width 1280 --height 800] [--level 3]
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    level: { type: "string", default: "3" },
  },
})
if (!args.url || !args.out) throw new Error("--url and --out are required")
mkdirSync(args.out, { recursive: true })
const viewport = { width: Number(args.width), height: Number(args.height) }
const tag = String(viewport.width)

const browser = process.env.WIN_CHROME_CDP ? await chromium.connectOverCDP(process.env.WIN_CHROME_CDP) : await chromium.launch()
const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, deviceScaleFactor: viewport.width < 600 ? 2 : 1 })
const page = await context.newPage()
page.on("pageerror", (e) => console.log(`pageerror ${e}`))
page.on("console", (m) => m.type() === "error" && console.log(`console ${m.text()}`))
const shot = (name) => page.screenshot({ path: join(args.out, `${tag}-${name}.png`) })
await page.goto(args.url)
await page.locator("[data-level]").first().waitFor()
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
await shot("select")

await page.locator("[data-level]").nth(Number(args.level)).click()
await page.locator("canvas[data-cell]").waitFor()
await page.waitForTimeout(500)
await shot("level-empty")

await page.getByRole("button", { name: "Show solution" }).click()
await page.getByRole("button", { name: "Play", exact: true }).click()
await page.waitForTimeout(6500)
await shot("level-running")
await page.getByRole("button", { name: "8×" }).click()
await page.getByText(/^Level (complete|lost)/).first().waitFor({ timeout: 60_000 })
await page.waitForTimeout(450)
await shot("level-ending")
await page.waitForTimeout(1600)
await shot("level-won")

await context.close()
await browser.close()
