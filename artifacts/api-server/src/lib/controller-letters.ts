import { controllerNameFor } from "@workspace/shared";

export type LetterHolder = { id: number; letter: string | null; location: string | null };
export class LetterError extends Error {
  constructor(public status: number, message: string, public details: { holder?: LetterHolder } = {}) {
    super(message);
    this.name = "LetterError";
  }
}

export function letterConflict(holder: LetterHolder): LetterError {
  return new LetterError(409, `Letter ${holder.letter} is used by ${controllerNameFor(holder.letter!)}`, {
    holder: { id: holder.id, letter: holder.letter, location: holder.location },
  });
}

/** Preserve meaningful legacy names only when a person writes the letter. */
export function notesWithFormerName(name: string, notes: string | null): string | null {
  if (!name.trim() || /^\s*(controller|clock)\s+[a-z]\s*$/i.test(name)) return notes;
  const entry = `Formerly named: ${name}`;
  return notes?.includes(entry) ? notes : `${entry}\n${notes ?? ""}`;
}
