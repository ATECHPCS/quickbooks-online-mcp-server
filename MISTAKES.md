# MISTAKES.md

## Enforced Rules (check every task)

## Patterns (promote at 3 hits)

## Observations (first sightings)
- 2026-11-10: Entity tool schemas used `z.any()` (`{ purchase: z.any() }`), so a call with the fields flat in `params` validated with the entity undefined; node-quickbooks POSTed an empty body and QBO returned `SAXParseException; Premature end of file` (500). Build create/update schemas with `entityParams(key)` from `src/helpers/entity-params.ts`, never a bare `z.any()` entity. (hits: 1)
