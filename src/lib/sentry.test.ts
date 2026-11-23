import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";
import {
  initSentry,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
} from "./sentry";

const sentryInit = vi.hoisted(() => vi.fn());
vi.mock("@sentry/react", () => ({ init: sentryInit }));

const baseEvent = (overrides: Partial<ErrorEvent>): ErrorEvent => ({
  type: undefined,
  ...overrides,
});

describe("initSentry", () => {
  beforeEach(() => {
    sentryInit.mockClear();
  });

  it("never loads or initialises Sentry without a DSN", async () => {
    const started = await initSentry({
      dsn: undefined,
      environment: "production",
      release: undefined,
    });
    expect(started).toBe(false);
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("initialises with scrubbing hooks when a DSN is set", async () => {
    const started = await initSentry({
      dsn: "https://key@o1.ingest.sentry.io/1",
      environment: "production",
      release: "abc123",
    });
    expect(started).toBe(true);
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
        environment: "production",
        release: "abc123",
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      }),
    );
  });

  it("switches off every default data source explicitly", async () => {
    await initSentry({
      dsn: "https://key@o1.ingest.sentry.io/1",
      environment: "production",
      release: undefined,
    });
    const options = sentryInit.mock.calls[0]![0] as {
      dataCollection: unknown;
    };
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["User-Agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe("DSN env parsing", () => {
  it("treats a missing or empty DSN as unset", () => {
    expect(parseEnv({}).sentryDsn).toBeUndefined();
    expect(parseEnv({ VITE_SENTRY_DSN: "" }).sentryDsn).toBeUndefined();
  });

  it("accepts a valid DSN and rejects garbage", () => {
    const dsn = "https://key@o1.ingest.sentry.io/1";
    expect(parseEnv({ VITE_SENTRY_DSN: dsn }).sentryDsn).toBe(dsn);
    expect(() => parseEnv({ VITE_SENTRY_DSN: "nope" })).toThrow(
      /VITE_SENTRY_DSN/,
    );
  });

  it("passes the commit SHA through as the release", () => {
    expect(parseEnv({ VITE_COMMIT_SHA: " abc " }).commitSha).toBe("abc");
    expect(parseEnv({ VITE_COMMIT_SHA: "" }).commitSha).toBeUndefined();
  });
});

describe("scrubUrl", () => {
  it("filters token-like query and fragment values only", () => {
    expect(
      scrubUrl("/cb?code=1&access_token=secret&page=2#id_token=xyz&ok=1"),
    ).toBe(
      "/cb?code=1&access_token=[Filtered]&page=2#id_token=[Filtered]&ok=1",
    );
  });

  it("survives malformed percent-encoding", () => {
    expect(scrubUrl("/x?a%zz=1&token=2")).toBe("/x?a%zz=1&token=[Filtered]");
  });

  it("filters AI-related parameters but keeps look-alikes", () => {
    expect(scrubUrl("/x?ai=hi&aiModel=m&email=a&detail=b")).toBe(
      "/x?ai=[Filtered]&aiModel=[Filtered]&email=a&detail=b",
    );
  });
});

describe("hostile input", () => {
  const inputs: [string, string][] = [
    ["'?' x 100000", "?".repeat(100_000)],
    ["'?a' x 50000", "?a".repeat(50_000)],
    ["'token' x 10000", "token".repeat(10_000)],
  ];

  it.each(inputs)("scrubText stays fast on %s", (_name, input) => {
    const start = performance.now();
    scrubText(input);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it.each(inputs)("scrubUrl stays fast on %s", (_name, input) => {
    const start = performance.now();
    scrubUrl(input);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("scrubText stays fast on a run of newlines", () => {
    const start = performance.now();
    scrubText(`${"\n".repeat(8192)}x`);
    expect(performance.now() - start).toBeLessThan(10);
  });

  it("drops the tail beyond the cap instead of passing it through", () => {
    const out = scrubText(`${"x".repeat(9000)} token=secret`);
    expect(out).toHaveLength(8192);
    expect(out).not.toContain("secret");
  });
});

describe("scrubText", () => {
  it.each([
    [
      "GET /api/notes?token=abc failed",
      "GET /api/notes?token=[Filtered] failed",
    ],
    [
      "request q=1&apiKey=sk-live-1 failed",
      "request q=1&apiKey=[Filtered] failed",
    ],
    [
      "fetch //cdn.test/x?access_token=t failed",
      "fetch //cdn.test/x?access_token=[Filtered] failed",
    ],
    ["see /cb#id_token=xyz now", "see /cb#id_token=[Filtered] now"],
    ["GET /api?page=2&sort=asc failed", "GET /api?page=2&sort=asc failed"],
  ])("filters query pairs in prose: %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    ["Bearer sk-abc123 rejected", "Bearer [Filtered] rejected"],
    [
      "Authorization header: Bearer xyz",
      "Authorization header: Bearer [Filtered]",
    ],
  ])("filters bearer tokens: %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("leaves harmless text alone", () => {
    expect(scrubText("Network request failed (status 500)")).toBe(
      "Network request failed (status 500)",
    );
  });
});

describe("scrubEvent", () => {
  it("drops request bodies and cookies and scrubs headers and URLs", () => {
    const event = scrubEvent(
      baseEvent({
        request: {
          url: "https://app.test/page?token=abc&view=1",
          query_string: "apiKey=k&view=1",
          data: { prompt: "tell me secrets" },
          cookies: { session: "s" },
          headers: { Authorization: "Bearer x", Accept: "text/html" },
        },
      }),
    );
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.url).toBe(
      "https://app.test/page?token=[Filtered]&view=1",
    );
    expect(event.request?.query_string).toBe("apiKey=[Filtered]&view=1");
    expect(event.request?.headers).toEqual({
      Authorization: "[Filtered]",
      Accept: "text/html",
    });
  });

  it("redacts sensitive keys at any depth in extra, contexts and tags", () => {
    const event = scrubEvent(
      baseEvent({
        extra: {
          prompt: "p",
          nested: { list: [{ AI_API_KEY: "k", keep: 1 }], password: "pw" },
          aiResponse: "r",
          email: "kept",
        },
        contexts: { custom: { authorization: "a", label: "n" } },
        tags: { token: "t", area: "notes" },
      }),
    );
    expect(event.extra).toEqual({
      prompt: "[Filtered]",
      nested: {
        list: [{ AI_API_KEY: "[Filtered]", keep: 1 }],
        password: "[Filtered]",
      },
      aiResponse: "[Filtered]",
      email: "kept",
    });
    expect(event.contexts).toEqual({
      custom: { authorization: "[Filtered]", label: "n" },
    });
    expect(event.tags).toEqual({ token: "[Filtered]", area: "notes" });
  });

  it("filters camelCase AI segments and content-shaped keys", () => {
    const event = scrubEvent(
      baseEvent({
        extra: {
          openAiKey: "k",
          messages: ["hi"],
          content: "c",
          text: "t",
          summary: "s",
          note: "n",
          context: "kept",
          maid: "kept",
        },
      }),
    );
    expect(event.extra).toEqual({
      openAiKey: "[Filtered]",
      messages: "[Filtered]",
      content: "[Filtered]",
      text: "[Filtered]",
      summary: "[Filtered]",
      note: "[Filtered]",
      context: "kept",
      maid: "kept",
    });
  });

  it("scrubs a prompt inside exception.values[].value and the message", () => {
    const event = scrubEvent(
      baseEvent({
        message: "failed prompt: my secret diary",
        exception: {
          values: [
            {
              type: "Error",
              value:
                "summarize failed, prompt: my secret diary https://x.test/?token=abc",
            },
            { type: "Error" },
          ],
        },
      }),
    );
    expect(event.message).toBe("failed prompt: [Filtered]");
    expect(event.exception?.values?.[0]?.value).not.toMatch(/diary|abc/);
    expect(event.exception?.values?.[1]).toEqual({ type: "Error" });
  });

  it("cuts Convex validator text where it echoes the rejected value", () => {
    const value =
      "[Request ID: r1] Server Error\nArgumentValidationError: bad args\nPath: .text\nValue: my private note\nValidator: v.string()";
    const event = scrubEvent(
      baseEvent({ exception: { values: [{ type: "Error", value }] } }),
    );
    const scrubbed = event.exception?.values?.[0]?.value;
    expect(scrubbed).not.toMatch(/private note|Validator/);
    expect(scrubbed).toContain("ArgumentValidationError");
  });

  it("filters a token URL inside a message", () => {
    const event = scrubEvent(
      baseEvent({
        message: "fetch https://api.test/v1?api_key=sk-123&page=2 failed",
      }),
    );
    expect(event.message).toBe(
      "fetch https://api.test/v1?api_key=[Filtered]&page=2 failed",
    );
  });

  it("filters a token in the Referer header", () => {
    const event = scrubEvent(
      baseEvent({
        request: {
          headers: {
            Referer: "https://login.test/cb?access_token=leak&x=1",
            "User-Agent": "UA",
          },
        },
      }),
    );
    expect(event.request?.headers).toEqual({
      Referer: "https://login.test/cb?access_token=[Filtered]&x=1",
      "User-Agent": "UA",
    });
  });

  it("scrubs breadcrumbs inside the event and drops console ones", () => {
    const event = scrubEvent(
      baseEvent({
        breadcrumbs: [
          { category: "console", message: "prompt: hello" },
          {
            category: "fetch",
            data: { url: "/api?token=1", body: "{}", method: "POST" },
          },
        ],
      }),
    );
    expect(event.breadcrumbs).toEqual([
      {
        category: "fetch",
        data: { url: "/api?token=[Filtered]", method: "POST" },
      },
    ]);
  });

  it("does not mutate the original event", () => {
    const original = baseEvent({
      request: { data: "x", url: "/a?token=1" },
      extra: { prompt: "p" },
    });
    scrubEvent(original);
    expect(original.request?.data).toBe("x");
    expect(original.extra).toEqual({ prompt: "p" });
  });
});

describe("scrubBreadcrumb", () => {
  it("keeps harmless breadcrumbs without data", () => {
    const crumb: Breadcrumb = { category: "ui.click", message: "button" };
    expect(scrubBreadcrumb(crumb)).toEqual(crumb);
  });

  it("scrubs the message of sentry.event breadcrumbs", () => {
    const crumb = scrubBreadcrumb({
      category: "sentry.event",
      message: "Error: prompt: my diary https://x.test/?token=abc",
    });
    expect(crumb?.message).not.toMatch(/diary|abc/);
  });

  it("drops response bodies as well as request bodies", () => {
    expect(
      scrubBreadcrumb({
        category: "xhr",
        data: { response_body: "r", responseBody: "r", request_body: "q" },
      })?.data,
    ).toEqual({});
  });

  it("filters navigation URLs", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        data: { from: "/a", to: "/b?password=1" },
      }),
    ).toEqual({
      category: "navigation",
      data: { from: "/a", to: "/b?password=[Filtered]" },
    });
  });
});
