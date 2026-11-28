import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import { dashEmail } from "./access";
import { BETA_COOKIE, betaCookieOn } from "./beta-flag";
import { DEMO_HEADER, VIEW_HEADER } from "./host";
import { isStaffEmail } from "./staff";

/**
 * Is the beta on for this request? The reviewer's cookie (beta-flag.ts) counts only when the request is a Nomada staff session or
 * a read-only demo / view-as link: a customer who finds the parameter sees what every customer sees. Never throws; any failure reads as off.
 */
export const betaOn = cache(async (): Promise<boolean> => {
  try {
    if (!betaCookieOn((await cookies()).get(BETA_COOKIE)?.value)) return false;
    const h = await headers();
    if (h.get(DEMO_HEADER) || h.get(VIEW_HEADER)) return true;
    return isStaffEmail(await dashEmail());
  } catch {
    return false;
  }
});
