-- 4. payments table (Main transaction record)
CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id uuid REFERENCES public.customers (id) ON DELETE RESTRICT NOT NULL,
    service_id text NOT NULL, -- The service/cleaning ID being paid for
    original_amount_cents integer NOT NULL, -- Original amount (before adjustments)
    final_amount_cents integer NOT NULL,    -- Current final amount to be charged
    status text NOT NULL CHECK (status IN ('scheduled', 'created', 'submitted', 'confirmed', 'failed', 'refunded', 'cancelled', 'chargeback')),
    attempts integer DEFAULT 0 NOT NULL,
    gc_payment_id text, -- GoCardless reference
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE (service_id, customer_id) -- Prevent duplicate charges for the same service
);
CREATE INDEX idx_payments_unpaid_retry ON public.payments (status, attempts);