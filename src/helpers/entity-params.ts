import { z } from "zod";

/**
 * Params schema for tools that send one QBO entity, e.g. `{ purchase: {...} }`.
 *
 * The entity is required and must be a non-empty object. With `z.any()` a call
 * that sent the fields flat (`{ VendorRef, Line, ... }`) passed validation with
 * the entity undefined, and QBO answered the empty POST body with
 * "SAXParseException; Premature end of file" (code 500).
 *
 * Flat fields are wrapped under `key`, and a JSON string is parsed, before validation.
 */
export function entityParams(key: string) {
  return z.preprocess(
    (value: any) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      if (!(key in value)) {
        return Object.keys(value).length > 0 ? { [key]: value } : value;
      }
      if (typeof value[key] === "string") {
        try {
          return { ...value, [key]: JSON.parse(value[key]) };
        } catch {
          return value;
        }
      }
      return value;
    },
    z.object({
      [key]: z
        .record(z.any())
        .refine((entity) => Object.keys(entity).length > 0, {
          message: `${key} must be a non-empty QuickBooks object`,
        })
        .describe(`The QuickBooks ${key} object, e.g. { "${key}": { ...fields } }`),
    })
  );
}
