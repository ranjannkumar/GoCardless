-- 2. gc_mandates table
CREATE TABLE public.gc_mandates (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id uuid REFERENCES public.customers (id) ON DELETE CASCADE NOT NULL,
    gc_mandate_id text UNIQUE NOT NULL, -- GoCardless reference
    status text NOT NULL CHECK (status IN ('pending', 'active', 'cancelled', 'failed')),
    is_active boolean NOT NULL DEFAULT TRUE,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX idx_active_mandate_per_customer ON public.gc_mandates (customer_id) WHERE status = 'active';