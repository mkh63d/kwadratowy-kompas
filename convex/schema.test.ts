import { authTables } from "@convex-dev/auth/server";
import { convexTest } from "convex-test";
import { makeFunctionReference, type WithoutSystemFields } from "convex/server";
import type { GenericValidator } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import {
  archiveReasonValidator,
  channelKindValidator,
  costValidator,
  discardReasonValidator,
  entryStatusValidator,
  entryTypeValidator,
  outboxActionValidator,
  outboxStatusValidator,
  pingPolicyValidator,
  postKindValidator,
  programKindValidator,
  rawItemStateValidator,
  roleValidator,
  sourceKindValidator,
  stageValidator,
  withdrawReasonValidator,
} from "./lib/enums";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.*s"]);

type AppTable =
  | "entries"
  | "rawItems"
  | "sources"
  | "programs"
  | "discordRoutes"
  | "discordPosts"
  | "discordOutbox"
  | "switches"
  | "switchLog"
  | "profiles"
  | "roleLog";

type Refs = {
  userId: Id<"users">;
  entryId: Id<"entries">;
  rawItemId: Id<"rawItems">;
  programId: Id<"programs">;
  scheduledFunctionId: Id<"_scheduled_functions">;
};

type TestConvex = ReturnType<typeof convexTest>;

function describeValidator(validator: GenericValidator): string {
  switch (validator.kind) {
    case "id":
      return `id:${validator.tableName}`;
    case "literal":
      return JSON.stringify(validator.value);
    case "union":
      return validator.members.map(describeValidator).join(" | ");
    case "array":
      return `${describeValidator(validator.element)}[]`;
    case "object":
      return `{ ${Object.entries(validator.fields)
        .map(
          ([name, field]) =>
            `${name}${field.isOptional === "optional" ? "?" : ""}: ${describeValidator(field)}`,
        )
        .join("; ")} }`;
    default:
      return validator.kind;
  }
}

function describeTableFields(validator: GenericValidator) {
  if (validator.kind !== "object") {
    throw new Error(`expected an object validator, got ${validator.kind}`);
  }
  return Object.fromEntries(
    Object.entries(validator.fields).map(([name, field]) => [
      name,
      `${describeValidator(field)}${field.isOptional === "optional" ? "?" : ""}`,
    ]),
  );
}

