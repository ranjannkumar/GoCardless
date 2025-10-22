-- 7. payment_events (Audit log)
CREATE TABLE public.payment_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id uuid REFERENCES public.payments (id) ON DELETE CASCADE NOT NULL,
    event_type text NOT NULL, -- e.g., 'created', 'submitted', 'webhook_confirmed', 'retry_scheduled'
    raw_payload jsonb, -- Original data (e.g., webhook payload)
    created_at timestamp with time zone DEFAULT now() NOT NULL
);