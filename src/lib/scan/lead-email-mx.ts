import "server-only";

import { resolveMx } from "node:dns/promises";

/**
 * Whether a domain takes mail: at least one MX record that is not the null MX (RFC 7505, "."). A lookup that times
 * out or errors for any reason other than "no such records" is let through - the gate is there to catch a mistyped
 * or made-up domain, not to turn a visitor away because DNS was slow.
 */
export async function domainTakesMail(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 3000)),
    ]);
    return records.some((r) => r.exchange && r.exchange !== ".");
  } catch (err) {
    const code = (err as { code?: string }).code;
    // No such domain, or a domain with no MX records: nothing to deliver to.
    return !(code === "ENOTFOUND" || code === "ENODATA");
  }
}
