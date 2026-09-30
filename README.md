# Dhaka Tesla Pool

> Share a seat. Split the fare. Survive Dhaka traffic.

| | |
|---|---|
| **Live app** | `TODO: paste the Vercel URL after deploying` |
| **Live API** | `TODO: paste the Render URL` (`/api/health`) |
| **6-minute video** | `TODO: paste the Loom link` |
| **Version** | `release/v1.0.0` |

![Passenger dashboard](docs/screenshots/passenger.png) ![Driver dashboard](docs/screenshots/driver.png)
<!-- TODO: add a short GIF of Nusrat + Rafiq pooling, then Shirin being refused the seat. -->

## 1. Summary

Dhaka Tesla Pool is a ride-pooling MVP for three-wheeled, battery-powered "Teslas". A passenger requests a
ride between two Dhaka zones; if a Tesla is already forming a compatible trip, the passenger is pooled into
it and everyone's fare drops. The driver sees exactly who is assigned and what stage the trip is at. Each
passenger sees only their own fare and status.

## 2. Problem statement

8:41 AM, Banani Road 11. **Jashim** drives **Bullet** (3 seats). **Nusrat** books Banani -> Mohakhali. Two
minutes later **Rafiq** books Banani -> Gulshan 1. Can they share? What does each pay? Then **Shirin** grabs
the last seat 30 seconds after, at nearly the same instant as a competing claim. The system must never
exceed Bullet's capacity, must keep per-passenger privacy, and must keep enough history to explain afterwards
exactly what happened.

## 3. Features implemented

**Passenger**: sign up / sign in; request a ride (pickup zone, destination zone, seats, payment method);
live fare estimate before booking; live status (waiting -> matched -> driver arrived -> in progress ->
completed / cancelled); ride history; cancel while cancellation is valid; TeslaPay wallet (simulated, 500 BDT
signup credit) or cash.

**Driver**: sign in; register with a Tesla (capacity 1-6); go online / offline; see waiting requests that fit
the Tesla; accept one into a pool; mark arrived, start, complete; cancel the pool before it starts
(passengers are re-queued, not cancelled); see passengers, seats and ride history.

**Pool**: several requests share one Tesla; occupied seats can never exceed capacity; each passenger has an
individual fare; pool membership is explicit (`pool_members`, with join / leave history); new requests are
auto-matched into an open compatible pool.

**Audit**: every request and pool transition is written to an append-only `ride_events` table.

## 4. Architecture

Full design notes (written before the code): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```mermaid
flowchart LR
  B[Browser<br/>Passenger / Driver] -->|HTTPS| F[Next.js 14 App Router<br/>client-rendered UI]
  F -->|REST JSON + Bearer JWT| A[Node.js 22 + Express API]
  A -->|SQL over pg pool<br/>transactions + row locks| D[(PostgreSQL 16)]
  A -.->|structured logs| L[stdout / pino]
```

Four boxes on purpose. No Redis, queue or microservice: the core invariant (seats never exceed capacity) is
a transactional problem and Postgres already solves it.

### Lifecycles

Two state machines, because a *request* belongs to one passenger while a *pool* is one Tesla trip. A single
status column cannot express "Nusrat cancelled but Rafiq is still riding".

```mermaid
stateDiagram-v2
  direction LR
  [*] --> REQUESTED
  REQUESTED --> MATCHED: joins a pool
  MATCHED --> DRIVER_ARRIVED: pool arrives
  DRIVER_ARRIVED --> STARTED: pool starts (fare locked)
  STARTED --> COMPLETED: pool completes (payment recorded)
  REQUESTED --> CANCELLED: passenger cancels
  MATCHED --> CANCELLED: passenger cancels
  MATCHED --> REQUESTED: driver cancels pool (re-queued)
  DRIVER_ARRIVED --> REQUESTED: driver cancels pool (re-queued)
```

Pool: `ACCEPTED -> DRIVER_ARRIVED -> STARTED -> COMPLETED`, plus `CANCELLED` (before start).