function oneOf(...values: (string | boolean)[]) {
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

// Spec §4.1, written out so a drift in enums.ts fails here.
const ENUMS = {
  EntryType: oneOf(
    "dofinansowanie",
    "konkurs",
    "hackathon",
    "szkolenie",
    "event",
    "news",
    "ogloszenie",
  ),
  EntryStatus: oneOf(
    "pending",
    "published",
    "rejected",
    "archived",
    "withdrawn",
  ),
  ArchiveReason: oneOf("expired", "cancelled", "manual"),
  WithdrawReason: oneOf("error", "spam", "legal", "duplicate"),
  Stage: oneOf("idea", "mvp", "traction", "scale"),
  Cost: oneOf("free", "subsidised", "paid"),
  Role: oneOf("user", "moderator", "admin"),
  SourceKind: oneOf("manual", "form", "whatsapp", "scraper"),
  RawItemState: oneOf("waiting_ai", "processed", "manual", "discarded"),
  DiscardReason: oneOf("prefilter", "irrelevant", "dismissed"),
  ChannelKind: oneOf("text", "announcement"),
  PingPolicy: oneOf("never", "new", "featured"),
  OutboxAction: oneOf(
    "create",
    "update",
    "pin",
    "unpin",
    "crosspost",
    "remind",
    "archive",
    "delete",
  ),
  OutboxStatus: oneOf(
    "pending",
    "paused",
    "sent",
    "failed",
    "needs_review",
    "skipped",
  ),
  PostKind: oneOf("main", "reminder"),
  ProgramKind: oneOf(
    "incubator",
    "accelerator",
    "hackathon",
    "mentoring",
    "other",
  ),
};

// Spec §4.2-4.8 field by field; a trailing "?" marks an optional field.
const SPEC: Record<AppTable, Record<string, string>> = {
  entries: {
    slug: "string",
    type: ENUMS.EntryType,
    title: "string",
    summary: "string",
    body: "string?",
    organizer: "string?",
    location: "string?",
    isOnline: "boolean?",
    url: "string?",
    tags: "string[]",
    stages: `${ENUMS.Stage}[]?`,
    amountText: "string?",
    amountMaxPln: "float64?",
    cost: `${ENUMS.Cost}?`,
    startsAt: "float64?",
    endsAt: "float64?",
    deadline: "float64?",
    status: ENUMS.EntryStatus,
    publishedAt: "float64?",
    archiveReason: `${ENUMS.ArchiveReason}?`,
    withdrawReason: `${ENUMS.WithdrawReason}?`,
    featuredUntil: "float64?",
    sponsored: "boolean",
    sourceKey: "string",
    sourceRef: "string?",
    attributionSourceKeys: "string[]",
    noCrosspost: "boolean",
    rawItemId: "id:rawItems?",
    programId: "id:programs?",
    discordChannelOverride: "string?",
    discordPing: "boolean",
    mergedInto: "id:entries?",
    searchText: "string",
    sortAt: "float64",
    createdBy: "id:users?",
    updatedAt: "float64",
  },
  rawItems: {
    sourceKey: "string",
    externalId: "string",
    text: "string",
    url: "string?",
    postedAt: "float64?",
    receivedAt: "float64",
    contentHash: "string",
    state: ENUMS.RawItemState,
    discardReason: `${ENUMS.DiscardReason}?`,
    extraction:
      "{ ok: true; provider: string; model: string; relevant: boolean; confidence: float64; processedAt: float64 }" +
      " | { ok: false; provider: string; model: string; errorCode: string; processedAt: float64 }?",
    entryId: "id:entries?",
    submittedBy: "id:users?",
  },
  sources: {
    key: "string",
    name: "string",
    kind: ENUMS.SourceKind,
    ingestTokenHash: "string?",
    ingestTokenRotatedAt: "float64?",
    noCrosspost: "boolean",
    newsSiteOnly: "boolean",
    attribution: "{ name: string; url?: string }?",
    promoLine: "string?",
    lastRunAt: "float64?",
    lastItemCount: "float64?",
    lastNonEmptyAt: "float64?",
    lastError: "string?",
  },
  programs: {
    name: "string",
    slug: "string",
    kind: ENUMS.ProgramKind,
    url: "string?",
  },
  discordRoutes: {
    entryType: ENUMS.EntryType,
    tag: "string?",
    channelId: "string",
    channelName: "string",
    channelKind: ENUMS.ChannelKind,
    pingRoleId: "string?",
    pingPolicy: ENUMS.PingPolicy,
    crosspost: "boolean",
  },
  discordPosts: {
    entryId: "id:entries",
    kind: ENUMS.PostKind,
    channelId: "string",
    messageId: "string",
    threadId: "string?",
    contentHash: "string",
    pinned: "boolean",
    crosspostedAt: "float64?",
    remindedAt: "float64?",
    archivedAt: "float64?",
    deletedAt: "float64?",
  },
  discordOutbox: {
    entryId: "id:entries",
    action: ENUMS.OutboxAction,
    channelId: "string",
    status: ENUMS.OutboxStatus,
    nonce: "string",
    attempts: "float64",
    nextAttemptAt: "float64?",
    lastAttemptAt: "float64?",
    sentAt: "float64?",
    lastError: "string?",
    skipReason: `${oneOf(
      "backlog_skipped",
      "cancelled_by_teardown",
      "cancelled_by_restore",
      "superseded_by_delete",
      "recheck_refused",
    )}?`,
    suppressNotifications: "boolean?",
    scheduledFunctionId: "id:_scheduled_functions?",
  },
  switches: {
    key: "string",
    enabled: "boolean",
    updatedAt: "float64",
    updatedBy: "id:users?",
  },
  switchLog: {
    key: "string",
    from: "boolean",
    to: "boolean",
    at: "float64",
    by: "id:users?",
    reason: "string?",
    backlog: `${oneOf("process", "onlyNew", "send", "skip")}?`,
    backlogCount: "float64?",
  },
  profiles: {
    userId: "id:users",
    role: ENUMS.Role,
    displayName: "string?",
    discordUserId: "string?",
  },
  roleLog: {
    userId: "id:users",
    from: ENUMS.Role,
    to: ENUMS.Role,
    at: "float64",
    by: "id:users?",
  },
};

const SPEC_INDEXES: Record<AppTable, Record<string, string[]>> = {
  entries: {
    by_slug: ["slug"],
    by_status_type: ["status", "type"],
    by_status_deadline: ["status", "deadline"],
    by_status_startsAt: ["status", "startsAt"],
    by_status_publishedAt: ["status", "publishedAt"],
    by_status_sortAt: ["status", "sortAt"],
    by_status_featuredUntil: ["status", "featuredUntil"],
    by_rawItem: ["rawItemId"],
    by_source_ref: ["sourceKey", "sourceRef"],
  },
  rawItems: {
    by_source_externalId: ["sourceKey", "externalId"],
    by_state: ["state", "receivedAt"],
    by_contentHash: ["contentHash"],
    by_submittedBy: ["submittedBy", "receivedAt"],
  },
  sources: { by_key: ["key"] },
  programs: { by_slug: ["slug"] },
  discordRoutes: {
    by_type_tag: ["entryType", "tag"],
    by_channel: ["channelId"],
  },
  discordPosts: {
    by_entry_kind: ["entryId", "kind"],
    by_message: ["messageId"],
  },
  discordOutbox: {
    by_entry_action_status: ["entryId", "action", "status"],
    by_entry_status: ["entryId", "status"],
    by_status_nextAttempt: ["status", "nextAttemptAt"],
    by_channel_status: ["channelId", "status"],
  },
  switches: { by_key: ["key"] },
  switchLog: { by_at: ["at"], by_key_at: ["key", "at"] },
  profiles: { by_userId: ["userId"], by_role: ["role"] },
  roleLog: { by_userId_at: ["userId", "at"] },
};

const SPEC_SEARCH_INDEX = {
  indexDescriptor: "search_text",
  searchField: "searchText",
  filterFields: ["status", "type"],
};

type ExportedTable = {
  tableName: string;
  indexes: { indexDescriptor: string; fields: string[] }[];
  stagedDbIndexes: unknown[];
  searchIndexes: {
    indexDescriptor: string;
    searchField: string;
    filterFields: string[];
  }[];
  stagedSearchIndexes: unknown[];
  vectorIndexes: unknown[];
  stagedVectorIndexes: unknown[];
};

// export() is @internal in Convex's typings, but it is exactly what a deployment receives and the
// only place search indexes are visible (convex-test does not check search filter fields).
function exportedTable(table: AppTable) {
  const { tables } = JSON.parse(
    (schema as unknown as { export(): string }).export(),
  ) as {
    tables: ExportedTable[];
  };
  const exported = tables.find(({ tableName }) => tableName === table);
  if (exported === undefined) {
    throw new Error(`schema.export() has no table "${table}"`);
  }
  return exported;
}

const NOW = 1_764_000_000_000;

type TableDoc<T extends AppTable> = WithoutSystemFields<Doc<T>>;

type FieldRule = {
  field: string;
  condition: (doc: Record<string, unknown>) => boolean;
  mode: "iff" | "onlyIf";
};

// §4 "set iff" / "with" / "only while" notes.
const FIELD_RULES: { [T in AppTable]?: FieldRule[] } = {
  entries: [
    {
      field: "archiveReason",
      condition: (doc) => doc.status === "archived",
      mode: "iff",
    },
    {
      field: "withdrawReason",
      condition: (doc) => doc.status === "withdrawn",
      mode: "iff",
    },
    {
      field: "featuredUntil",
      condition: (doc) => doc.status === "published",
      mode: "onlyIf",
    },
  ],
  rawItems: [
    {
      field: "discardReason",
      condition: (doc) => doc.state === "discarded",
      mode: "iff",
    },
    {
      field: "entryId",
      condition: (doc) => doc.state === "processed",
      mode: "iff",
    },
  ],
  sources: [
    {
      field: "ingestTokenRotatedAt",
      condition: (doc) => doc.ingestTokenHash !== undefined,
      mode: "iff",
    },
  ],
  discordOutbox: [
    {
      field: "skipReason",
      condition: (doc) => doc.status === "skipped",
      mode: "iff",
    },
  ],
};

function ruleViolations(table: AppTable, doc: object): string[] {
  const fields = doc as Record<string, unknown>;
  return (FIELD_RULES[table] ?? []).flatMap(({ field, condition, mode }) => {
    const isSet = fields[field] !== undefined;
    const holds = condition(fields);
    if (isSet && !holds) {
      return [`${field} is set but its condition does not hold`];
    }
    if (!isSet && holds && mode === "iff") {
      return [`${field} is missing but its condition holds`];
    }
    return [];
  });
}

function pick<D>(docs: D[], matches: (doc: D) => boolean): D {
  const doc = docs.find(matches);
  if (doc === undefined) {
    throw new Error("no fixture matches");
  }
  return doc;
}

// Each table's variants obey FIELD_RULES and together set every §4 field; the first is the base
// document for the required-field tests.
const VALID_DOCS: {
  [T in AppTable]: (refs: Refs) => [TableDoc<T>, ...TableDoc<T>[]];
} = {
  entries: (refs) => {
    const common: Omit<TableDoc<"entries">, "status"> = {
      slug: "grant-lodz",
      type: "dofinansowanie",
      title: "Grant",
      summary: "Grant dla startupów",
      body: "Treść",
      organizer: "Miasto Łódź",
      location: "Łódź",
      isOnline: false,
      url: "https://example.org/grant",
      tags: ["grant"],
      stages: ["idea", "mvp"],
      amountText: "do 50 000 zł",
      amountMaxPln: 50_000,
      cost: "free",
      startsAt: NOW,
      endsAt: NOW + 1,
      deadline: NOW + 2,
      publishedAt: NOW,
      sponsored: false,
      sourceKey: "manual",
      sourceRef: "ref-1",
      attributionSourceKeys: ["manual"],
      noCrosspost: false,
      rawItemId: refs.rawItemId,
      programId: refs.programId,
      discordChannelOverride: "123",
      discordPing: true,
      searchText: "grant grant dla startupów miasto łódź grant",
      sortAt: NOW + 2,
      createdBy: refs.userId,
      updatedAt: NOW,
    };
    return [
      { ...common, status: "published", featuredUntil: NOW + 3 },
      { ...common, status: "archived", archiveReason: "expired" },
      {
        ...common,
        status: "withdrawn",
        withdrawReason: "duplicate",
        mergedInto: refs.entryId,
      },
    ];
  },
  rawItems: (refs) => {
    const common: Omit<TableDoc<"rawItems">, "state"> = {
      sourceKey: "form",
      externalId: "form-1",
      text: "Nabór do akceleratora",
      url: "https://example.org/form-1",
      postedAt: NOW,
      receivedAt: NOW,
      contentHash: "a".repeat(64),
      submittedBy: refs.userId,
    };
    const extraction = { ok: true, provider: "mock", model: "mock" } as const;
    return [
      {
        ...common,
        state: "processed",
        extraction: {
          ...extraction,
          relevant: true,
          confidence: 0.9,
          processedAt: NOW,
        },
        entryId: refs.entryId,
      },
      {
        ...common,
        state: "discarded",
        discardReason: "irrelevant",
        extraction: {
          ...extraction,
          relevant: false,
          confidence: 0.95,
          processedAt: NOW,
        },
      },
    ];
  },
  sources: () => [
    {
      key: "startupywpolsce-wa",
      name: "StartupywPolsce.pl",
      kind: "whatsapp",
      ingestTokenHash: "b".repeat(64),
      ingestTokenRotatedAt: NOW,
      noCrosspost: true,
      newsSiteOnly: true,
      attribution: { name: "StartupywPolsce.pl", url: "https://example.org" },
      promoLine: "Promo",
      lastRunAt: NOW,
      lastItemCount: 3,
      lastNonEmptyAt: NOW,
      lastError: "timeout",
    },
  ],
  programs: () => [
    {
      name: "Akcelerator",
      slug: "akcelerator",
      kind: "accelerator",
      url: "https://example.org/akcelerator",
    },
  ],
  discordRoutes: () => [
    {
      entryType: "szkolenie",
      tag: "free",
      channelId: "111",
      channelName: "szkolenia",
      channelKind: "announcement",
      pingRoleId: "222",
      pingPolicy: "new",
      crosspost: true,
    },
  ],
  discordPosts: (refs) => [
    {
      entryId: refs.entryId,
      kind: "main",
      channelId: "111",
      messageId: "333",
      threadId: "444",
      contentHash: "c".repeat(64),
      pinned: true,
      crosspostedAt: NOW,
      remindedAt: NOW,
      archivedAt: NOW,
      deletedAt: NOW,
    },
  ],
  discordOutbox: (refs) => {
    const common = {
      entryId: refs.entryId,
      action: "create",
      channelId: "111",
      nonce: "abcdefghij0123456789",
    } as const;
    return [
      {
        ...common,
        status: "pending",
        attempts: 1,
        nextAttemptAt: NOW + 60_000,
        lastAttemptAt: NOW,
        lastError: "503",
        scheduledFunctionId: refs.scheduledFunctionId,
      },
      {
        ...common,
        status: "sent",
        attempts: 2,
        lastAttemptAt: NOW,
        sentAt: NOW,
        suppressNotifications: true,
      },
      {
        ...common,
        status: "skipped",
        attempts: 0,
        skipReason: "backlog_skipped",
      },
    ];
  },
  switches: (refs) => [
    {
      key: "discord",
      enabled: false,
      updatedAt: NOW,
      updatedBy: refs.userId,
    },
  ],
  switchLog: (refs) => [
    {
      key: "discord",
      from: false,
      to: true,
      at: NOW,
      by: refs.userId,
      reason: "launch",
      backlog: "send",
      backlogCount: 4,
    },
  ],
  profiles: (refs) => [
    {
      userId: refs.userId,
      role: "moderator",
      displayName: "Ola",
      discordUserId: "555",
    },
  ],
  roleLog: (refs) => [
    {
      userId: refs.userId,
      from: "user",
      to: "admin",
      at: NOW,
      by: refs.userId,
    },
  ],
};

const TABLES = Object.keys(SPEC) as AppTable[];

function requiredFields(table: AppTable) {
  return Object.entries(SPEC[table])
    .filter(([, type]) => !type.endsWith("?"))
    .map(([field]) => field);
}

function without(doc: object, fields: string[]) {
  return Object.fromEntries(
    Object.entries(doc).filter(([field]) => !fields.includes(field)),
  );
}

function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  return { t, refs: seedRefs(t) };
}

