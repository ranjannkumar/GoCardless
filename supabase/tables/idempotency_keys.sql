-- 8. idempotency_keys (For external calls and webhooks)
CREATE TABLE public.idempotency_keys (
    id text PRIMARY KEY,
    last_run_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_expires_at timestamp with time zone DEFAULT now() + interval '5 minutes' NOT NULL
);