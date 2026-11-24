import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { switchesTables } from "../switches/tables";
import { appError } from "./errors";

export type BacklogMode = NonNullable<
  Infer<typeof switchesTables.switchLog.validator.fields.backlog>
>;

export const SWITCH_DEFAULTS = {
  scraping: true,
  ai: true,
  discord: false,
  sponsoring: false,
  reminders: true,
  digest: true,
  mcp: true,
  submitForm: true,
  registration: false,
} as const satisfies Record<string, boolean>;

const SOURCE_KEY = /^[a-z0-9-]+$/;
// Discord channel IDs are snowflakes: decimal digits only.
const CHANNEL_ID = /^[0-9]+$/;

export const SWITCH_PATTERNS = {
  "scraping.source": { default: true, id: SOURCE_KEY },
  "ingest.source": { default: true, id: SOURCE_KEY },
  "promo.source": { default: true, id: SOURCE_KEY },
  "discord.channel": { default: true, id: CHANNEL_ID },
  "discord.crosspost": { default: true, id: CHANNEL_ID },
} as const satisfies Record<string, { default: boolean; id: RegExp }>;

type StaticSwitchKey = keyof typeof SWITCH_DEFAULTS;
type SwitchPattern = keyof typeof SWITCH_PATTERNS;

export type SwitchKey = StaticSwitchKey | `${SwitchPattern}:${string}`;

const BACKLOG_LIMIT = 1000;

type BacklogScope = "ai" | "discord";

const BACKLOG_MODES: Record<BacklogScope, readonly BacklogMode[]> = {
  ai: ["process", "onlyNew"],
  discord: ["send", "skip"],
};

type ReadCtx = Pick<QueryCtx, "db">;

function splitPatternKey(
  key: string,
): { pattern: SwitchPattern; id: string } | null {
  const colon = key.indexOf(":");
  if (colon === -1) return null;
  const pattern = key.slice(0, colon);
  if (!Object.hasOwn(SWITCH_PATTERNS, pattern)) return null;
  return { pattern: pattern as SwitchPattern, id: key.slice(colon + 1) };
}

function isStaticKey(key: string): key is StaticSwitchKey {
  return Object.hasOwn(SWITCH_DEFAULTS, key);
}

export function isValidSwitchKey(key: string): key is SwitchKey {
  if (isStaticKey(key)) return true;
  const parts = splitPatternKey(key);
  return parts !== null && SWITCH_PATTERNS[parts.pattern].id.test(parts.id);
}

function requireValidKey(key: string): SwitchKey {
  if (!isValidSwitchKey(key))
    appError("invalid", `Unknown switch key "${key}"`);
  return key;
}

function defaultOf(key: SwitchKey): boolean {
  if (isStaticKey(key)) return SWITCH_DEFAULTS[key];
  return SWITCH_PATTERNS[splitPatternKey(key)!.pattern].default;
}

function backlogScopeOf(key: SwitchKey): BacklogScope | null {
  if (key === "ai") return "ai";
  if (key === "discord") return "discord";
  const pattern = splitPatternKey(key)?.pattern;
  if (pattern === "discord.channel" || pattern === "discord.crosspost") {
    return "discord";
  }
  return null;
}

async function readSwitch(ctx: ReadCtx, key: SwitchKey) {
  return ctx.db
    .query("switches")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export async function isEnabled(
  ctx: ReadCtx,
  key: SwitchKey,
): Promise<boolean> {
  const validKey = requireValidKey(key);
  const stored = await readSwitch(ctx, validKey);
  return stored?.enabled ?? defaultOf(validKey);
}

export async function assertEnabled(
  ctx: ReadCtx,
  key: SwitchKey,
): Promise<void> {
  if (!(await isEnabled(ctx, key))) appError("switch_off", key);
}

export async function backlogCount(
  ctx: ReadCtx,
  key: SwitchKey,
): Promise<number> {
  const validKey = requireValidKey(key);
  if (validKey === "ai") {
    const rows = await ctx.db
      .query("rawItems")
      .withIndex("by_state", (q) => q.eq("state", "waiting_ai"))
      .take(BACKLOG_LIMIT);
    return rows.length;
  }
  if (validKey === "discord") {
    const rows = await ctx.db
      .query("discordOutbox")
      .withIndex("by_status_nextAttempt", (q) => q.eq("status", "paused"))
      .take(BACKLOG_LIMIT);
    return rows.length;
  }
  const parts = splitPatternKey(validKey);
  if (
    parts?.pattern === "discord.channel" ||
    parts?.pattern === "discord.crosspost"
  ) {
    let rows = ctx.db
      .query("discordOutbox")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", parts.id).eq("status", "paused"),
      );
    if (parts.pattern === "discord.crosspost") {
      rows = rows.filter((q) => q.eq(q.field("action"), "crosspost"));
    }
    return (await rows.take(BACKLOG_LIMIT)).length;
  }
  return 0;
}

export async function setSwitch(
  ctx: MutationCtx,
  {
    key,
    enabled,
    by,
    reason,
    backlog,
  }: {
    key: SwitchKey;
    enabled: boolean;
    by?: Id<"users">;
    reason?: string;
    backlog?: BacklogMode;
  },
): Promise<{ backlogCount: number }> {
  const validKey = requireValidKey(key);
  const scope = backlogScopeOf(validKey);

  if (backlog !== undefined) {
    if (scope === null || !BACKLOG_MODES[scope].includes(backlog)) {
      appError(
        "invalid",
        `Backlog mode "${backlog}" does not apply to "${validKey}"`,
      );
    }
    if (!enabled) {
      appError(
        "invalid",
        "A backlog mode applies only when turning a switch on",
      );
    }
  }

  const stored = await readSwitch(ctx, validKey);
  const from = stored?.enabled ?? defaultOf(validKey);
  if (from === enabled) return { backlogCount: 0 };

  const count =
    enabled && scope !== null ? await backlogCount(ctx, validKey) : 0;
  if (count > 0 && backlog === undefined) {
    appError(
      "conflict",
      `"${validKey}" has a backlog of ${count >= BACKLOG_LIMIT ? `${BACKLOG_LIMIT}+` : count} item(s); choose a backlog mode`,
    );
  }

  const at = Date.now();
  if (stored === null) {
    await ctx.db.insert("switches", {
      key: validKey,
      enabled,
      updatedAt: at,
      updatedBy: by,
    });
  } else {
    await ctx.db.patch(stored._id, { enabled, updatedAt: at, updatedBy: by });
  }
  await ctx.db.insert("switchLog", {
    key: validKey,
    from,
    to: enabled,
    at,
    by,
    reason,
    backlog,
    backlogCount: enabled && scope !== null ? count : undefined,
  });
  return { backlogCount: count };
}