afterEach(() => {
  vi.useRealTimers();
});

function seedRefs(t: TestConvex): Promise<Refs> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const programId = await ctx.db.insert("programs", {
      name: "Inkubator",
      slug: "inkubator",
      kind: "incubator",
    });
    const rawItemId = await ctx.db.insert("rawItems", {
      sourceKey: "manual",
      externalId: "seed",
      text: "seed",
      receivedAt: NOW,
      contentHash: "d".repeat(64),
      state: "waiting_ai",
    });
    const entryId = await ctx.db.insert("entries", {
      slug: "seed",
      type: "news",
      title: "Seed",
      summary: "Seed",
      tags: [],
      status: "pending",
      sponsored: false,
      sourceKey: "manual",
      attributionSourceKeys: [],
      noCrosspost: false,
      discordPing: false,
      searchText: "seed",
      sortAt: NOW,
      updatedAt: NOW,
    });
    // Only a real scheduler id passes v.id("_scheduled_functions"); fake timers keep the job from running.
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      60_000,
      makeFunctionReference<"mutation">("schema:unused"),
      {},
    );
    return { userId, programId, rawItemId, entryId, scheduledFunctionId };
  });
}

function insertUnchecked(t: TestConvex, table: AppTable, doc: object) {
  // Deliberately invalid documents have no static type; the runtime validator is under test.
  return t.run((ctx) => ctx.db.insert(table, doc as never));
}

