import { missingColumn } from "../tracking/decide.ts";
import type { WalkthroughAsk } from "./walkthrough-fields.ts";

/**
 * The three columns 20261014000000_walkthrough_fields.sql adds to
 * walkthrough_requests (13 Oct 2026).
 *
 * The migration is additive and is applied separately from the deploy, so the
 * deploy can land first (AGENTS.md). Until it is applied a write naming these
 * columns is refused outright - PostgREST's "Could not find the 'name' column
 * ... in the schema cache", or Postgres' `column "name" ... does not exist` -
 * and a refused write here is a visitor told "That did not go through" with
 * nothing stored and nobody alerted. So a write refused for these columns
 * alone goes again without them: the ask is stored as it was before, and the
 * alert still carries all three, which is where Luke and Danny read them.
 */
export const ASK_COLUMNS = ["name", "category", "market"] as const;

/** Whether `err` is one of the three columns not being there yet. */
export function askColumnsMissing(err: unknown): boolean {
  return ASK_COLUMNS.some((c) => missingColumn(err, `'${c}'`) || missingColumn(err, `"${c}"`) || missingColumn(err, `.${c} `));
}

/**
 * `write` with the ask's fields, and once more without them if, and only if,
 * the columns are what it was refused for. Any other error is the caller's,
 * unchanged.
 */
export async function writeAsk<R extends { error: unknown }>(ask: WalkthroughAsk, write: (fields: Partial<WalkthroughAsk>) => PromiseLike<R>): Promise<R> {
  const first = await write(ask);
  if (!first.error || !askColumnsMissing(first.error)) return first;
  console.warn("[walkthrough] name, category and market not stored, the alert still carries them: is 20261014000000_walkthrough_fields.sql applied?");
  return write({});
}
