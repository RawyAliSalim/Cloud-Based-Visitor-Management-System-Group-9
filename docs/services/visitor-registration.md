# Visitor Registration Service

Owner: Rawy Ali Salim

## Business rules

| Rule | Where | Response |
|---|---|---|
| Names must start with a letter and only contain letters, digits, spaces, `'`, `.`, `-` (any language). Control characters and repeated spaces are removed. | `visits.controller.js` | 400 `VALIDATION_ERROR` |
| Company and purpose cannot contain `<` or `>` | `visits.controller.js` | 400 |
| Expected arrival: not in the past (5 min grace), not more than 90 days ahead | `visits.controller.js` | 400 |
| Empty `email` / `phone` mean "not given" (create) or "remove" (edit by staff) | `registration.service.js` | - |
| **Returning visitor recognition:** a registration without `visitorId` whose email or phone (spaces and dashes ignored) matches a saved visitor with the same name reuses that record. Missing details are filled in; saved values are never overwritten. | `registration.service.js` | 201, `registration: { returning: true, matchedBy: "email" \| "phone" }` |
| **No duplicate visitor records:** an email or phone that belongs to a different visitor (different name, or email of one visitor plus phone of another) is refused. The response does not reveal who owns it. Enforced in the database too, by unique indexes on `emailKey` / `phoneKey`. | `registration.service.js`, `Visitor.js` | 409 `VISITOR_CONTACT_CONFLICT` |
| **No duplicate visits:** the same visitor cannot have two Expected / Checked-in visits with the same host within ±2 hours (`DUPLICATE_VISIT_WINDOW_MINUTES`). Checked on create and when an edit moves the host or time. Cancelled and checked-out visits do not count. | `registration.service.js` | 409 `DUPLICATE_VISIT`, `details.visitId` = existing visit |
| **Idempotent registration:** `POST /api/visits` accepts an `Idempotency-Key` header. Repeating the same request returns the original visit (200, `Idempotent-Replayed: true`); the same key with different data is refused. The web app sends one key per submission, so double clicks and retries create one visit. | `visits.controller.js`, `Visit.registrationKey` | 200 / 409 `IDEMPOTENCY_KEY_REUSED` |
| Hosts cannot register a visit against an existing `visitorId` (they cannot look visitors up) | `visits.controller.js` | 403 |
| Hosts cannot change a visitor's email or phone, and cannot rename a visitor who also visits other hosts | `visits.controller.js` | 403 `FORBIDDEN` / `VISITOR_SHARED` |

## Endpoints added or changed

| Method | Endpoint | Roles | Notes |
|---|---|---|---|
| POST | `/api/visits` | host, front-desk, admin | Optional `Idempotency-Key` header; response has `registration` |
| GET | `/api/visitors?search=` | front-desk, admin | Each result now has `visitCount`, `completedVisits`, `activeVisits`, `lastVisitAt`, `returningVisitor`. Phone search ignores spaces. |
| GET | `/api/visitors/:id` | front-desk, admin | Visitor profile with the same counts and the last 20 visits |

## Tests
`tests/integration/registration.test.js`: validation, returning visitors (email and phone), contact conflicts, concurrent registrations of the same new visitor, duplicate visits, idempotency keys and host editing rules.

## Note for existing databases
The unique indexes only cover visitor records that have `emailKey` / `phoneKey`, which are set for every new or updated visitor. Older records are still matched by `email` and get their key the next time they are reused.