describe("enums (§4.1)", () => {
  it.each([
    ["EntryType", entryTypeValidator],
    ["EntryStatus", entryStatusValidator],
    ["ArchiveReason", archiveReasonValidator],
    ["WithdrawReason", withdrawReasonValidator],
    ["Stage", stageValidator],
    ["Cost", costValidator],
    ["Role", roleValidator],
    ["SourceKind", sourceKindValidator],
    ["RawItemState", rawItemStateValidator],
    ["DiscardReason", discardReasonValidator],
    ["ChannelKind", channelKindValidator],
    ["PingPolicy", pingPolicyValidator],
    ["OutboxAction", outboxActionValidator],
    ["OutboxStatus", outboxStatusValidator],
    ["PostKind", postKindValidator],
    ["ProgramKind", programKindValidator],
  ] as const)("%s has the spec values in spec order", (name, validator) => {
    expect(describeValidator(validator)).toBe(ENUMS[name]);
  });
});

describe("schema shape (§4)", () => {
  it("contains the auth tables and every §4 table", () => {
    expect(Object.keys(schema.tables).sort()).toEqual(
      [...TABLES, ...Object.keys(authTables)].sort(),
    );
  });

  it.each(TABLES)(
    "%s declares exactly the §4 fields, types and optionality",
    (table) => {
      expect(describeTableFields(schema.tables[table].validator)).toEqual(
        SPEC[table],
      );
    },
  );

  it.each(TABLES)(
    "%s declares exactly the §4 indexes and search indexes",
    (table) => {
      const exported = exportedTable(table);
      expect(
        Object.fromEntries(
          exported.indexes.map(({ indexDescriptor, fields }) => [
            indexDescriptor,
            fields,
          ]),
        ),
      ).toEqual(SPEC_INDEXES[table]);
      expect(exported.searchIndexes).toEqual(
        table === "entries" ? [SPEC_SEARCH_INDEX] : [],
      );
      expect({
        stagedDbIndexes: exported.stagedDbIndexes,
        stagedSearchIndexes: exported.stagedSearchIndexes,
        vectorIndexes: exported.vectorIndexes,
        stagedVectorIndexes: exported.stagedVectorIndexes,
      }).toEqual({
        stagedDbIndexes: [],
        stagedSearchIndexes: [],
        vectorIndexes: [],
        stagedVectorIndexes: [],
      });
    },
  );
});

