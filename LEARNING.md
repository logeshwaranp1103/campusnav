# LEARNING.md — Engineering Playbook & Issue/Solution Log

## What this file is

This is a portable engineering knowledge base distilled from building a
multi-tenant SaaS on **Next.js (App Router, Turbopack) + Prisma + Neon
Postgres + Vercel + Razorpay**, from first commit to a live, hardened,
domain-connected production deployment.

It is written to be handed to an AI agent (or a new engineer) at the start
of a new project:

> "Read `LEARNING.md` and apply these patterns and avoid these traps."

Every entry follows the same shape:

**Symptom → Root cause → Solution → Why this method → Reusable rule.**

It is deliberately opinionated. Each "Reusable rule" is the one-line
takeaway worth carrying into the next project. The goal is not to document
what any single project is, but to encode **how to think** about the same
class of problems so they're solved once, not twice.

**How to use it:** skim the [Reusable Rules Cheat-Sheet](#reusable-rules-cheat-sheet)
at the end first. When you hit a specific problem (deployment, DB latency,
auth, money, rate limiting), jump to the matching section for the full
story and the "why".

---

## Table of contents

1. [Project bootstrap](#1-project-bootstrap)
2. [Next.js App Router discipline](#2-nextjs-app-router-discipline)
3. [Prisma + Neon Postgres](#3-prisma--neon-postgres)
4. [Multi-tenancy](#4-multi-tenancy)
5. [Authentication & authorization](#5-authentication--authorization)
6. [Server Actions, APIs & validation](#6-server-actions-apis--validation)
7. [Real-time & background work](#7-real-time--background-work)
8. [Money, payments & Razorpay](#8-money-payments--razorpay)
9. [File uploads & storage](#9-file-uploads--storage)
10. [Caching, revalidation & performance](#10-caching-revalidation--performance)
11. [Rate limiting & abuse control](#11-rate-limiting--abuse-control)
12. [Observability & error handling](#12-observability--error-handling)
13. [Vercel deployment & environments](#13-vercel-deployment--environments)
14. [Custom domains, DNS & TLS](#14-custom-domains-dns--tls)
15. [Security hardening](#15-security-hardening)
16. [Testing strategy](#16-testing-strategy)
17. [Migrations & schema evolution](#17-migrations--schema-evolution)
18. [Reusable Rules Cheat-Sheet](#reusable-rules-cheat-sheet)

---

## 1. Project bootstrap

### 1.1 Version drift across `node`, `pnpm`, and Vercel

- **Symptom:** `pnpm install` works locally, fails on Vercel with lockfile
  mismatch or peer errors.
- **Root cause:** Local Node is newer/older than Vercel's build image, and
  `packageManager` isn't pinned.
- **Solution:** Pin exact versions in `package.json`
  (`"packageManager": "pnpm@9.15.0"`, `"engines": { "node": ">=20 <21" }`)
  and add `.nvmrc`. Set Vercel's Node version to match.
- **Why:** Reproducible installs are worth more than "latest features."
  Drift is silent until it isn't.
- **Reusable rule:** Pin `packageManager`, `engines.node`, and `.nvmrc`
  before your first deploy.

### 1.2 Committed `.env` files

- **Symptom:** A collaborator ships a demo and every secret rotates the
  next day.
- **Root cause:** `.env` was tracked before `.gitignore` was written.
- **Solution:** `git rm --cached .env`, add `.env*` to `.gitignore` except
  `.env.example`, rotate every secret. Add a pre-commit hook that greps
  for common secret patterns.
- **Reusable rule:** `.env.example` is the only env file that ever gets
  committed. Rotate on exposure — always.

### 1.3 Missing `.env.example`

- **Symptom:** New teammate spends a day guessing which envs the app
  needs.
- **Solution:** Every env you read anywhere in the codebase must appear in
  `.env.example` with an example or a `# describe here` note.
- **Reusable rule:** Missing env is not the app's fault; missing
  documentation of the env is.

---

## 2. Next.js App Router discipline

### 2.1 "Route requires Suspense" build errors from `useSearchParams`

- **Symptom:** `useSearchParams() should be wrapped in a suspense boundary`
  breaks the production build.
- **Root cause:** `useSearchParams` opts the route into dynamic rendering
  and the page tree has no `<Suspense>` boundary.
- **Solution:** Wrap the client component that reads params in
  `<Suspense fallback={…}>` **inside the server page**, not around the
  whole page.
- **Why:** Suspense localises the dynamic part so the rest of the page can
  still be prerendered.
- **Reusable rule:** Any hook that reads request-time state
  (`useSearchParams`, `cookies()`, `headers()`) needs an explicit boundary.
  Wrap the smallest component that needs it.

### 2.2 Hydration mismatch on random or time-based content

- **Symptom:** Red console: "Text content did not match".
- **Root cause:** Server rendered a `Math.random()` id, a
  `new Date().toLocaleTimeString()`, or a locale-formatted number.
- **Solution:** Move nondeterministic data into a `useEffect`; render
  a stable placeholder on the first paint.
- **Reusable rule:** SSR is deterministic. If a value can differ between
  server and client, defer it.

### 2.3 Accidental client component sprawl

- **Symptom:** Bundle size balloons; a "server-only" util ends up in the
  client bundle.
- **Root cause:** A `"use client"` file imports a server util that imports
  Prisma → Prisma leaks into the browser bundle.
- **Solution:** Put `import "server-only"` at the top of anything that must
  never reach the browser. Split files by boundary
  (`user.server.ts` vs `user.client.ts`).
- **Reusable rule:** The client/server boundary lives in imports, not in
  filenames. Enforce it with `server-only` / `client-only`.

### 2.4 Layouts refetching on every navigation

- **Symptom:** Sidebar user info re-fetches on every link click.
- **Root cause:** Data fetched inside a layout without caching primitives.
- **Solution:** Fetch inside a `React.cache()`d server function or lift the
  data into a route-segment cache. Use `revalidateTag` on mutation.
- **Reusable rule:** Layout data should be cached by tag; mutations
  invalidate tags, not URLs.

### 2.5 Turbopack + Prisma edge case

- **Symptom:** Prisma client initialisation fails on cold reload with
  Turbopack in dev.
- **Root cause:** Multiple Prisma instances get created on HMR.
- **Solution:** The standard `globalThis.prisma` singleton pattern
  (only cache when `NODE_ENV !== 'production'`).
- **Reusable rule:** In dev, **one** Prisma client per process. Cache it
  on `globalThis`.

---

## 3. Prisma + Neon Postgres

### 3.1 Cold-start pool exhaustion on serverless

- **Symptom:** First requests after idle return 500s about `too many
  connections`.
- **Root cause:** Each serverless invocation opens a fresh direct
  connection to Neon; there's no pooler in the path.
- **Solution:** Use Neon's **pooled** connection string (`-pooler`
  suffix) for `DATABASE_URL`, and reserve the direct URL for
  `DIRECT_URL` (used only by Prisma migrations).
- **Why:** Serverless fan-out multiplies connection count by request
  concurrency. The pooler multiplexes them.
- **Reusable rule:** Serverless + Postgres = always through a pooler.
  Direct connections are only for migrations and one-off scripts.

### 3.2 Long queries and Neon's compute suspend

- **Symptom:** First request after cold-start takes 4–8s.
- **Root cause:** Neon's compute was auto-suspended and needed to boot.
- **Solution:** For latency-sensitive apps, disable auto-suspend or set a
  longer idle window. For all others, ship a health-check ping so users
  don't feel the wake-up.
- **Reusable rule:** Auto-suspend saves money on staging; it costs
  perceived latency in production. Choose deliberately.

### 3.3 `prisma migrate deploy` failing in CI

- **Symptom:** `P1001: Can't reach database` on Vercel build.
- **Root cause:** Migrations were being run at build time against the
  pooled URL, or against a URL that CI can't reach.
- **Solution:** Run `prisma migrate deploy` in a dedicated step against
  `DIRECT_URL`, not at Next build. On Vercel, wire it into a separate
  post-deploy hook or GitHub Action.
- **Reusable rule:** Migrations belong in a deploy step, not a build step.
  Use `DIRECT_URL` for them.

### 3.4 Schema-drift disasters

- **Symptom:** A hotfix `prisma db push` in prod diverges the schema from
  migration history. Next migration fails.
- **Solution:** Never `db push` in production. Only
  `prisma migrate deploy`. If drift happens, `prisma migrate resolve` with
  care.
- **Reusable rule:** `db push` is a local-dev tool. Prod only accepts
  applied migrations.

### 3.5 N+1 from lazy relations

- **Symptom:** Listing 50 invoices makes 51 queries.
- **Solution:** Use `include` or `select` with the exact shape needed;
  measure with Prisma's query logger; add composite indexes for the joined
  fields.
- **Reusable rule:** Every list endpoint gets an explicit `select` and a
  query-log review before merging.

### 3.6 Missing indexes on foreign keys and tenant IDs

- **Symptom:** P95 query latency creeps up as tenants grow.
- **Solution:** Add `@@index([tenantId])` (and composite indexes for the
  usual filters) on every tenant-scoped model at schema creation, not
  after pain.
- **Reusable rule:** Index the tenant key on day one. It's not premature
  optimisation, it's table stakes.

---

## 4. Multi-tenancy

### 4.1 Choosing the isolation model

- **Symptom:** Confusion between schema-per-tenant vs row-level tenancy
  when the product is 3 weeks old.
- **Solution:** Default to **shared schema + `tenantId` column + RLS
  where possible**. Move to schema-per-tenant only when you have a
  compliance or noisy-neighbour reason.
- **Why:** Shared schema has one migration to run, one connection pool,
  one backup. Schema-per-tenant multiplies ops surface.
- **Reusable rule:** Start with shared-schema multi-tenancy. Isolation is
  a cost; earn the move upward with evidence.

### 4.2 Missing `tenantId` in a WHERE clause = cross-tenant leak

- **Symptom:** User of Tenant A sees a row that belongs to Tenant B.
- **Root cause:** A repository function forgot to filter by tenant.
- **Solution:**
  1. Wrap Prisma in a per-request client extension that injects `tenantId`
     into every `findMany/findFirst/update/delete` where the model has a
     `tenantId` field.
  2. Turn on Postgres **Row-Level Security** as a defence-in-depth layer.
  3. Add a lint rule that flags raw `prisma.*` usage inside route handlers
     — force everything through the tenant-aware repo layer.
- **Reusable rule:** Tenant filtering is not the caller's responsibility.
  Enforce it at the data-access layer and again in the database.

### 4.3 Tenant resolution ambiguity

- **Symptom:** Subdomain `acme.app.com` and the session cookie disagree on
  which tenant the user is on.
- **Solution:** Pick **one** authoritative source (usually the session)
  and validate the subdomain against it. Redirect on mismatch. Never trust
  path/query params for tenancy.
- **Reusable rule:** Tenancy lives in the session. Subdomains are a UX
  affordance, not an authority.

---

## 5. Authentication & authorization

### 5.1 Roles baked into UI conditionals

- **Symptom:** Adding a new role requires touching 40 components.
- **Solution:** Model **permissions** (`invoice.create`,
  `settings.billing.read`) and assign them to roles. UI checks
  `hasPermission("invoice.create")`, never `role === "admin"`.
- **Reusable rule:** Never check role names in code. Check permissions.

### 5.2 Session forgery via unsigned cookies

- **Symptom:** Pen test flags that a modified cookie yields a different
  user context.
- **Solution:** Use a battle-tested auth library (Better Auth / Auth.js /
  Clerk). Rotate signing secrets on incident. HttpOnly, Secure, SameSite=Lax.
- **Reusable rule:** Don't roll your own session cookie. Ever.

### 5.3 Password reset token reuse

- **Symptom:** Same reset link works twice.
- **Solution:** Single-use tokens with `usedAt` timestamp, short TTL
  (15 min), invalidated on password change.
- **Reusable rule:** Every one-time token is one-time in the database, not
  just by convention.

### 5.4 CSRF on Server Actions

- **Symptom:** A Server Action mutates state when called from another
  origin.
- **Solution:** Next.js has origin-check protections; enable them and
  configure `serverActions.allowedOrigins`. For cross-origin API routes,
  add explicit CSRF tokens or require `SameSite=strict` on state cookies.
- **Reusable rule:** Any mutating endpoint verifies origin. Server Actions
  are mutating endpoints.

---

## 6. Server Actions, APIs & validation

### 6.1 Trusting client-side Zod validation

- **Symptom:** Malformed data hits the DB despite a "validated" form.
- **Root cause:** Validation was only run client-side.
- **Solution:** Validate on the server with the same Zod schema. Client
  validation is UX; server validation is truth.
- **Reusable rule:** Every Server Action and API route starts with
  `Schema.parse(input)`.

### 6.2 Returning raw Prisma errors to the client

- **Symptom:** A UI toast shows `Foreign key constraint failed on the
  field: (\`tenantId_fkey\`)`.
- **Solution:** Wrap known errors (`P2002` unique, `P2025` not found) into
  domain errors with friendly messages. Log the raw error server-side with
  a request ID. Return the request ID to the user for support.
- **Reusable rule:** The DB error dictionary belongs on the server. Users
  see a message + a request ID.

### 6.3 Optimistic UI without invalidation

- **Symptom:** UI shows the row is deleted; refresh brings it back.
- **Solution:** Every mutation calls `revalidateTag` (server) and
  invalidates the relevant query client-side. Test with hard-refresh.
- **Reusable rule:** Optimistic UI without cache invalidation is a bug
  waiting to be reported.

---

## 7. Real-time & background work

### 7.1 Choosing between polling, SSE, and WebSockets

- **Rules of thumb:**
  - **Polling** (5–30s) for status pages, dashboards that tolerate
    latency.
  - **SSE** for one-way streams (activity feeds, live position updates,
    log tailing).
  - **WebSockets** only when true bidirectional streaming is needed
    (chat, collab cursors, gameplay).
- **Reusable rule:** Prefer the simplest transport that meets the
  latency budget. SSE is underrated on Vercel/edge.

### 7.2 SSE disconnects on Vercel

- **Symptom:** Stream closes after ~30s.
- **Root cause:** Serverless function timeout, or a proxy that closes idle
  connections.
- **Solution:** Send a comment ping (`:\n\n`) every 15s. For long
  streams, migrate to Edge runtime with `runtime = "edge"` (longer
  timeouts) or use a hosted realtime service (Pusher, Ably, Convex).
- **Reusable rule:** SSE needs heartbeats. Serverless runtimes have hard
  ceilings; know them.

### 7.3 Background jobs on serverless

- **Symptom:** Emails and PDFs block the request that triggered them.
- **Solution:** Push work to a queue (Upstash Q, QStash, Inngest,
  Trigger.dev). The HTTP handler returns immediately with an ID; the
  worker does the work.
- **Reusable rule:** Serverless handlers do the smallest possible work.
  Anything > 1s belongs to a queue.

### 7.4 Idempotency for retried jobs

- **Symptom:** A retried webhook charges the customer twice.
- **Solution:** Every job accepts an idempotency key; store it in a
  `processed_events` table with a unique constraint. Retries hit the
  unique conflict and no-op.
- **Reusable rule:** Any handler that can be retried needs an idempotency
  key. Store it, check it.

---

## 8. Money, payments & Razorpay

### 8.1 Floats in money math

- **Symptom:** `0.1 + 0.2 !== 0.3`; totals off by paise.
- **Solution:** Store money as integers (minor units — paise), or use
  `Decimal` in Prisma with fixed scale (2 or 4). Convert only for
  display.
- **Reusable rule:** Money is never a float. Integers or `Decimal`.

### 8.2 Trusting client-computed order amounts

- **Symptom:** Attacker sends `amount = 1` and pays ₹1 for a ₹10,000
  invoice.
- **Solution:** The server recomputes the amount from the trusted line
  items and creates the Razorpay order. The client only tells you *which*
  invoice, never *how much*.
- **Reusable rule:** Money is computed server-side, always. The client
  proposes intent; the server prices it.

### 8.3 Webhook verification skipped in dev

- **Symptom:** Prod payments silently succeed for fake webhook calls.
- **Solution:** Verify the Razorpay signature (HMAC of body + secret) in
  **every** environment. Add a webhook fuzz test that fails on missing or
  wrong signature.
- **Reusable rule:** Webhook verification is not optional in any
  environment. Reject on signature mismatch, log the attempt.

### 8.4 Webhook + client both marking payment success

- **Symptom:** Duplicate `PAID` writes; race with the webhook.
- **Solution:** The webhook is the single source of truth for payment
  status. The client redirect just navigates the user; it does not write
  status.
- **Reusable rule:** For any external state (payment, KYC, delivery),
  pick **one** authoritative signal (the webhook). Everything else is
  UX-only.

### 8.5 Missing audit trail on money

- **Symptom:** A dispute happens; you can't reconstruct what happened.
- **Solution:** Append-only `payment_events` table storing raw provider
  payloads, timestamps, actor, and derived status transitions.
- **Reusable rule:** Money events are append-only. Never update in place;
  insert a new row.

---

## 9. File uploads & storage

### 9.1 Uploading through your API server

- **Symptom:** Function timeouts on 20MB PDFs.
- **Solution:** Presigned URLs — client uploads directly to S3/R2/Blob.
  The server issues the URL, validates the MIME/size on completion via a
  callback or a follow-up metadata write.
- **Reusable rule:** Bytes do not flow through your API server. Presign
  and let the storage provider do the heavy lifting.

### 9.2 SVG upload = stored XSS

- **Symptom:** A malicious SVG runs JavaScript when previewed.
- **Solution:** Sanitize SVGs (DOMPurify with SVG profile) before storing
  or serving. Serve user-uploaded content from a separate domain with a
  restrictive CSP.
- **Reusable rule:** SVGs are code, not images. Sanitize on ingest, serve
  from an isolated origin.

### 9.3 Public-by-default buckets

- **Symptom:** Someone discovers your object list via URL enumeration.
- **Solution:** Buckets are private by default. Serve reads through
  short-lived signed URLs.
- **Reusable rule:** Default deny. If a bucket is public, that's an
  explicit choice with a written justification.

---

## 10. Caching, revalidation & performance

### 10.1 Over-caching mutable data

- **Symptom:** A user updates their profile; the header still shows the
  old name for 10 minutes.
- **Solution:** Tag-based revalidation. Fetches attach `tags: ["user:123"]`;
  mutations call `revalidateTag("user:123")`.
- **Reusable rule:** Cache by tag, invalidate by tag. Time-based TTL is
  the fallback, not the default.

### 10.2 Under-caching static-ish data

- **Symptom:** Landing page hits the DB on every request.
- **Solution:** Static generation (`generateStaticParams`) or ISR with a
  long revalidate window. Move truly-static content into MDX.
- **Reusable rule:** If the data changes once a day, cache it for close to
  a day.

### 10.3 Client-side lists without pagination

- **Symptom:** "List all invoices" fetches 40k rows.
- **Solution:** Cursor pagination (`cursor` + `take`). Never `OFFSET` at
  scale.
- **Reusable rule:** Every list endpoint is paginated from the first
  commit.

### 10.4 Bundling heavy libs into the initial payload

- **Symptom:** LCP > 4s because Recharts and date-fns are in the entry
  bundle.
- **Solution:** `dynamic(() => import(...), { ssr: false })` for
  visualisations. Prefer lighter alternatives (native `Intl`, minimal
  chart libs) where possible.
- **Reusable rule:** Interactive-but-not-critical UI is lazy-loaded.

---

## 11. Rate limiting & abuse control

### 11.1 No limits on auth endpoints

- **Symptom:** Login endpoint takes 200 req/s from a botnet.
- **Solution:** Upstash Ratelimit (or equivalent) with sliding-window
  limits keyed by IP + email hash. Return `429` with `Retry-After`.
- **Reusable rule:** Every auth endpoint has a per-identity rate limit
  from day one.

### 11.2 No cost caps on paid APIs

- **Symptom:** A bug loops a call to a paid API; bill spikes.
- **Solution:** Per-day and per-tenant spend caps in a middleware.
  Alarms at 50/80/100%.
- **Reusable rule:** Every external API with cost gets a hard daily cap
  in code, not just a billing alert.

### 11.3 Enumeration via error messages

- **Symptom:** "Email not found" vs "Wrong password" leaks account
  existence.
- **Solution:** Return the same generic message for both. Log the
  distinction server-side.
- **Reusable rule:** Auth error messages are identical to the client.

---

## 12. Observability & error handling

### 12.1 Console.log as your logger

- **Symptom:** Debugging prod means scrolling through Vercel logs.
- **Solution:** Structured logging (pino or console with a JSON
  formatter) + a sink (Axiom, Datadog, Betterstack). Every log line
  carries `requestId`, `userId`, `tenantId`.
- **Reusable rule:** Logs are JSON, correlated by request ID, shipped
  somewhere queryable.

### 12.2 No error tracker

- **Symptom:** Users complain about errors you never saw.
- **Solution:** Sentry (or equivalent) wired into client + server. Source
  maps uploaded on build.
- **Reusable rule:** Errors need a home. Sentry from the first deploy.

### 12.3 Missing user-facing request IDs

- **Symptom:** A user reports "it broke" and you can't find their session
  in logs.
- **Solution:** Every error response includes a request ID. Users are
  encouraged to include it in support tickets.
- **Reusable rule:** Every response has a `x-request-id`. Errors show it.

### 12.4 No uptime monitor

- **Symptom:** You learn about downtime from a customer email.
- **Solution:** Betterstack/UptimeRobot pinging `/api/health` every
  60s from three regions. Alerts to phone.
- **Reusable rule:** If a customer tells you first, monitoring failed.

---

## 13. Vercel deployment & environments

### 13.1 Preview deploys against prod DB

- **Symptom:** A PR preview writes garbage into the production database.
- **Solution:** Neon branches (or dedicated preview DBs) tied to Vercel
  preview environments. Preview envs get their own env-scope in Vercel.
- **Reusable rule:** Preview deployments never touch production data
  stores.

### 13.2 Env variable leakage into client bundles

- **Symptom:** A private key ends up in `_next/static/*.js`.
- **Root cause:** Named it `NEXT_PUBLIC_STRIPE_SECRET`.
- **Solution:** Only prefix truly-public keys with `NEXT_PUBLIC_`.
  Reserve unprefixed names for secrets. Add a build-time lint that fails
  if `NEXT_PUBLIC_*_SECRET` exists.
- **Reusable rule:** `NEXT_PUBLIC_` = anyone can see it. Name accordingly.

### 13.3 Long build times

- **Symptom:** 8-minute Vercel builds.
- **Solution:** Turbopack for dev; keep prod on the recommended stable
  builder. Cache `.next/cache`. Split unrelated apps into separate
  projects instead of a giant monorepo build.
- **Reusable rule:** Build time is a product feature. Below 3 minutes for
  a mid-size app.

### 13.4 Cold starts on rare routes

- **Symptom:** Rarely-used endpoints take 2s on first hit.
- **Solution:** Move latency-critical rare endpoints to Edge runtime;
  keep heavy Node deps in serverless routes only.
- **Reusable rule:** Match runtime (Edge vs Node) to the endpoint's
  dependency shape.

---

## 14. Custom domains, DNS & TLS

### 14.1 CNAME on apex domain

- **Symptom:** Root domain won't resolve; registrar rejects the CNAME.
- **Solution:** Use `A`/`ALIAS`/`ANAME` at apex per your registrar's
  support. Use `CNAME` only on subdomains. Vercel gives you the exact
  records.
- **Reusable rule:** Apex ≠ subdomain. Read the registrar's DNS docs
  before promising a launch date.

### 14.2 TLS "invalid certificate" during propagation

- **Symptom:** Users see cert errors for a few hours after DNS change.
- **Solution:** Add the domain in Vercel *before* switching DNS so the
  cert is issued in advance. Lower TTL to 300s a day before the switch.
- **Reusable rule:** Provision the cert before the DNS cutover. Lower TTL
  in advance.

### 14.3 `www` vs apex redirect loop

- **Symptom:** `www.example.com` and `example.com` bounce forever.
- **Solution:** Pick one canonical host; configure the other to 301 to
  the canonical. Do it in one place (Vercel's domain settings, or
  middleware — not both).
- **Reusable rule:** One canonical host, one redirect, one place. Never
  duplicate redirects across layers.

---

## 15. Security hardening

### 15.1 Missing security headers

- **Solution:** Ship a baseline via `next.config.js` headers or
  middleware: `Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (deny everything you don't use).
- **Reusable rule:** Security headers ship with the first deploy.
  Ratchet them stricter over time.

### 15.2 Open CORS

- **Symptom:** `Access-Control-Allow-Origin: *` on an authenticated API.
- **Solution:** Allow-list explicit origins; never `*` on any endpoint
  that carries cookies or tokens.
- **Reusable rule:** CORS wildcards are for public read-only APIs only.

### 15.3 Dependency auto-update apathy

- **Solution:** Renovate/Dependabot with grouped weekly PRs. Ship a
  green CI on every one; merge Fridays.
- **Reusable rule:** A dependency you haven't updated in six months is a
  liability. Automate the churn.

### 15.4 Admin routes without a second factor

- **Solution:** Enforce TOTP or WebAuthn on any account with
  admin-scoped permissions.
- **Reusable rule:** Privilege earns a factor. Admin without MFA is
  negligence.

---

## 16. Testing strategy

### 16.1 No smoke test for the money path

- **Solution:** One end-to-end Playwright test that: creates an account,
  creates an order, hits the payment sandbox, verifies the webhook wrote
  the row. Runs on every deploy.
- **Reusable rule:** If money can move, there is a green E2E test that
  proves it still can.

### 16.2 Test DB isolation

- **Symptom:** Tests pass alone, fail in parallel.
- **Solution:** A DB-per-worker (Neon branch per shard) or wrap every
  test in a transaction rolled back at the end.
- **Reusable rule:** Tests must be independent. Shared DB state is a
  flaky test factory.

### 16.3 Snapshot bloat

- **Solution:** Snapshot only stable, small units. For UI, prefer
  role-based Playwright assertions over pixel snapshots.
- **Reusable rule:** Snapshots are for shapes, not for whole DOM trees.

---

## 17. Migrations & schema evolution

### 17.1 Renaming a column with a running app

- **Symptom:** Deploy of the migration + app fails because old and new
  code disagree on the column name.
- **Solution:** **Expand → migrate → contract.**
  1. Add the new column, dual-write in app code.
  2. Backfill.
  3. Switch reads to the new column.
  4. Remove the old column in a later deploy.
- **Reusable rule:** Never rename in one deploy. Expand, migrate, contract.

### 17.2 Long migrations lock the table

- **Symptom:** `ALTER TABLE ADD COLUMN NOT NULL DEFAULT …` on a 50M-row
  table takes production down.
- **Solution:** Add nullable, backfill in batches, then add the NOT NULL
  constraint. Use `CONCURRENTLY` for indexes.
- **Reusable rule:** On big tables, migrations happen in stages, never
  all-at-once.

### 17.3 No migration on rollback plan

- **Solution:** Every migration has a documented rollback (either a real
  `down` or a written procedure). Test rollback in staging.
- **Reusable rule:** A migration you can't roll back is a bet, not a
  change.

---

## Reusable Rules Cheat-Sheet

1. Pin `packageManager`, `engines.node`, `.nvmrc` before first deploy.
2. Only `.env.example` is committed. Rotate on exposure.
3. Every env you read is documented in `.env.example`.
4. Wrap the smallest client component that reads dynamic state in
   `<Suspense>`.
5. SSR is deterministic — defer random/time values to `useEffect`.
6. The client/server boundary lives in imports. Enforce with
   `server-only` / `client-only`.
7. One Prisma client per process. Cache on `globalThis` in dev.
8. Serverless + Postgres → always through a pooler; direct URL only for
   migrations.
9. Migrations run in a deploy step, not a build step.
10. `db push` never in prod. Migrations only.
11. Every list endpoint gets an explicit `select` and a query-log review.
12. Index the tenant key on day one.
13. Start with shared-schema multi-tenancy. Move up only with evidence.
14. Tenant filtering enforced in the data layer AND the database.
15. Tenancy lives in the session. Subdomains are UX.
16. Never check role names in code — check permissions.
17. Don't roll your own session cookie.
18. Every one-time token is single-use in the database.
19. Any mutating endpoint verifies origin.
20. Every Server Action starts with `Schema.parse(input)`.
21. DB error dictionary is server-side. Users see message + request ID.
22. Optimistic UI without cache invalidation is a bug.
23. Prefer the simplest transport — SSE beats WebSockets often.
24. SSE needs heartbeats; know your runtime timeout.
25. Serverless handlers do the smallest work. Long work → queue.
26. Retryable handlers need idempotency keys.
27. Money is integers or `Decimal`. Never float.
28. Money amounts are computed server-side.
29. Webhook signatures are verified in every environment.
30. Webhooks are the single source of truth for external state.
31. Money events are append-only.
32. Bytes don't flow through your API server — presign.
33. SVGs are code; sanitize on ingest, serve from isolated origin.
34. Buckets are private by default.
35. Cache by tag, invalidate by tag.
36. Every list is paginated from the first commit.
37. Interactive-but-not-critical UI is lazy-loaded.
38. Every auth endpoint has a per-identity rate limit.
39. Every paid external API has a hard daily cap in code.
40. Auth error messages are identical to the client.
41. Logs are JSON, correlated by request ID, shipped somewhere queryable.
42. Sentry (or equivalent) from the first deploy.
43. Every response has a `x-request-id`. Errors surface it.
44. If a customer tells you about downtime first, monitoring failed.
45. Preview deployments never touch production data stores.
46. `NEXT_PUBLIC_` = anyone can see it. Name accordingly.
47. Match runtime (Edge vs Node) to the endpoint's dependency shape.
48. Apex ≠ subdomain in DNS.
49. Provision TLS before DNS cutover; lower TTL in advance.
50. One canonical host, one redirect, one place.
51. Security headers ship with the first deploy.
52. CORS wildcards only on public read-only endpoints.
53. Automate dependency updates weekly.
54. Admin permissions require a second factor.
55. If money can move, an E2E test proves it still can.
56. Tests must be independent — no shared DB state.
57. Never rename in one deploy. **Expand → migrate → contract.**
58. Big-table migrations happen in stages.
59. A migration you can't roll back is a bet.

---

_End of `LEARNING.md`. Keep this file living: every incident you resolve
should end with a new entry here._
