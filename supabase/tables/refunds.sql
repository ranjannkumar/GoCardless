-- 6. refunds table
CREATE TABLE public.refunds (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id uuid REFERENCES public.payments (id) ON DELETE RESTRICT NOT NULL,
    amount_cents integer NOT NULL, -- Amount refunded (partial or full)
    status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
    gc_refund_id text,
    reason text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);