describe("fixtures", () => {
  it.each(TABLES)(
    "%s fixtures obey the §4 conditional field rules",
    async (table) => {
      const { refs } = setup();
      for (const doc of VALID_DOCS[table](await refs)) {
        expect(ruleViolations(table, doc)).toEqual([]);
      }
    },
  );

  it.each(TABLES)("%s fixtures together set every §4 field", async (table) => {
    const { refs } = setup();
    const setFields = new Set(
      VALID_DOCS[table](await refs).flatMap((doc) =>
        Object.entries(doc)
          .filter(([, value]) => value !== undefined)
          .map(([field]) => field),
      ),
    );
    expect([...setFields].sort()).toEqual(Object.keys(SPEC[table]).sort());
  });

  it.each([
    [
      "entries",
      {
        status: "archived",
        archiveReason: "expired",
        withdrawReason: "duplicate",
      },
    ],
    ["entries", { status: "withdrawn" }],
    [
      "entries",
      { status: "archived", archiveReason: "expired", featuredUntil: NOW },
    ],
    [
      "rawItems",
      { state: "processed", entryId: "e", discardReason: "prefilter" },
    ],
    [
      "rawItems",
      { state: "discarded", discardReason: "irrelevant", entryId: "e" },
    ],
    ["sources", { ingestTokenHash: "h" }],
    ["discordOutbox", { status: "failed", skipReason: "backlog_skipped" }],
  ] as const)("the rule check rejects %s %j", (table, doc) => {
    expect(ruleViolations(table, doc)).not.toEqual([]);
  });
});

