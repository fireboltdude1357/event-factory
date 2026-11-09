// Drives the running game through its real UI and writes screenshots,
// a recording and results.json to --out. Exit 1 when any step fails.
//
//   node .agents/skills/verify/scripts/drive.mjs --url http://localhost:5391 --out .verify/runs/<id>/artifacts [--flow all|levels|build|inspect]
//
// Connects to WIN_CHROME_CDP when set (stl-wsl), otherwise launches the
// local Playwright Chromium.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string" },
    flow: { type: "string", default: "all" },
  },
})
if (!args.url || !args.out) throw new Error("--url and --out are required")
const flows = { levels: levelsFlow, build: buildFlow, inspect: inspectFlow }
if (args.flow !== "all" && !Object.hasOwn(flows, args.flow))
  throw new Error(`unknown --flow ${args.flow}; expected all|${Object.keys(flows).join("|")}`)
mkdirSync(args.out, { recursive: true })

const browser = process.env.WIN_CHROME_CDP
  ? await chromium.connectOverCDP(process.env.WIN_CHROME_CDP)
  : await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: join(args.out, "video"), size: { width: 1280, height: 800 } },
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

const results = []
const record = (step, ok, detail) => {
  results.push({ step, ok, detail })
  console.log(`${ok ? "pass" : "FAIL"} ${step}: ${detail}`)
}
const shot = (name) => page.screenshot({ path: join(args.out, `${name}.png`) })
const button = (name) => page.getByRole("button", { name })
const appears = (locator) => locator.waitFor({ timeout: 2000 }).then(() => true, () => false)

const openLevel = async (index) => {
  await page.goto(args.url)
  await page.getByText("Start level").nth(index).click()
  await page.locator("canvas").first().waitFor()
}

// Waits for the HUD banner. The game halts the clock when a level finishes.
const outcome = async () => {
  const banner = page.getByText(/^(Level complete|Level lost)/)
  await banner.waitFor({ timeout: 60_000 })
  return banner.innerText()
}

const cellCenter = async (x, y, width) => {
  const box = await page.locator("canvas").first().boundingBox()
  const c = box.width / width
  return { x: box.x + (x + 0.5) * c, y: box.y + (y + 0.5) * c }
}

async function levelsFlow() {
  await page.goto(args.url)
  const count = await page.getByText("Start level").count()
  record("level-select", count > 0, `${count} levels listed`)
  await shot("levels")
  await page.goto(new URL("#%E0", args.url).href)
  const listed = await page.getByText("Start level").count()
  record("malformed-hash", listed === count, `${listed} levels listed for #%E0`)
  for (let i = 0; i < count; i++) {
    await openLevel(i)
    const title = await page.locator("header h1, header h2, h1").first().innerText()
    await button("Show solution").click()
    await button("8×").click()
    await button(/^Play/).click()
    const text = await outcome()
    await shot(`level-${i + 1}-solution`)
    record(`solution-wins:${title}`, text.startsWith("Level complete"), text)
  }
}

// Builds the first example level by hand: belts by drag, a service by click.
async function buildFlow() {
  await openLevel(0)
  const width = 12
  const drag = async (from, to) => {
    const a = await cellCenter(from, 1, width)
    const b = await cellCenter(to, 1, width)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
  }
  await page.getByText("Kafka partition").first().click()
  await drag(2, 4)
  await page.getByText("PaymentService").first().click()
  const service = await cellCenter(5, 1, width)
  await page.mouse.click(service.x, service.y)
  await page.getByText("Kafka partition").first().click()
  await drag(6, 9)
  await page.keyboard.press("Escape")
  await shot("build-placed")
  await button("8×").click()
  await button(/^Play/).click()
  const text = await outcome()
  await shot("build-finished")
  record("hand-built-layout-wins", text.startsWith("Level complete"), text)
}

// Pauses the payments level mid-run, steps it, and inspects a parcel and a building.
async function inspectFlow() {
  await openLevel(3)
  await button("Show solution").click()
  await page.keyboard.press(" ")
  const played = await appears(button(/^Pause/))
  await page.waitForTimeout(5000)
  await page.keyboard.press(" ")
  const paused = await appears(button(/^Play/))
  record("space-toggles-clock", played && paused, `focused Show solution, Space ${played ? "played" : "did not play"}, Space again ${paused ? "paused" : "did not pause"}`)
  // A keyboard user who tabbed to a control still activates it with Space.
  let tabbed = false
  for (let i = 0; i < 40 && !tabbed; i++) {
    await page.keyboard.press("Tab")
    tabbed = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "4×"
  }
  await page.keyboard.press(" ")
  const fourPressed = (await button("4×").getAttribute("aria-pressed")) === "true"
  const stillPaused = (await button(/^Play/).count()) > 0
  record("space-activates-tabbed-control", tabbed && fourPressed && stillPaused, `tabbed to 4×: ${tabbed}, Space selected it: ${fourPressed}, clock stayed paused: ${stillPaused}`)
  await button("1×").click()
  const width = 12
  let found = false
  for (const x of [4, 3, 2, 6, 7, 8]) {
    const p = await cellCenter(x, 1, width)
    await page.mouse.click(p.x, p.y)
    if (await page.getByText("Idempotency key").count()) {
      found = true
      break
    }
  }
  await shot("inspect-event")
  record("inspect-event", found, found ? "event payload, key and correlation shown" : "no parcel found on the belt")

  const inspector = page.locator("aside").last().locator(":scope > section")
  const watched = await cellCenter(4, 1, width)
  await page.mouse.click(watched.x, watched.y)
  let stale = 0
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(".")
    const shown = await inspector.innerText()
    await page.mouse.click(watched.x, watched.y)
    if ((await inspector.innerText()) !== shown) stale++
  }
  record("inspect-follows-step", stale === 0, `${stale} of 20 steps left the inspector behind a fresh inspect`)
  const service = await cellCenter(5, 1, width)
  await page.mouse.click(service.x, service.y)
  const doc = await page.getByText(/Charges the card/).count()
  await shot("inspect-building")
  record("inspect-building", doc > 0, doc > 0 ? "PaymentService doc from the pack shown" : "pack doc missing")
}

for (const [name, run] of Object.entries(flows)) {
  if (args.flow !== "all" && args.flow !== name) continue
  try {
    await run()
  } catch (error) {
    await shot(`${name}-error`).catch(() => {})
    record(name, false, String(error).split("\n")[0])
  }
}
record("console", errors.length === 0, errors.length === 0 ? "no page errors" : errors.join(" | "))

await context.close()
await browser.close()
writeFileSync(join(args.out, "results.json"), JSON.stringify({ results, errors }, null, 2))
process.exit(results.every((r) => r.ok) ? 0 : 1)
