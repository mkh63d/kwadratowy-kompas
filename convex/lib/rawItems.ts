import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DiscardReason, RawItemState } from "./enums";
import { appError } from "./errors";

export const IRRELEVANT_DISCARD_MIN_CONFIDENCE = 0.7;

type RawItemFields = WithoutSystemFields<Doc<"rawItems">>;
type Extraction = NonNullable<RawItemFields["extraction"]>;
type NewRawItem = Omit<
  RawItemFields,
  "state" | "discardReason" | "extraction" | "entryId"
>;

type TransitionExtra = {
  item?: NewRawItem;
  entryId?: Id<"entries">;
  discardReason?: DiscardReason;
  extraction?: Extraction;
};

type From = RawItemState | "insert";

const ITEM_FIELDS = {
  sourceKey: true,
  externalId: true,
  text: true,
  url: true,
  postedAt: true,
  receivedAt: true,
  contentHash: true,
  submittedBy: true,
} as const satisfies Record<keyof NewRawItem, true>;

function onlyKeys(
  extra: TransitionExtra,
  allowed: (keyof TransitionExtra)[],
): boolean {
  return Object.entries(extra).every(
    ([key, value]) =>
      value === undefined || allowed.includes(key as keyof TransitionExtra),
  );
}

function isConfidentlyIrrelevant(extraction: Extraction): boolean {
  return (
    extraction.ok &&
    !extraction.relevant &&
    extraction.confidence >= IRRELEVANT_DISCARD_MIN_CONFIDENCE
  );
}

function isUnsureIrrelevant(extraction: Extraction): boolean {
  return (
    extraction.ok &&
    !extraction.relevant &&
    extraction.confidence < IRRELEVANT_DISCARD_MIN_CONFIDENCE
  );
}

const ALLOWED: Partial<
  Record<`${From}>${RawItemState}`, (extra: TransitionExtra) => boolean>
> = {
  "insert>waiting_ai": (e) => onlyKeys(e, ["item"]) && e.item !== undefined,
  "insert>discarded": (e) =>
    onlyKeys(e, ["item", "discardReason"]) &&
    e.item !== undefined &&
    e.discardReason === "prefilter",
  "waiting_ai>processed": (e) =>
    onlyKeys(e, ["entryId", "extraction"]) &&
    e.entryId !== undefined &&
    e.extraction?.ok === true &&
    e.extraction.relevant,
  "waiting_ai>discarded": (e) =>
    onlyKeys(e, ["discardReason", "extraction"]) &&
    e.discardReason === "irrelevant" &&
    e.extraction !== undefined &&
    isConfidentlyIrrelevant(e.extraction),
  "waiting_ai>manual": (e) =>
    onlyKeys(e, ["extraction"]) &&
    (e.extraction === undefined ||
      !e.extraction.ok ||
      isUnsureIrrelevant(e.extraction)),
  "manual>processed": (e) =>
    onlyKeys(e, ["entryId"]) && e.entryId !== undefined,
  "manual>discarded": (e) =>
    onlyKeys(e, ["discardReason"]) && e.discardReason === "dismissed",
  "discarded>manual": (e) => onlyKeys(e, []),
};

function pickItemFields(item: NewRawItem): NewRawItem {
  const picked: Record<string, unknown> = {};
  for (const field of Object.keys(ITEM_FIELDS)) {
    if (field in item) picked[field] = item[field as keyof NewRawItem];
  }
  return picked as NewRawItem;
}

// `id: null` is the insert row of §10.5: the new item comes in `extra.item`.
export async function transitionRawItem(
  ctx: MutationCtx,
  id: Id<"rawItems"> | null,
  to: RawItemState,
  extra: TransitionExtra = {},
): Promise<Id<"rawItems">> {
  const current = id === null ? null : await ctx.db.get(id);
  if (id !== null && current === null)
    appError("not_found", "raw item not found");
  const from: From = current?.state ?? "insert";

  const extraIsValid = ALLOWED[`${from}>${to}`];
  if (extraIsValid === undefined)
    appError("conflict", `raw item cannot go from ${from} to ${to}`);
  if (!extraIsValid(extra))
    appError("invalid", `invalid extra for raw item ${from} → ${to}`);
  if (
    extra.entryId !== undefined &&
    (await ctx.db.get(extra.entryId)) === null
  ) {
    appError("invalid", "entry not found");
  }

  const transitionFields = {
    state: to,
    discardReason: to === "discarded" ? extra.discardReason : undefined,
    entryId: to === "processed" ? extra.entryId : undefined,
  };

  if (id === null) {
    return ctx.db.insert("rawItems", {
      ...pickItemFields(extra.item!),
      ...transitionFields,
    });
  }
  await ctx.db.patch(id, {
    ...transitionFields,
    ...(extra.extraction === undefined ? {} : { extraction: extra.extraction }),
  });
  return id;
}