describe("documents (§4, CTO N2)", () => {
  it.each(TABLES)(
    "%s accepts every fixture and reads it back",
    async (table) => {
      const { t, refs } = setup();
      for (const doc of VALID_DOCS[table](await refs)) {
        const id = await insertUnchecked(t, table, doc);
        const stored = await t.run((ctx) => ctx.db.get(id));
        expect(stored).toMatchObject(doc);
      }
    },
  );

  it.each(TABLES)(
    "%s accepts a document with only the required fields",
    async (table) => {
      const { t, refs } = setup();
      const optional = Object.keys(SPEC[table]).filter(
        (field) => !requiredFields(table).includes(field),
      );
      await expect(
        insertUnchecked(
          t,
          table,
          without(VALID_DOCS[table](await refs)[0], optional),
        ),
      ).resolves.toBeTypeOf("string");
    },
  );

  it.each(
    TABLES.flatMap((table) =>
      requiredFields(table).map((field) => [table, field] as const),
    ),
  )("%s rejects a document missing required %s", async (table, field) => {
    const { t, refs } = setup();
    await expect(
      insertUnchecked(
        t,
        table,
        without(VALID_DOCS[table](await refs)[0], [field]),
      ),
    ).rejects.toThrow(/Validator error/);
  });

  it("rawItems accepts both extraction shapes and rejects ok: false without errorCode", async () => {
    const { t, refs } = setup();
    const processed = pick(
      VALID_DOCS.rawItems(await refs),
      (doc) => doc.state === "processed",
    );
    const failed = {
      ok: false,
      provider: "openai-compatible",
      model: "m",
      errorCode: "timeout",
      processedAt: NOW,
    };
    const manual = {
      ...without(processed, ["entryId"]),
      state: "manual",
      extraction: failed,
    };

    await expect(insertUnchecked(t, "rawItems", processed)).resolves.toBeTypeOf(
      "string",
    );
    await expect(insertUnchecked(t, "rawItems", manual)).resolves.toBeTypeOf(
      "string",
    );
    await expect(
      insertUnchecked(t, "rawItems", {
        ...manual,
        extraction: without(failed, ["errorCode"]),
      }),
    ).rejects.toThrow(/Validator error/);
  });

  it("discordOutbox accepts a skipped row with skipReason recheck_refused", async () => {
    const { t, refs } = setup();
    const row = {
      ...pick(
        VALID_DOCS.discordOutbox(await refs),
        (doc) => doc.status === "skipped",
      ),
      skipReason: "recheck_refused",
    };
    await expect(insertUnchecked(t, "discordOutbox", row)).resolves.toBeTypeOf(
      "string",
    );
  });

  it("entries search index search_text filters by status and type", async () => {
    const { t, refs } = setup();
    const entry = {
      ...pick(
        VALID_DOCS.entries(await refs),
        (doc) => doc.status === "published",
      ),
      type: "konkurs" as const,
    };
    const id = await insertUnchecked(t, "entries", entry);
    const hits = await t.run((ctx) =>
      ctx.db
        .query("entries")
        .withSearchIndex("search_text", (q) =>
          q
            .search("searchText", "startupów")
            .eq("status", "published")
            .eq("type", "konkurs"),
        )
        .collect(),
    );
    expect(hits.map((hit) => hit._id)).toEqual([id]);
  });
});
