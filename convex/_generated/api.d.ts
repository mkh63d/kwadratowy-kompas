/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts_tables from "../accounts/tables.js";
import type * as ai_config from "../ai/config.js";
import type * as ai_index from "../ai/index.js";
import type * as ai_mock from "../ai/mock.js";
import type * as ai_openaiCompatible from "../ai/openaiCompatible.js";
import type * as ai_types from "../ai/types.js";
import type * as discord_tables from "../discord/tables.js";
import type * as entries_tables from "../entries/tables.js";
import type * as health_queries from "../health/queries.js";
import type * as ingest_tables from "../ingest/tables.js";
import type * as lib_entries from "../lib/entries.js";
import type * as lib_enums from "../lib/enums.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_switches from "../lib/switches.js";
import type * as lib_testing_fixtures from "../lib/testing/fixtures.js";
import type * as lib_visibility from "../lib/visibility.js";
import type * as programs_tables from "../programs/tables.js";
import type * as sources_seed from "../sources/seed.js";
import type * as sources_tables from "../sources/tables.js";
import type * as switches_backlog from "../switches/backlog.js";
import type * as switches_cli from "../switches/cli.js";
import type * as switches_mutations from "../switches/mutations.js";
import type * as switches_queries from "../switches/queries.js";
import type * as switches_tables from "../switches/tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "accounts/tables": typeof accounts_tables;
  "ai/config": typeof ai_config;
  "ai/index": typeof ai_index;
  "ai/mock": typeof ai_mock;
  "ai/openaiCompatible": typeof ai_openaiCompatible;
  "ai/types": typeof ai_types;
  "discord/tables": typeof discord_tables;
  "entries/tables": typeof entries_tables;
  "health/queries": typeof health_queries;
  "ingest/tables": typeof ingest_tables;
  "lib/entries": typeof lib_entries;
  "lib/enums": typeof lib_enums;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/switches": typeof lib_switches;
  "lib/testing/fixtures": typeof lib_testing_fixtures;
  "lib/visibility": typeof lib_visibility;
  "programs/tables": typeof programs_tables;
  "sources/seed": typeof sources_seed;
  "sources/tables": typeof sources_tables;
  "switches/backlog": typeof switches_backlog;
  "switches/cli": typeof switches_cli;
  "switches/mutations": typeof switches_mutations;
  "switches/queries": typeof switches_queries;
  "switches/tables": typeof switches_tables;
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