Changes from the PRD's suggested lifecycle, and why: separate request/pool machines (above); `MATCHED ->
REQUESTED` when a driver cancels (the passenger did nothing wrong); passengers cannot cancel once the Tesla
has arrived (it would waste the trip; no cancellation fees in the MVP); fare is locked at `STARTED` (it may
fall while the pool forms, but must not change mid-ride).

### ERD

```mermaid
erDiagram
  USERS ||--o| TESLAS : owns
  USERS ||--o{ RIDE_REQUESTS : makes
  ZONES ||--o{ RIDE_REQUESTS : pickup_or_destination
  TESLAS ||--o{ POOLS : runs
  ZONES ||--o{ POOLS : pickup
  POOLS ||--o{ POOL_MEMBERS : has
  RIDE_REQUESTS ||--o{ POOL_MEMBERS : joins
  RIDE_REQUESTS ||--o| PAYMENTS : settled_by
  USERS ||--o{ RIDE_EVENTS : acts

  USERS { uuid id PK
    text name
    text email UK
    text password_hash
    text role
    bigint wallet_balance_paisa }
  TESLAS { uuid id PK
    uuid driver_id FK_UK
    text name
    text plate UK
    int capacity
    bool is_online }
  ZONES { text id PK
    text name
    numeric lat
    numeric lng }
  RIDE_REQUESTS { uuid id PK
    uuid passenger_id FK
    text pickup_zone FK
    text destination_zone FK
    int seats
    text status
    text payment_method
    bigint fare_paisa
    jsonb fare_breakdown
    bool fare_locked }
  POOLS { uuid id PK
    uuid tesla_id FK
    text pickup_zone FK
    text status
    int capacity
    int seats_taken }
  POOL_MEMBERS { uuid id PK
    uuid pool_id FK
    uuid request_id FK
    int seats
    timestamptz joined_at
    timestamptz left_at
    text left_reason }
  PAYMENTS { uuid id PK
    uuid request_id FK_UK
    uuid passenger_id FK
    uuid driver_id FK
    text method
    bigint amount_paisa }
  RIDE_EVENTS { bigint id PK
    text entity_type
    uuid entity_id
    text from_status
    text to_status
    uuid actor_user_id FK
    jsonb metadata }
```

Every table is explained next to its DDL in [`backend/src/db/migrations/001_init.sql`](backend/src/db/migrations/001_init.sql).
Invariants live in the database, not only in application code: `CHECK (seats_taken <= capacity)`, a partial
unique index for one active request per passenger, one for one active pool per Tesla, one for one active
membership per request, `UNIQUE(payments.request_id)`, and `CHECK` constraints on every status column.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, plain CSS |
| Backend | Node.js 22, Express 4, `pg`, `zod`, `jsonwebtoken`, `bcryptjs`, `pino`, `helmet`, `express-rate-limit` |
| Database | PostgreSQL 16 |
| Tests | `node:test` against a real Postgres |
| Infra | Docker Compose; Neon + Render + Vercel free tiers for hosting |

## 6. Project structure

```
.
├── docker-compose.yml        db + api + web, with health checks
├── .env.example              every variable, no secrets
├── docs/ARCHITECTURE.md      design written before the code
├── backend/
│   ├── Dockerfile, docker-entrypoint.sh     migrate -> seed (optional) -> start
│   ├── src/
│   │   ├── app.js, server.js, config.js
│   │   ├── routes/           thin HTTP layer (auth, rides, driver, meta, health)
│   │   ├── services/         business logic: rides, pools, lifecycle, events, auth
│   │   ├── domain/           pure rules: fare, zones, state machines, matching
│   │   ├── middleware/       auth, validation, errors
│   │   └── db/               migrate.js, seed.js, migrations/001_init.sql
│   └── test/                 50 tests
└── web/
    ├── app/                  landing, login, register, /passenger, /driver
    ├── components/           SeatStrip, StatusBadge, PoolPanel, ...
    └── lib/                  api client, auth context, polling hook, money formatting
```

Business rules sit in `domain/` (pure, unit-testable) and `services/` (transactions). Routes only parse,
validate and delegate.

## 7. Prerequisites

- Docker + Docker Compose (for the one-command run), **or**
- Node.js >= 20 and a PostgreSQL 14+ instance (for the manual run).

## 8. Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credentials for the compose `db` container |
| `DATABASE_URL` | API connection string (host is `db` inside compose, `localhost` outside) |
| `DATABASE_SSL` | `true` for hosted Postgres that requires TLS (Neon) |
| `JWT_SECRET` | Signing key. The API refuses to boot in production with the default |
| `JWT_EXPIRES_IN` | Token lifetime (default `8h`) |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to call the API |
| `LOG_LEVEL` | pino level |
| `SEED_DEMO_DATA` | `true` loads the demo cast on boot (idempotent) |
| `NEXT_PUBLIC_API_URL` | API base URL, **baked into the web bundle at build time** |

## 9. Run it

### Docker (the intended path)

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:3000, API: http://localhost:4000/api/health
- The API container applies migrations, seeds the demo cast (if `SEED_DEMO_DATA=true`), then starts.
- `web` waits for `api`, which waits for a healthy `db`.

### Manual

```bash
# 1. Postgres running, then:
cd backend && cp ../.env.example .env   # set DATABASE_URL to localhost
npm ci
npm run migrate        # apply SQL migrations + sync zones
npm run seed           # demo cast (safe to re-run)
npm run dev            # API on :4000

cd ../web && npm ci
NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev   # UI on :3000
```

### Tests

```bash
cd backend
createdb tesla_pool_test            # database name MUST end in _test; the suite refuses anything else
DATABASE_URL=postgres://tesla:tesla@localhost:5432/tesla_pool_test npm test
cd ../web && npm test
```

Tests run against real Postgres because the risky behavior (locks, constraints, races) does not exist in a mock.

### Demo credentials

Password for all: `tesla-pool-demo`

| Who | Email | Role |
|---|---|---|
| Jashim (drives Bullet, 3 seats, `DHAKA-METRO-TESLA-1`) | `jashim@teslapool.dev` | Driver |
| Nusrat | `nusrat@teslapool.dev` | Passenger |
| Rafiq | `rafiq@teslapool.dev` | Passenger |
| Shirin | `shirin@teslapool.dev` | Passenger |

These are demo-only accounts. Set `SEED_DEMO_DATA=false` for anything real.

### Try the story (2 minutes)

1. Sign in as **Jashim** (one window) and go online.
2. As **Nusrat** (private window): Banani -> Mohakhali, 1 seat. Jashim sees the request; accept it.
3. As **Rafiq**: Banani -> Gulshan 1. He auto-matches into Jashim's open pool. Nusrat's fare drops from 70.00 to 56.00 BDT, Rafiq's is 68.00 (from 85.00).
4. Fill the pool to capacity, then let **Shirin** request. She stays waiting; she is never squeezed in.
5. Jashim: arrive -> start (fares lock) -> complete (payments recorded).

## 10. Fare model

All money is **integer paisa** (1 BDT = 100 paisa), stored as `bigint`. Floating point cannot represent 0.1
exactly, errors accumulate when summed, and two services could disagree by a paisa. Integers sum exactly.

```
gross         = (BASE_FARE + round(distance_km * PER_KM)) * seats
poolDiscount  = pooled ? floor(gross * 20 / 100) : 0      # pooled = 2+ passengers in the pool
passengerFare = gross - poolDiscount
```

`BASE_FARE = 4000` (40 BDT), `PER_KM = 1500` (15 BDT/km), `POOL_DISCOUNT_PCT = 20`. Rounding is always
`floor` on the discount, so the driver is never shorted by a fraction.

**Hand check** (distances from the zone table):

| | Distance | Solo | Pooled |
|---|---|---|---|
| Nusrat, Banani -> Mohakhali | 2.0 km | 4000 + 3000 = **7000** | 7000 - 1400 = **5600** |
| Rafiq, Banani -> Gulshan 1 | 3.0 km | 4000 + 4500 = **8500** | 8500 - 1700 = **6800** |

Fares are recalculated whenever someone joins or leaves the pool and locked when the pool starts.
Payment is cash or simulated TeslaPay (wallet debit at completion). No real gateway.

## 11. Matching rule and geography

No real routing. Zones are a fixed list (Banani, Gulshan 1, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate,
Bashundhara) with a hand-written distance table in `backend/src/domain/zones.js`.
**The distances are invented approximations**, chosen so fares are checkable by hand.

A waiting request R can join pool P iff all of:

1. same pickup zone;
2. for **every** current member, `distance(R.destination, member.destination) <= 4.0 km` (checking every
   member, not just the first, prevents the route drifting as people join);
3. `P.seats_taken + R.seats <= P.capacity`;
4. pool status is `ACCEPTED` or `DRIVER_ARRIVED` (no joining mid-trip).

Nusrat and Rafiq: same pickup, Mohakhali <-> Gulshan 1 = 3.5 km <= 4.0 km, so they match.
Matching runs when a request is created (auto-join an open pool) and when a driver accepts a waiting request.

## 12. Concurrency: the last seat

Bullet has one seat left; Nusrat and Shirin both try to claim it at nearly the same instant, and both
initially see one seat free. What stops a double booking, in layers:

1. **Pool row lock.** Every join, leave and lifecycle transition begins with `SELECT ... FOR UPDATE` on the
   pool row. The two transactions queue. The second starts only after the first commits, re-reads
   `seats_taken`, fails the compatibility check and returns `409`.
2. **Conditional UPDATE.** The claim is `UPDATE pools SET seats_taken = seats_taken + n WHERE ... AND
   seats_taken + n <= capacity`; zero rows means no seat. Honestly: while the lock is held this is redundant.
   It is kept so the claim stays correct if the lock is ever narrowed.
3. **`CHECK (seats_taken <= capacity)`.** The last line of defence: a buggy code path cannot commit an
   overbooked pool. Tests exercise this by bypassing the app and writing to the table directly.

Two more races: a request can only move `REQUESTED -> MATCHED` once (`UPDATE ... WHERE status='REQUESTED'`),
so two drivers accepting the same request, or an accept racing a passenger cancel, produce exactly one
winner. Lock order is always **pool -> requests ordered by id**, which removes deadlock cycles.

Tested in `backend/test/pooling.test.js`: last-seat race, 12 passengers racing for 1 remaining seat, double accept, two
drivers on one request, cancel vs accept. The 50-test suite was run repeatedly, with no flakes and no deadlocks logged.

**At larger scale** I would keep Postgres as the source of truth and change *where* contention lives: shard
the matcher by zone so each zone's pools are handled by one worker (removes cross-zone lock contention), add
idempotency keys so client retries cannot double-book, and move from polling to push. See section 16.

## 13. Key decisions and alternatives

| Decision | Alternatives | Why it fits this MVP | What would make me switch |
|---|---|---|---|
| **Express** | NestJS, Fastify | Small surface, explicit layering (routes / services / domain) that I can defend line by line | A large team needing enforced module structure (Nest); raw throughput being a bottleneck (Fastify) |
| **PostgreSQL** | MySQL, SQLite, MongoDB | Seat capacity and one-active-ride rules are relational invariants best enforced by constraints, partial unique indexes and row locks | Geospatial matching at scale: add PostGIS / H3 first, only then consider a specialised store |
| **Raw SQL via `pg`** (no ORM) | Prisma, Drizzle, Knex | The important code is a locked conditional UPDATE and partial indexes; an ORM hides exactly what I need to see and control | Many more entities and a bigger team: Drizzle/Prisma for type safety and migrations |
| **Custom migration runner** | Knex, Flyway, node-pg-migrate | One SQL file, about 40 lines of runner, zero dependencies | More than a handful of migrations or rollbacks needed: adopt a real tool |
| **JWT (8h) + bcrypt** | Sessions, OAuth / Auth0 | Stateless API, trivial to host free; fine for a demo | Need for revocation, refresh tokens or social login: server sessions or a provider |
| **REST** | GraphQL | Few resources, clear verbs mapped to state transitions (`/arrive`, `/start`, `/complete`) | Many client shapes over the same graph |
| **`zod`** | Joi, hand-rolled | Validation at the boundary with clear error messages | - |
| **`node:test`** | Jest, Vitest | No dependency; the value is in the DB-backed tests, not the runner | Need for watch mode / snapshots / a big frontend suite |
| **Next.js, plain CSS** | Tailwind, component library | App Router routing, standalone Docker output, no styling dependency to defend | A design system or many contributors |
| **Polling every 4s** | WebSockets, SSE | Zero extra infrastructure; status changes are slow (minutes), so 4s is invisible | Many concurrent users or live location: SSE first, WebSockets if two-way |
| **Integer paisa** | `numeric`, float | Exact sums, no rounding drift | - |

## 14. API overview

All routes are under `/api`; JSON in and out; `Authorization: Bearer <jwt>` where noted.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /health` | public | liveness + DB check |
| `GET /zones` | public | zone list |
| `GET /fare/estimate?pickup=&destination=&seats=` | public | fare before booking (solo and pooled) |
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | public / any | account and session |
| `POST /rides`, `GET /rides` | passenger | request a ride / own history |
| `GET /rides/:id`, `POST /rides/:id/cancel` | passenger (owner) | status and timeline / cancel while valid |
| `GET /driver/me`, `PATCH /driver/availability` | driver | Tesla info / go online or offline |
| `GET /driver/requests` | driver | waiting requests that fit |
| `POST /driver/requests/:id/accept` | driver | accept into a pool (creates it if needed) |
| `GET /driver/pools`, `GET /driver/pools/:id` | driver | history and pool detail with audit trail |
| `POST /driver/pools/:id/{arrive,start,complete,cancel}` | driver (owner) | lifecycle transitions |

Errors use `{ error: { code, message } }` with correct statuses: `400` validation, `401` no/invalid token,
`403` wrong role, `404` not yours or not found, `409` state or capacity conflict.

**Privacy and ownership.** Another user's ride or pool returns `404`, not `403`, so ids cannot be probed.
Passengers never see other passengers' names or fares, only a co-passenger count; other passengers' names
are hidden in event timelines. Drivers see only their own pools.

## 15. Assumptions, limitations, next steps

**Assumptions**
- A pool belongs to one Tesla; one active pool per Tesla; one active request per passenger.
- A driver cancelling a pool re-queues passengers instead of cancelling their rides.
- Passengers cannot cancel after the Tesla has arrived.
- Destinations within 4 km of every member are "the same corridor".
- Fares ignore traffic, weather and time of day.

**Known limitations**
- Zone distances are **invented**, not real routing. Fares are demo numbers.
- Polling, not push; up to 4 s of staleness.
- No cancellation fees, ratings, refunds, or driver payouts. TeslaPay is a wallet balance, not a gateway.
- No refresh tokens or token revocation; logout is client-side only.
- Rate limiting covers the auth endpoints only, and is in-process (per API instance). Ride endpoints are not rate limited.
- No migration rollback. No end-to-end browser tests.
- The Docker setup could not be run in the environment where this code was written (no Docker daemon). The
  Dockerfiles and compose file follow standard patterns but **were not executed there**; see the checklist
  in section 17 before relying on them.

**Next improvements**: SSE for live status; idempotency keys on `POST /rides`; PostGIS for real pickup
points; ratings; cancellation fees; Playwright E2E for the two main flows.

## 16. If Oi Tesla goes viral (1M passengers, 100k drivers)

I would change the *minimum* needed at each step. Do not build this before the numbers justify it.

**First, find the real bottleneck.** Peak load is rush hour. Rough math: 1M passengers, say 10% in the
same 30 minutes, is about 100k requests in 1800 s, roughly 55 requests/s average and a few hundred/s at
peak. Driver location pings are the real firehose: 100k drivers every 5 s is 20k writes/s. That single number
shapes most of what follows, and it does not exist in this MVP at all (there is no live location).

| Concern | Change | Reason |
|---|---|---|
| Load balancing, horizontal scaling | Stateless API behind a load balancer, N instances; JWT already makes this possible | No server-held session state |
| DB connections | PgBouncer in front of Postgres | N instances x pool size would exhaust connections before CPU |
| Indexing, read replicas | Keep partial indexes; send history and read-only endpoints to replicas; accept replica lag there, never for seat claims | Reads dominate; writes that decide seats must hit the primary |
| Geospatial search | PostGIS or H3 cells replace the fixed zone table; match by cell + neighbour cells | Zones do not scale to a city; cells make "who is nearby" an indexed lookup |
| Driver locations | Keep the hot location stream **out of Postgres**: Redis (or similar) with TTL and geo-index; persist only trip-relevant points | 20k writes/s of ephemeral data is the wrong workload for the ledger DB |
| Ride matching, DB contention | Shard matching by zone/cell: one worker owns a cell's pools, so the last-seat lock is uncontended in practice; Postgres row lock stays as the correctness backstop | Hot pools are the contention; partitioning spreads it |
| Queues / events | Publish transition events (from `ride_events`, via outbox) to a queue for notifications, payments, analytics | Moves slow side-effects off the request path without a dual-write bug |
| Real-time | SSE (or WebSockets) replaces polling; fan-out via Redis pub/sub | Polling 1M users at 4 s is 250k req/s of mostly "no change" |
| Rate limiting | Move to a shared store at the edge / gateway, per user and per IP, covering all write endpoints | Today only auth is limited, per instance |
| Idempotency | `Idempotency-Key` on `POST /rides` and accept; unique key table | Mobile retries on bad networks must not double-book |
| Retries, failures | Timeouts, bounded retries with jitter, circuit breaker on payments; matching is at-least-once, safe because claims are conditional | Retries are safe only where operations are idempotent |
| Security | Short-lived access tokens + refresh, revocation list, secrets manager, WAF, per-role audit | Current JWT has no revocation |
| Observability | Request ids through logs (pino is already structured), RED metrics, traces, alerts on seat-claim 409 rate and matcher latency | You cannot tune what you cannot see |
| Deployment | Containers behind an orchestrator, blue/green or canary, migrations backward-compatible | Zero-downtime releases |

```mermaid
flowchart LR
  C[Clients] --> CDN[CDN / edge<br/>rate limit, WAF]
  CDN --> LB[Load balancer]
  LB --> API[API x N<br/>stateless]
  API --> PGB[PgBouncer]
  PGB --> PRI[(Postgres primary<br/>seats, rides, payments)]
  PRI --> REP[(Read replicas<br/>history)]
  API --> RED[(Redis<br/>driver geo-index, pub/sub)]
  API --> OUT[Outbox -> Queue]
  OUT --> W[Workers<br/>notify, payments, analytics]
  RED --> SSE[SSE gateway] --> C
```

What I would deliberately *not* do: microservices per actor, Kafka on day one, or a NoSQL store for rides.
The consistency-critical path (claim a seat) is small and belongs in one transactional store.

## 17. Deployment (free tier)

Constraint: no paid services. Target is **Neon** (Postgres) + **Render** (API, Docker) + **Vercel** (web).

1. **Neon**: create a project, copy the connection string.
2. **Render** -> New Web Service -> this repo, root `backend`, runtime Docker. Set:
   `DATABASE_URL` (Neon), `DATABASE_SSL=true`, `JWT_SECRET` (random, 48+ bytes), `NODE_ENV=production`,
   `CORS_ORIGIN=<your Vercel URL>`, `SEED_DEMO_DATA=true` (demo only). Health check path: `/api/health`.
   Free instances sleep when idle, so the first request after a pause can take ~30-60 s.
3. **Vercel**: import the repo, root `web`, set `NEXT_PUBLIC_API_URL=<your Render URL>`, deploy.
4. Update `CORS_ORIGIN` on Render with the final Vercel URL if it changed, and redeploy.

Fallback if free backend hosting is unavailable: `docker compose up --build` on any VM is fully reproducible.

**Untested-here checklist** (do once before recording the video): `docker compose up --build` from a clean
clone, open http://localhost:3000, log in as Jashim, run the story in section 9.

## 18. AI usage

**Tools**: Claude (Anthropic) did most of the drafting of code, tests and docs in an agentic session. I
directed the design, reviewed the output, and own every decision.

**What I used it for**: drafting the architecture document before any code; the schema and migrations; the
Express services; the concurrency tests; the Next.js UI; Dockerfiles; this README.

**One accepted suggestion**: enforcing the capacity invariant in three layers (row lock, conditional
`UPDATE`, `CHECK` constraint) instead of relying on application `if` statements. I accepted it because an
`if (seats < capacity)` check is exactly the race in the PRD, and a database constraint survives future bugs.

**One rejected / changed suggestion**: `TODO (Shahriyar, fill in honestly):` Candidates from the build:
(a) an early version interpolated values into SQL strings; it was changed to parameterized queries; (b) the
ride timeline initially leaked another passenger's name to a co-passenger; it was fixed to hide other
passengers; (c) the UI originally guessed pool capacity; the API now exposes it. Replace this text with the
one you actually remember and can explain.

**Ownership note**: I can explain the schema, the state machines, the locking order and why each constraint
exists. Replace this sentence with your own words before submitting.

## 19. Git workflow

- `master`: integrated, working code. Every feature arrived via a `--no-ff` merge of a `feature/*` branch,
  so the merge commits show what each branch delivered.
- `pre-release`: cut from `master` once the MVP was integrated; docs and deployment-readiness fixes.
- `release/v1.0.0`: cut from `pre-release`, tagged `v1.0.0`; this is the version in the video and deployment.
- Commits follow `<type>(<scope>): <description>` (`feat`, `fix`, `test`, `docs`, `build`, ...).

Note on history: commit timestamps reflect when the work was actually done.
