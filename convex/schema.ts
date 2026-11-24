import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";
import { accountsTables } from "./accounts/tables";
import { discordTables } from "./discord/tables";
import { entriesTables } from "./entries/tables";
import { ingestTables } from "./ingest/tables";
import { programsTables } from "./programs/tables";
import { sourcesTables } from "./sources/tables";
import { switchesTables } from "./switches/tables";

export default defineSchema({
  ...authTables,
  ...entriesTables,
  ...ingestTables,
  ...sourcesTables,
  ...programsTables,
  ...discordTables,
  ...switchesTables,
  ...accountsTables,
});
