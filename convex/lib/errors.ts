import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "switch_off"
  | "not_found"
  | "invalid"
  | "conflict"
  | "rate_limited";

export function appError(code: AppErrorCode, message?: string): never {
  throw new ConvexError<{ code: AppErrorCode; message?: string }>(
    message === undefined ? { code } : { code, message },
  );
}
