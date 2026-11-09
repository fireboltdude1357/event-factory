import { Console, Effect } from "effect";
import { checkPack, formatResult, type CheckArgs } from "./pack-check.js";

const usage = "usage: pnpm pack:check <pack-dir> [--scenario <id>] [--json]";

function parseArgs(argv: readonly string[]): CheckArgs | string {
  let packDir: string | null = null;
  let scenario: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--scenario") {
      scenario = argv[++i] ?? null;
      if (scenario === null) return "--scenario needs an id";
    } else if (arg === "--") continue;
    else if (arg?.startsWith("--")) return `unknown flag ${arg}`;
    else if (packDir === null && arg !== undefined) packDir = arg;
    else return `unexpected argument ${arg}`;
  }
  return packDir === null ? "missing <pack-dir>" : { packDir, scenario, json };
}

const program = Effect.gen(function* () {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    yield* Console.error(`${args}\n${usage}`);
    return 2;
  }
  const { text, exitCode } = formatResult(yield* checkPack(args), args.json);
  yield* Console.log(text);
  return exitCode;
});

process.exitCode = await Effect.runPromise(program);
