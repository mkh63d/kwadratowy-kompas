import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export const BASE_PORT = 5173;
export const BASE_PREVIEW_PORT = 4173;

/**
 * Parsed instead of loadEnvFile so `.env.local`'s VITE_CONVEX_URL never reaches process.env.
 * @param {string} dir
 * @returns {Record<string, string>}
 */
export function readLocalEnv(dir) {
  const file = join(dir, ".env.local");
  return existsSync(file)
    ? /** @type {Record<string, string>} */ (
        parseEnv(readFileSync(file, "utf8"))
      )
    : {};
}

/**
 * Dev and preview ports; shell variables win over `.env.local`.
 * @param {string} dir
 * @param {Record<string, string | undefined>} [shellEnv]
 * @returns {{ port: number, previewPort: number }}
 */
export function resolvePorts(dir, shellEnv = process.env) {
  const local = readLocalEnv(dir);
  return {
    port: Number(shellEnv.PORT ?? local.PORT ?? BASE_PORT),
    previewPort: Number(
      shellEnv.PREVIEW_PORT ?? local.PREVIEW_PORT ?? BASE_PREVIEW_PORT,
    ),
  };
}
