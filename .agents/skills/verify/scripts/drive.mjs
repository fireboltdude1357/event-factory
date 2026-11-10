// Drives the running game through its real UI and writes screenshots,
// recordings and results.json to --out. Exit 1 when any step fails.
//
//   node .agents/skills/verify/scripts/drive.mjs --url http://localhost:5391 --out .verify/runs/<id>/artifacts [--flow all|levels|build|retry|inspect|idle|phone]
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
const flows = { levels: levelsFlow, build: buildFlow, retry: retryFlow, inspect: inspectFlow, idle: idleFlow, phone: phoneFlow }
if (args.flow !== "all" && !Object.hasOwn(flows, args.flow))
  throw new Error(`unknown --flow ${args.flow}; expected all|${Object.keys(flows).join("|")}`)
mkdirSync(args.out, { recursive: true })

const browser = process.env.WIN_CHROME_CDP
  ? await chromium.connectOverCDP(process.env.WIN_CHROME_CDP)
  : await chromium.launch()

const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }
const errors = []
const results = []
// Only the contexts this drive opened are closed at the end: a shared browser may hold someone else's.
const opened = []
let current = null
const record = (step, ok, detail) => {
  results.push({ step, ok, detail })
  console.log(`${ok ? "pass" : "FAIL"} ${step}: ${detail}`)
}

// Each context starts with empty storage, so progress from one flow never leaks into another.
async function open(viewport, name) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport === phone,
    deviceScaleFactor: viewport === phone ? 2 : 1,
    recordVideo: { dir: join(args.out, "video", name), size: viewport },
  })
  opened.push(context)
  const page = await context.newPage()
  current = { page, name }
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`))
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`))
  return { context, page, shot: (file) => page.screenshot({ path: join(args.out, `${file}.png`) }) }
}

const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" })
const appears = (locator) => locator.waitFor({ timeout: 2000 }).then(() => true, () => false)
const levelLinks = (page) => page.locator("a[data-level]")

async function openLevel(page, index) {
  await page.goto(args.url)
  await levelLinks(page).nth(index).click()
  await page.locator("canvas[data-cell]").waitFor()
  await page.evaluate(() => document.fonts.ready)
}

// Waits for the outcome heading. The game halts the clock when a level finishes.
async function outcome(page) {
  const heading = page.getByRole("heading", { name: /^Level (complete|lost)/ })
  await heading.waitFor({ timeout: 90_000 })
  return heading.innerText()
}

// The map canvas publishes its cell size and origin, so a cell is a click position.
async function cellCenter(page, x, y) {
  const canvas = page.locator("canvas[data-cell]")
  const box = await canvas.boundingBox()
  const { cell, ox, oy } = await canvas.evaluate((el) => ({ cell: Number(el.dataset.cell), ox: Number(el.dataset.ox), oy: Number(el.dataset.oy) }))
  return { x: box.x + ox + (x + 0.5) * cell, y: box.y + oy + (y + 0.5) * cell }
}

