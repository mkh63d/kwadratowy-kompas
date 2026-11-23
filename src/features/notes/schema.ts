import { z } from "zod";
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from "../../../convex/notes/limits";

export const noteFormSchema = z.object({
  text: z
    .string()
    .trim()
    .min(MIN_NOTE_LENGTH, "Wpisz treść notatki.")
    .max(
      MAX_NOTE_LENGTH,
      `Notatka może mieć najwyżej ${MAX_NOTE_LENGTH} znaków.`,
    ),
});

export type NoteForm = z.infer<typeof noteFormSchema>;
