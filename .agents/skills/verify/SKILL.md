---
name: verify
description: "Run and verify Event Factory (the web game and the pack:check CLI) in the real app. Use after changing the engine, the web app or a pack, for screenshots or recordings, or before filing a PR that touches packages/, apps/web or packs/."
---

# Verify Event Factory

Event Factory is a browser game that renders a domain pack. This skill proves a change two ways. `pnpm pack:check` proves every level of a pack headlessly. `scripts/drive.mjs` plays the real web app through its UI with Playwright, at desktop and phone width, and records screenshots, videos and `results.json`. `scripts/shots.mjs` takes a quick set of screenshots at one viewport with no assertions, for judging a visual change while you work. Both scripts connect to the Chrome DevTools endpoint in `WIN_CHROME_CDP` when it is set, and launch local Playwright Chromium otherwise.

Verification-owned paths (the maintenance pass may edit these, never product code): `.agents/skills/verify/`.

## Target

- Backend: none. The game runs entirely in the browser from a local Vite dev server.
- Auth: none.
- Data: the pack named by `EVENT_FACTORY_PACK` (default `packs/order-processing`). Every run starts from the pack's own maps, so there is nothing to seed or reset.

## Run ID and isolation

`scripts/verify-run` keeps the run's state. Run it from the repo root:

```sh
vr=.agents/skills/verify/scripts/verify-run
run_id="$($vr new game --lock)"
```

Runs are exclusive per worktree because they share `node_modules/.vite`. If the lock is held, `new --lock` creates nothing and names the holder. Wait or use another worktree. `--steal-stale` takes the lock only from a holder with no live process that has been idle for over 15 minutes. Never clean up a run you did not create.

## Launch

Helper-launched. Start the dev server through the helper. It prints a JSON line with the port.

```sh
$vr spawn "$run_id" --name web --cwd apps/web --ready-url 'http://localhost:{port}/' -- npx vite --port '{port}' --strictPort
```

To verify another pack, add `--env EVENT_FACTORY_PACK=packs/<name>`. The path is relative to the repo root.

Prove the pack itself first. A level that fails here fails in the browser too:

```sh
pnpm pack:check packs/order-processing        # exit 0: every solution wins, every counterexample loses
```

## Doctor

Read-only. Run it before the first drive and after any failed drive.

```sh
$vr doctor "$run_id"
```

It passes when the dev server is alive with its recorded start time and is the only listener on its port. Also confirm `run.json` names this worktree and the commit under test.

## Drive

```sh
node .agents/skills/verify/scripts/drive.mjs \
  --url http://localhost:<port>/ --out .verify/runs/$run_id/artifacts [--flow all|levels|build|retry|inspect|idle|phone]
```

To render in a Chrome you already run, such as one on a GPU host, set `WIN_CHROME_CDP` to its DevTools endpoint first. The script prints one `pass` or `FAIL` line per step and exits 1 on any failure. The `build`, `retry`, `inspect` and `phone` flows use the example pack's coordinates. Choose `--flow levels` and `--flow idle` for any other pack. Each flow records its own video under `artifacts/video/<flow>/`. Convert one for a PR with `ffmpeg -i artifacts/video/build/*.webm -c:v libx264 -pix_fmt yuv420p artifacts/build.mp4`.

Pick the recipe from `references/features/` for the feature under test.

## Proof bar

A proof exercises the production user path and shows what a skeptical reviewer would accept.

- Drive the real path: visible UI, registered shortcuts, menus, real CLI commands, normal backend plumbing. Use evaluate or direct queries to inspect state after the user path ran, not as the action being proved.
- Capture the action and the resulting state, not only the final screen. Interactions, transitions and data loading get a recording; static changes get screenshots.
- Verify side effects alongside pixels: rows written (read back through a second view or a read-only query), files, messages, a reload round trip.
- Exercise every entry point the feature file lists that the change can affect, and the success, cancel, error, empty and persistence paths.
- Mock only where a production boundary already isolates the external system (a payment provider's test mode, say). Never mock the behavior under test.
- When a safe path is a dry run or test mode, observe what it actually skips.
- Report an unreachable path with the attempted route and the unmet prerequisite. Never report a skipped entry point as verified through another one.
- Look at every screenshot and at least one frame of each recording before calling it proof. A drive that passes while a screenshot looks wrong is a failed proof: fix the product, then add the assertion that would have caught it.

## Evidence

`.verify/runs/<run-id>/evidence.md` records:

- run ID, commit SHA plus dirty flag, worktree path, host (all in `run.json`), and the driver
- the pack, viewports (1280x800 and 390x844), and the `pack:check` result
- per feature step: feature ID, entry point, action, assertion, observed result, artifact paths, and whether you inspected each artifact

Write each artifact as a backticked run-relative path such as `` `artifacts/levels.png` ``. `verify-run cleanup` checks that each one exists. For PRs and chat, upload with `file-upload` and embed the screenshots and the recording.

## Cleanup

Run it after the last drive and after every failed attempt.

1. If you started a Chrome for `WIN_CHROME_CDP`, stop it.
2. `$vr cleanup "$run_id" --final` stops the dev server's process group, releases the lock, and fails if an artifact listed in `evidence.md` is missing.

Never kill by name or by port alone. Cleanup never deletes `.verify/runs/<run-id>/`.

## Feature map

Behavior inventory: [`references/features/`](references/features/README.md). Each file has the same four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`. Fix a wrong recipe in the same PR as the change that made it wrong. A PR that adds or changes a user-facing feature adds or updates its feature file in the same PR. When this skill passed and the product still turned out wrong, the fix also changes this skill (a recipe, an assertion or a proof-bar line) so the next run would catch it.