async function drag(page, from, to) {
  const a = await cellCenter(page, ...from)
  const b = await cellCenter(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
}

const tool = (page, title) => page.getByRole("button", { name: new RegExp(title) }).first()
const paints = (page) => page.locator("canvas[data-cell]").evaluate((el) => Number(el.dataset.paints))
const completeCount = async (page) => {
  await page.goto(args.url)
  await levelLinks(page).first().waitFor()
  return page.getByText(/of \d+ levels complete/).innerText()
}

async function levelsFlow() {
  const { context, page, shot } = await open(desktop, "levels")
  await page.goto(args.url)
  await levelLinks(page).first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  const count = await levelLinks(page).count()
  record("level-select", count > 0, `${count} levels listed`)
  await shot("levels")
  await page.goto(new URL("#%E0", args.url).href)
  const listed = await levelLinks(page).count()
  record("malformed-hash", listed === count, `${listed} levels listed for #%E0`)
  for (let i = 0; i < count; i++) {
    await openLevel(page, i)
    const title = await page.locator("h1").first().innerText()
    await button(page, "Show solution").click()
    if (i === count - 1) {
      // One level at normal speed, so the recording and a mid-run screenshot show the factory running.
      await button(page, "Play").click()
      await page.waitForTimeout(7000)
      await shot(`level-${i + 1}-running`)
    } else await button(page, "Play").click()
    await button(page, "8×").click()
    const text = await outcome(page)
    await page.waitForTimeout(500)
    await shot(`level-${i + 1}-ending`)
    await page.waitForTimeout(1500)
    await shot(`level-${i + 1}-solution`)
    record(`solution-wins:${title}`, text.startsWith("Level complete"), text)
  }
  const progress = await completeCount(page)
  record("solution-is-not-progress", progress.startsWith("0 of"), `after watching every reference solution the list says "${progress}"`)
  await context.close()
}

// Builds the first example level by hand: belts by drag, a service by click.
async function buildFlow() {
  const { context, page, shot } = await open(desktop, "build")
  await openLevel(page, 0)
  await shot("level-1-start")
  await tool(page, "Kafka partition").click()
  await drag(page, [2, 1], [4, 1])
  await tool(page, "PaymentService").click()
  const service = await cellCenter(page, 5, 1)
  await page.mouse.move(service.x, service.y)
  await shot("build-ghost")
  await page.mouse.click(service.x, service.y)
  await page.keyboard.press("1")
  await drag(page, [6, 1], [9, 1])
  await page.keyboard.press("Escape")
  await shot("build-placed")
  await button(page, "Play").click()
  await page.waitForTimeout(4000)
  await shot("build-running")
  await button(page, "8×").click()
  const text = await outcome(page)
  await page.waitForTimeout(2000)
  await shot("build-finished")
  record("hand-built-layout-wins", text.startsWith("Level complete"), text)
  const next = await button(page, /^Next level/).count()
  record("win-offers-next-level", next > 0, next > 0 ? "the result card offers the next level" : "no Next level button")
  const progress = await completeCount(page)
  await page.reload()
  await levelLinks(page).first().waitFor()
  const kept = await page.getByText(/of \d+ levels complete/).innerText()
  await shot("levels-progress")
  record("win-is-recorded", progress.startsWith("1 of") && kept === progress, `list says "${progress}", and "${kept}" after a reload`)
  await context.close()
}

// Loses the first level with a line that skips the service, then fixes that same layout and wins.
async function retryFlow() {
  const { context, page, shot } = await open(desktop, "retry")
  await openLevel(page, 0)
  await tool(page, "Kafka partition").click()
  await drag(page, [2, 1], [9, 1])
  await page.keyboard.press("Escape")
  await button(page, "8×").click()
  await button(page, "Play").click()
  const lost = await outcome(page)
  await page.waitForTimeout(1200)
  await shot("retry-lost")
  record("wrong-layout-loses", lost.startsWith("Level lost"), lost)
  await button(page, "Fix and retry").click()
  // The belts are still there: dropping the service onto the line is all the fix needs.
  await tool(page, "PaymentService").click()
  const service = await cellCenter(page, 5, 1)
  await page.mouse.click(service.x, service.y)
  await page.keyboard.press("Escape")
  await shot("retry-fixed")
  await button(page, "Play").click()
  const won = await outcome(page)
  await page.waitForTimeout(1200)
  await shot("retry-won")
  record("retry-keeps-layout", won.startsWith("Level complete"), `after Fix and retry and one new building: ${won}`)
  await context.close()
}

// Pauses the payments level mid-run, steps it, and inspects a parcel and a building.
async function inspectFlow() {
  const { context, page, shot } = await open(desktop, "inspect")
  await openLevel(page, 3)
  await button(page, "Show solution").click()
  await page.keyboard.press(" ")
  const played = await appears(button(page, "Pause"))
  await page.waitForTimeout(5000)
  await shot("level-4-live")
  await page.keyboard.press(" ")
  const paused = await appears(button(page, "Play"))
  record("space-toggles-clock", played && paused, `focused Show solution, Space ${played ? "played" : "did not play"}, Space again ${paused ? "paused" : "did not pause"}`)
  // A keyboard user who tabbed to a control still activates it with Space.
  let tabbed = false
  for (let i = 0; i < 60 && !tabbed; i++) {
    await page.keyboard.press("Tab")
    tabbed = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "4×"
  }
  await page.keyboard.press(" ")
  const fourPressed = (await button(page, "4×").getAttribute("aria-pressed")) === "true"
  const stillPaused = (await button(page, "Play").count()) > 0
  record("space-activates-tabbed-control", tabbed && fourPressed && stillPaused, `tabbed to 4×: ${tabbed}, Space selected it: ${fourPressed}, clock stayed paused: ${stillPaused}`)
  await button(page, "1×").click()
  let found = false
  for (const x of [4, 3, 2, 6, 7, 8]) {
    const p = await cellCenter(page, x, 1)
    await page.mouse.click(p.x, p.y)
    if (await page.getByText("Idempotency key").count()) {
      found = true
      break
    }
  }
  await shot("inspect-event")
  record("inspect-event", found, found ? "event payload, key and correlation shown" : "no parcel found on the belt")

  const inspector = page.getByRole("tabpanel")
  const watched = await cellCenter(page, 4, 1)
  await page.mouse.click(watched.x, watched.y)
  let stale = 0
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(".")
    const shown = await inspector.innerText()
    await page.mouse.click(watched.x, watched.y)
    if ((await inspector.innerText()) !== shown) stale++
  }
  record("inspect-follows-step", stale === 0, `${stale} of 20 steps left the inspector behind a fresh inspect`)
  const service = await cellCenter(page, 5, 1)
  await page.mouse.click(service.x, service.y)
  const doc = await page.getByText(/Charges the card/).count()
  await shot("inspect-building")
  record("inspect-building", doc > 0, doc > 0 ? "PaymentService doc from the pack shown" : "pack doc missing")
  await context.close()
}

