# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ReMed's backend: NestJS 11 + Drizzle ORM + PostgreSQL. The Expo client lives in the sibling `med-app/` repo (separate git repo; `med_app/` itself is not a repo).

## Commands

```bash
npm run start:dev              # nest start --watch → http://localhost:3002, Swagger at /docs
npm test                       # jest, *.spec.ts under src/ (rootDir is src)
npm test -- schedule.util      # single suite by filename fragment
npm run test:e2e               # jest --config ./test/jest-e2e.json
npm run lint                   # eslint --fix
npm run build                  # nest build → dist/ (prod entry: node dist/src/main)
npm run db:generate            # drizzle-kit generate → drizzle/*.sql
npm run db:push                # drizzle-kit push (the apply path actually used)
npx tsx src/db/seeder/seed-countries.ts   # one-off scripts, run directly with tsx
```

Copy `.env.example` → `.env`. `DATABASE_URL`, `JWT_SECRET`, `GROQ_API_KEY` are required for a working stack. `REVENUECAT_WEBHOOK_SECRET` gates `POST /billing/webhook` (401s while unset). Swagger is on unless `NODE_ENV=production`, where it needs `ENABLE_SWAGGER=true`.

**`db:push` diffs the schema and ignores `drizzle/*.sql`,** so any data migration written into a generated SQL file never runs. Backfills therefore live as idempotent scripts in `src/db/seeder/` (see `backfill-medication-lifecycle.ts`) and are run manually with `tsx` after the push.

## Global wiring

`app.module.ts` / `main.ts` set up, for every request:

