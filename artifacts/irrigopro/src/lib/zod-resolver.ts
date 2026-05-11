import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod/v4";

// Wrapper that re-types the v5 zod resolver so it lines up with whatever
// TFieldValues the call-site's `useForm<X>` uses. Several call sites pass
// a conditional/union of zod schemas (e.g. super-admin-dashboard's
// company-vs-admin form) or use the schema's *input* type as the form's
// TFieldValues while the schema produces a transformed *output* type — the
// upstream Resolver generics in RHF v7 + zod v4 do not infer cleanly across
// either of these patterns. Accepting an opaque `ZodType<unknown>` here and
// re-typing the result as `Resolver<TFieldValues>` lets every call site keep
// working without sprinkling `as` casts at each form definition. Runtime
// behavior is unchanged from the upstream resolver.
export function zodResolver<TFieldValues extends FieldValues = FieldValues>(
  schema: ZodType<unknown>,
): Resolver<TFieldValues> {
  return baseZodResolver(schema as never) as Resolver<TFieldValues>;
}
