import { type Infer, v } from "convex/values";

export const entryTypeValidator = v.union(
  v.literal("dofinansowanie"),
  v.literal("konkurs"),
  v.literal("hackathon"),
  v.literal("szkolenie"),
  v.literal("event"),
  v.literal("news"),
  v.literal("ogloszenie"),
);
export type EntryType = Infer<typeof entryTypeValidator>;

export const entryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("published"),
  v.literal("rejected"),
  v.literal("archived"),
  v.literal("withdrawn"),
);
export type EntryStatus = Infer<typeof entryStatusValidator>;

export const archiveReasonValidator = v.union(
  v.literal("expired"),
  v.literal("cancelled"),
  v.literal("manual"),
);
export type ArchiveReason = Infer<typeof archiveReasonValidator>;

export const withdrawReasonValidator = v.union(
  v.literal("error"),
  v.literal("spam"),
  v.literal("legal"),
  v.literal("duplicate"),
);
export type WithdrawReason = Infer<typeof withdrawReasonValidator>;

export const stageValidator = v.union(
  v.literal("idea"),
  v.literal("mvp"),
  v.literal("traction"),
  v.literal("scale"),
);
export type Stage = Infer<typeof stageValidator>;

export const costValidator = v.union(
  v.literal("free"),
  v.literal("subsidised"),
  v.literal("paid"),
);
export type Cost = Infer<typeof costValidator>;

// Declaration order is privilege order (lowest first).
export const roleValidator = v.union(
  v.literal("user"),
  v.literal("moderator"),
  v.literal("admin"),
);
export type Role = Infer<typeof roleValidator>;

export const sourceKindValidator = v.union(
  v.literal("manual"),
  v.literal("form"),
  v.literal("whatsapp"),
  v.literal("scraper"),
);
export type SourceKind = Infer<typeof sourceKindValidator>;

export const rawItemStateValidator = v.union(
  v.literal("waiting_ai"),
  v.literal("processed"),
  v.literal("manual"),
  v.literal("discarded"),
);
export type RawItemState = Infer<typeof rawItemStateValidator>;

export const discardReasonValidator = v.union(
  v.literal("prefilter"),
  v.literal("irrelevant"),
  v.literal("dismissed"),
);
export type DiscardReason = Infer<typeof discardReasonValidator>;

export const channelKindValidator = v.union(
  v.literal("text"),
  v.literal("announcement"),
);
export type ChannelKind = Infer<typeof channelKindValidator>;

export const pingPolicyValidator = v.union(
  v.literal("never"),
  v.literal("new"),
  v.literal("featured"),
);
export type PingPolicy = Infer<typeof pingPolicyValidator>;

export const outboxActionValidator = v.union(
  v.literal("create"),
  v.literal("update"),
  v.literal("pin"),
  v.literal("unpin"),
  v.literal("crosspost"),
  v.literal("remind"),
  v.literal("archive"),
  v.literal("delete"),
);
export type OutboxAction = Infer<typeof outboxActionValidator>;

export const outboxStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paused"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("needs_review"),
  v.literal("skipped"),
);
export type OutboxStatus = Infer<typeof outboxStatusValidator>;

export const postKindValidator = v.union(
  v.literal("main"),
  v.literal("reminder"),
);
export type PostKind = Infer<typeof postKindValidator>;

export const programKindValidator = v.union(
  v.literal("incubator"),
  v.literal("accelerator"),
  v.literal("hackathon"),
  v.literal("mentoring"),
  v.literal("other"),
);
export type ProgramKind = Infer<typeof programKindValidator>;