- `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform` — **an undeclared field in a request body is a 400, so every accepted field must exist on a DTO.**
- `ThrottlerGuard`, 100 req/min/IP globally; tightened per-route with `@Throttle` (auth login/register 5/min, all AI routes 20/min).
- `AuditInterceptor` — logs every mutation plus any access to `/medication`, `/condition`, `/profile`, `/dose-event`, `/reminder`.
- `AllExceptionsFilter`, CORS from a comma-separated `FRONTEND_URL` allowlist.
- Sentry, wired in four places: `src/instrument.ts` (**imported on main.ts's first line** — the SDK patches express/pg through a require hook, so an init that runs after `import { AppModule }` produces traces with no DB spans; it also calls `dotenv.config()` itself, because `ConfigModule` has not run yet and an unset `SENTRY_DSN` makes the SDK silently no-op), `SentryModule.forRoot()` in `app.module.ts` (note the `@sentry/nestjs/setup` subpath — the package root does not export it), `@SentryExceptionCaptured()` on `AllExceptionsFilter.catch` (**without it the bare `@Catch()` filter swallows every request error before Sentry sees it**), and `@SentryCron` on the six cron jobs. Sample rate defaults to 0.1 in production — the per-minute cron would otherwise eat the quota.

**Database access** is one `@Global` provider: `@Inject(DRIZZLE_CLIENT) db: NodePgDatabase<typeof schema>`. No repositories — services query Drizzle directly. Schema files are `src/db/schema/*.ts`, re-exported via `index.ts` and imported as `* as schema`. Services that write across tables take a `DrizzleExecutor` (root client *or* transaction handle) so they compose inside `db.transaction`.

**Auth** is `JwtAuthGuard` on protected controllers; `req.user.id` is the tenant key and every service filters by it — there is no row-level security, so a query that forgets the `userId` join is a cross-tenant leak.

Sessions are **per device, not per user**. The client sends `X-Device-Id` on every request; `device_sessions` holds one row per (user, device) with its own `expoPushToken` and `tokenVersion`. The JWT carries `deviceId` + `tokenVersion`, and `JwtStrategy.validate` rejects a token whose device session is missing or whose version moved. Consequences: logout revokes only the calling device, and reminders go to every signed-in device because the notification query joins `device_sessions`, not `users`.

## Domain model

```
medication (type: continuous|course, status: active|completed)
  └─ dosage_form  (physical form + quantityOnHand → stock/refill logic)
       └─ schedule (type, intervalValue/Unit, specificTimes, daysOfWeek, timezone, isActive)
            └─ dose_event (scheduledFor, status: pending|taken|missed, snoozeCount)
```

`medications.status` (lifecycle) and `schedules.isActive` (the user's reminder toggle) are different switches; **both** must be on for doses to generate or fire.

### Dose events are materialized rows, not computed on read

`DoseEventGeneratorService` (`src/schedule/dose-event-generator.service.ts`) owns *every* write path — create, edit, and the nightly top-up — so `ScheduleService` and `MedicationService` share it without importing each other (their modules would cycle). Rules baked into it:

- Generation is idempotent by exact timestamp, and skips `asNeeded`, inactive schedules, and `status: 'completed'` medications, so no edit path can resurrect doses.
- `clearFuturePending` preserves taken/missed history **and** snoozed doses (`snoozeCount > 0`), which represent an already-notified dose the user still owes. `includeSnoozed` is only for stopping/finishing a medication.
- Stopping a medication also clears *earlier* pending doses (`clearPending` with no cutoff) — the hourly missed cron doesn't filter on medication status, so leftovers would flip to "missed" and pollute the day's ring and adherence stats.

Pure timing math is `src/schedule/schedule.util.ts`: 90-day rolling horizon, 48h cap for minute-grained intervals, 1000 events per run, IANA-timezone→UTC via `toLocaleString` offsets with no tz library (Node ships full ICU). Day-walking is anchored at local noon so DST can't skip or repeat a date. `assertValidScheduleTypeFields` is shared by `ScheduleService.create` and the AI tool path so both reject malformed schedules identically instead of silently generating zero events.

### Cron jobs

All `@nestjs/schedule` decorators, so they run **in-process on every instance** — running multiple replicas double-fires them. Each carries a `@SentryCron` check-in whose slug is listed below; the monitors are created in Sentry on first check-in, and their `timezone: 'UTC'` must match the deploy box's clock or Sentry will alert on jobs that ran perfectly well.

| When | Where | Monitor slug | What |
|---|---|---|---|
| every minute | `notifications.service.ts` | `send-dose-reminders` | send due reminders (skips doses >2h stale) |
| every 10 min | `notifications.service.ts` | `poll-push-receipts` | poll Expo push receipts, clear disowned tokens |
| hourly | `schedule.service.ts` | `mark-missed-doses` | mark doses missed after a 2h grace window |
| daily 00:00 | `schedule.service.ts` | `dose-horizon-topup` | top up the dose-event horizon |
| daily 01:00 | `medication.service.ts` | `course-completion` | auto-complete finished courses (after generation) |
| daily 09:00 | `notifications.service.ts` | `send-refill-reminders` | refill reminders, 5 days ahead of projected run-out |

Cron bodies catch DB connectivity codes (`ETIMEDOUT` / `ENOTFOUND` / `XX000`) and log a warning rather than throwing — a pooler blip shouldn't surface as an unhandled cron exception every minute.

### Push notifications

An Expo push *ticket* only says Expo accepted the message; delivery failures show up minutes later in the *receipt*, which is why `handlePushReceipts` exists (a bad FCM credential otherwise drops every Android notification while the send logs read clean). Receipts are kept in memory on purpose. A `DeviceNotRegistered` receipt nulls that `device_sessions.expoPushToken`. Android messages must set `channelId` + `priority: 'high'` or reminders arrive late and silently.

### Stock / refill

`dosage-form/stock.util.ts` projects run-out by walking **pending dose events**, not the schedule definition, so intervals, day gaps and end dates are already accounted for. Its "stock landing on exactly 0 counts as covered" boundary is deliberate and asserted in tests — don't "fix" it to `<= 0`. Refill pushes are predictive (5-day lead time), fall back to `refillThreshold` only when nothing is projectable (as-needed), and are throttled by `refillReminderSentAt`, which `DosageFormService.update` clears on restock.

### AI (`src/ai/`)

Groq (`llama-3.3-70b-versatile`) with tool-calling. The safety-critical system prompt in `ai.service.ts` draws the line between *recording a medication the user already takes* (always allowed) and *recommending or diagnosing* (never) — edit it with care, it is the entire safety boundary.

- Two-step tool flow: `propose_medication` renders a review card client-side and creates nothing; `create_medication` may only fire on a **later** turn after explicit confirmation, and executes against the stored `priorPendingAction.args`, never the model's re-emitted arguments. That's why its schema is a single `confirmed` boolean.
- Tool schemas cost ~1k input tokens, so they're attached only when `needsMedicationTools` matches (deliberately generous — a false negative loses a medication the user asked for).
- llama-3.3 emits explicit `null` for unused optional fields, so every non-required tool property accepts `['string','null']` and nulls are stripped in `stripNulls`; a bare `type: 'string'` fails Groq validation with `tool_use_failed`.
- Tips are cached per user for 24h (`ai_tips_cache`); serving from cache must not spend quota.

### Billing / entitlements

`EntitlementService` is the API-side source of truth (`QUOTAS` — free `1 tips / 5 chat`, pro `20 / 200`); the client's RevenueCat SDK only decides what the UI shows. `assertQuota` runs **before** the model call and `recordUsage` after, so a failed generation doesn't burn allowance; quota rejection is a 402 with `code: AI_QUOTA_EXCEEDED`, which the app matches on to open the paywall. `recordUsage` swallows its own errors — metering must never break the feature it meters. `POST /billing/webhook` is authenticated by a timing-safe compare of the whole `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` (not `JwtAuthGuard` — the caller is RevenueCat) and returns 200 for anything understood-but-not-actionable so RevenueCat stops retrying.

## Conventions worth matching

- Comments in this codebase explain *why* a non-obvious rule exists (DST anchoring, the stock boundary, receipt polling, snooze preservation). Keep that style; those comments are load-bearing documentation.
- User-facing "day" boundaries are computed in the user's IANA timezone (`dayBoundsInTz`, `endOfDayInTz`) and fall back to server-local rather than 500ing on a bad zone.
- Dose-event reads filter with `notStoppedBefore`, which hides events scheduled after a medication's `completedAt` — stopped medications shouldn't linger on the home screen.
- Tests are colocated `*.spec.ts` and cover the pure utilities and billing parsing (`schedule.util`, `stock.util`, `entitlement.service`, `revenuecat.types`, auth). New timing/stock rules belong in those pure modules so they stay testable without a database.
