import { defineSchema } from "convex/server";
import { notesTables } from "./notes/tables";

export default defineSchema({
  ...notesTables,
});
