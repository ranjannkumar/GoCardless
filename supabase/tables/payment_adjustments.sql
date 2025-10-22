-- 5. payment_adjustments table
CREATE TABLE public.payment_adjustments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id uuid REFERENCES public.payments (id) ON DELETE CASCADE NOT NULL,
    type text NOT NULL CHECK (type IN ('increase', 'decrease')),
    amount_cents integer NOT NULL,
    reason text NOT NULL,
    created_by text NOT NULL, -- Internal user ID
    created_at timestamp with time zone DEFAULT now() NOT NULL
);