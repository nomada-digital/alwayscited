import { dplGuardScript } from "./dpl-guard-script";

/**
 * The deployment-id guard (./dpl-guard-script.ts), as the first script in
 * <head>.
 *
 * `process.env.NEXT_DEPLOYMENT_ID` is spelled as a literal member access
 * because the build replaces exactly that expression with the deployment id in
 * server code (node_modules/next/dist/build/define-env.js); on a build without
 * one it is `false`, the script is null and nothing renders.
 */
export function DplGuard() {
  const script = dplGuardScript(process.env.NEXT_DEPLOYMENT_ID);
  return script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null;
}
