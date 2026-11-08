import type { DocGap } from "@workspace/shared";

// Neutral module: storage must not depend on route registration.
export class DocumentationError extends Error {
  constructor(message: string, public gaps?: DocGap[], public reasons?: string[]) {
    super(message);
    this.name = "DocumentationError";
  }
}
