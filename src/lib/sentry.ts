import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/react";

const FILTERED = "[Filtered]";
const MAX_DEPTH = 8;

const SENSITIVE_WORD =
  "prompt|api[-_]?key|token|authorization|password|secret|cookie|credential";
const SENSITIVE_KEY = new RegExp(SENSITIVE_WORD, "i");
// Case-sensitive on purpose: a bare /ai/i would also hit "email" or "detail".
// Covers `ai`, `ai_x`, `aiResponse`, `AI_API_KEY` and a camelCase segment as in `openAiKey`.
const AI_KEY = /(^|[-_.])(ai|AI)($|[-_.A-Z])|[a-z]Ai($|[-_.A-Z0-9])/;
const CONTENT_KEY = /^(messages?|content|text|summary|notes?)$/i;
const BODY_KEYS = [
  "body",
  "request_body",
  "requestBody",
  "response_body",
  "responseBody",
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || AI_KEY.test(key) || CONTENT_KEY.test(key);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function filterQueryPair(match: string, sep: string, key: string): string {
  return isSensitiveKey(safeDecode(key)) ? `${sep}${key}=${FILTERED}` : match;
}

// Beyond this the regexes below can go super-linear on hostile input, and Sentry truncates long
// values anyway. The tail is dropped, not passed through, so nothing unscrubbed survives.
const MAX_INPUT = 8192;

export function scrubUrl(url: string): string {
  return url
    .slice(0, MAX_INPUT)
    .replace(/([?&;#])([^=&#;?]*)=([^&#;]*)/g, filterQueryPair);
}

// In prose a pair ends at whitespace, so the words after a URL survive.
// Covers absolute, relative and //host URLs and bare "a=1&b=2" strings alike.
// The key class excludes "?" so a run of "?" cannot be rescanned from every position.
const QUERY_PAIR_IN_TEXT = /([?&;#])([^=&#;?\s]*)=([^&#;\s]*)/g;
const BEARER = /\bBearer\s+\S+/gi;

const SENSITIVE_ASSIGNMENT = new RegExp(
  `(?<![?&;#])\\b(\\w*(?:${SENSITIVE_WORD})\\w*)\\s*[:=]\\s*[^\\r\\n]*`,
  "gi",
);

// Error messages are free text: filter what can be recognised, and cut Convex validator
// errors where they start echoing the rejected value ("Value: ...").
export function scrubText(input: string): string {
  const text = input.slice(0, MAX_INPUT);
  const valueLine = text.search(/\r?\n[ \t]*Value:/);
  const head = valueLine === -1 ? text : text.slice(0, valueLine);
  const scrubbed = head
    .replace(QUERY_PAIR_IN_TEXT, filterQueryPair)
    .replace(BEARER, `Bearer ${FILTERED}`)
    .replace(SENSITIVE_ASSIGNMENT, `$1: ${FILTERED}`);
  return valueLine === -1 ? scrubbed : `${scrubbed}\n${FILTERED}`;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return FILTERED;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        isSensitiveKey(key) ? FILTERED : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console output can carry prompts or model answers.
  if (breadcrumb.category === "console") return null;
  const scrubbed: Breadcrumb = { ...breadcrumb };
  if (breadcrumb.message) scrubbed.message = scrubText(breadcrumb.message);
  if (!breadcrumb.data) return scrubbed;
  const data = redact(breadcrumb.data) as Record<string, unknown>;
  for (const key of BODY_KEYS) delete data[key];
  for (const key of ["url", "from", "to"]) {
    if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
  }
  scrubbed.data = data;
  return scrubbed;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  if (event.message) scrubbed.message = scrubText(event.message);
  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((exception) =>
        exception.value
          ? { ...exception, value: scrubText(exception.value) }
          : exception,
      ),
    };
  }
  if (event.request) {
    const request = { ...event.request };
    delete request.data;
    delete request.cookies;
    if (request.headers) {
      request.headers = redact(request.headers) as Record<string, string>;
    }
    if (request.url) request.url = scrubUrl(request.url);
    if (typeof request.query_string === "string") {
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string) {
      request.query_string = redact(request.query_string) as never;
    }
    scrubbed.request = request;
  }
  if (event.extra) scrubbed.extra = redact(event.extra) as typeof event.extra;
  if (event.contexts) {
    scrubbed.contexts = redact(event.contexts) as typeof event.contexts;
  }
  if (event.tags) scrubbed.tags = redact(event.tags) as typeof event.tags;
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return scrubbed;
}

export type SentryOptions = {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
};

// v11 collects almost everything by default (user info and IP inference, cookies, all headers,
// HTTP and AI bodies, query params), so each source is switched off explicitly.
export const DATA_COLLECTION: NonNullable<BrowserOptions["dataCollection"]> = {
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
};

// The dynamic import keeps @sentry/react out of the default bundle: it is only fetched with a DSN.
export async function initSentry(options: SentryOptions): Promise<boolean> {
  if (!options.dsn) return false;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    dataCollection: DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
}
