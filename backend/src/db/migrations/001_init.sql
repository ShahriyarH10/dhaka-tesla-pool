-- Dhaka Tesla Pool: initial schema.
-- Money is integer paisa (bigint). Every status column has a CHECK so a typo cannot create a ghost state.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Reference data (populated by the boot-time zone sync, see src/domain/zones.js)
CREATE TABLE zones (
  id   text PRIMARY KEY,                 -- slug, e.g. 'banani'
  name text NOT NULL,
  lat  numeric(9,6) NOT NULL,
  lng  numeric(9,6) NOT NULL
);

-- USERS: passengers and drivers share one table (one login flow); role decides permissions.
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('PASSENGER','DRIVER')),
  wallet_balance_paisa  bigint NOT NULL DEFAULT 0 CHECK (wallet_balance_paisa >= 0),  -- simulated TeslaPay
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness without the citext extension.
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- TESLAS: one vehicle per driver in the MVP (UNIQUE driver_id). capacity is the hard seat limit.
CREATE TABLE teslas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  plate      text NOT NULL UNIQUE,
  capacity   int  NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  is_online  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RIDE_REQUESTS: one row per passenger ask. Owns the passenger's fare and status.
CREATE TABLE ride_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id     uuid NOT NULL REFERENCES users(id),
  pickup_zone      text NOT NULL REFERENCES zones(id),
  destination_zone text NOT NULL REFERENCES zones(id),
  seats            int  NOT NULL CHECK (seats BETWEEN 1 AND 6),
  status           text NOT NULL DEFAULT 'REQUESTED'
                   CHECK (status IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','STARTED','COMPLETED','CANCELLED')),
  payment_method   text NOT NULL CHECK (payment_method IN ('CASH','TESLAPAY')),
  fare_paisa       bigint NOT NULL CHECK (fare_paisa > 0),   -- current fare (recomputed while the pool forms)
  fare_breakdown   jsonb  NOT NULL,                          -- base, distance, seats, discount: auditable
  fare_locked      boolean NOT NULL DEFAULT false,           -- true once the ride STARTED
  cancelled_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (pickup_zone <> destination_zone)
);
-- A passenger can only have ONE active request. Enforced by the database, so a double-tap cannot create two.
CREATE UNIQUE INDEX ride_requests_one_active_per_passenger
  ON ride_requests (passenger_id) WHERE status IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','STARTED');
-- Driver's "relevant requests" query: waiting requests by pickup zone, oldest first.
CREATE INDEX ride_requests_waiting_idx ON ride_requests (pickup_zone, created_at) WHERE status = 'REQUESTED';
-- Passenger history.
CREATE INDEX ride_requests_passenger_idx ON ride_requests (passenger_id, created_at DESC);

-- POOLS: one Tesla trip. seats_taken is a counter guarded by CHECK; it is the concurrency choke point.
CREATE TABLE pools (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tesla_id     uuid NOT NULL REFERENCES teslas(id),
  pickup_zone  text NOT NULL REFERENCES zones(id),
  status       text NOT NULL DEFAULT 'ACCEPTED'
               CHECK (status IN ('ACCEPTED','DRIVER_ARRIVED','STARTED','COMPLETED','CANCELLED')),
  capacity     int  NOT NULL CHECK (capacity BETWEEN 1 AND 6),   -- copied from the Tesla at creation
  seats_taken  int  NOT NULL DEFAULT 0 CHECK (seats_taken >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  arrived_at   timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (seats_taken <= capacity)                                 -- the invariant: never overbooked
);
-- A Tesla can only run one active pool at a time.
CREATE UNIQUE INDEX pools_one_active_per_tesla
  ON pools (tesla_id) WHERE status IN ('ACCEPTED','DRIVER_ARRIVED','STARTED');
-- Auto-match lookup: open pools by pickup zone.
CREATE INDEX pools_open_idx ON pools (pickup_zone) WHERE status IN ('ACCEPTED','DRIVER_ARRIVED');
CREATE INDEX pools_tesla_history_idx ON pools (tesla_id, created_at DESC);

-- POOL_MEMBERS: who is (or was) in which pool. left_at IS NULL means currently a member.
-- Rows are never deleted: history must explain "Nusrat was in the pool until she cancelled at 8:47".
CREATE TABLE pool_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id    uuid NOT NULL REFERENCES pools(id),
  request_id uuid NOT NULL REFERENCES ride_requests(id),
  seats      int  NOT NULL CHECK (seats BETWEEN 1 AND 6),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  left_reason text CHECK (left_reason IN ('PASSENGER_CANCELLED','DRIVER_CANCELLED','COMPLETED')),
  CHECK ((left_at IS NULL) = (left_reason IS NULL))
);
-- A request is an active member of at most one pool.
CREATE UNIQUE INDEX pool_members_one_active_per_request ON pool_members (request_id) WHERE left_at IS NULL;
CREATE INDEX pool_members_pool_idx ON pool_members (pool_id) WHERE left_at IS NULL;

-- PAYMENTS: simulated settlement written exactly once, when the ride completes.
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL UNIQUE REFERENCES ride_requests(id),   -- UNIQUE = idempotent completion
  passenger_id  uuid NOT NULL REFERENCES users(id),
  driver_id     uuid NOT NULL REFERENCES users(id),
  method        text NOT NULL CHECK (method IN ('CASH','TESLAPAY')),
  amount_paisa  bigint NOT NULL CHECK (amount_paisa > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- RIDE_EVENTS: append-only audit log of every state transition (requests and pools).
CREATE TABLE ride_events (
  id            bigserial PRIMARY KEY,
  entity_type   text NOT NULL CHECK (entity_type IN ('REQUEST','POOL')),
  entity_id     uuid NOT NULL,
  from_status   text,
  to_status     text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_entity_idx ON ride_events (entity_type, entity_id, id);