// A running map repaints every frame. A paused one must stop once its last effect ends.
async function idleFlow() {
  const { context, page } = await open(desktop, "idle")
  // The first level, so this flow runs on a pack with only one.
  await openLevel(page, 0)
  await button(page, "Show solution").click()
  await button(page, "Play").click()
  await page.waitForTimeout(1500)
  const a = await paints(page)
  await page.waitForTimeout(1000)
  const b = await paints(page)
  await button(page, "Pause").click()
  await page.mouse.move(5, 5)
  await page.waitForTimeout(2000)
  const c = await paints(page)
  await page.waitForTimeout(2000)
  const d = await paints(page)
  record("running-map-animates", b - a > 20, `${b - a} paints in one second of play`)
  record("paused-map-is-still", d === c, `${d - c} paints in two seconds paused`)
  await context.close()
}

// The first level built and won at phone width with taps only.
async function phoneFlow() {
  const { context, page, shot } = await open(phone, "phone")
  await page.goto(args.url)
  await levelLinks(page).first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await shot("phone-levels")
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  const listFits = await fits()
  await levelLinks(page).first().tap()
  await page.locator("canvas[data-cell]").waitFor()
  await page.waitForTimeout(400)
  await shot("phone-level-start")
  const tapCell = async (x, y) => {
    const p = await cellCenter(page, x, y)
    await page.touchscreen.tap(p.x, p.y)
  }
  await tool(page, "Kafka partition").tap()
  for (const x of [2, 3, 4, 6, 7, 8, 9]) await tapCell(x, 1)
  await tool(page, "PaymentService").tap()
  await tapCell(5, 1)
  await shot("phone-built")
  await button(page, "Play").tap()
  await page.waitForTimeout(3500)
  await shot("phone-running")
  await button(page, "8×").tap()
  const text = await outcome(page)
  await page.waitForTimeout(2000)
  await shot("phone-won")
  record("phone-tap-build-wins", text.startsWith("Level complete"), text)
  record("phone-no-sideways-scroll", listFits && (await fits()), `level list fits: ${listFits}, level screen fits: ${await fits()}`)
  await context.close()
}

for (const [name, run] of Object.entries(flows)) {
  if (args.flow !== "all" && args.flow !== name) continue
  try {
    await run()
  } catch (error) {
    await current?.page.screenshot({ path: join(args.out, `${name}-error.png`) }).catch(() => {})
    record(name, false, String(error).split("\n")[0])
  }
}
record("console", errors.length === 0, errors.length === 0 ? "no page errors" : errors.join(" | "))

for (const context of opened) await context.close().catch(() => {})
await browser.close()
writeFileSync(join(args.out, "results.json"), JSON.stringify({ results, errors }, null, 2))
process.exit(results.every((r) => r.ok) ? 0 : 1)
