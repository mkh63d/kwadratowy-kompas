/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_config from "../ai/config.js";
import type * as ai_index from "../ai/index.js";
import type * as ai_mock from "../ai/mock.js";
import type * as ai_openaiCompatible from "../ai/openaiCompatible.js";
import type * as ai_types from "../ai/types.js";
import type * as notes_actions from "../notes/actions.js";
import type * as notes_limits from "../notes/limits.js";
import type * as notes_mutations from "../notes/mutations.js";
import type * as notes_queries from "../notes/queries.js";
import type * as notes_seed from "../notes/seed.js";
import type * as notes_tables from "../notes/tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/config": typeof ai_config;
  "ai/index": typeof ai_index;
  "ai/mock": typeof ai_mock;
  "ai/openaiCompatible": typeof ai_openaiCompatible;
  "ai/types": typeof ai_types;
  "notes/actions": typeof notes_actions;
  "notes/limits": typeof notes_limits;
  "notes/mutations": typeof notes_mutations;
  "notes/queries": typeof notes_queries;
  "notes/seed": typeof notes_seed;
  "notes/tables": typeof notes_tables;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
