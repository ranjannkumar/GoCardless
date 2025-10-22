-- 3. settings table
CREATE TABLE public.settings (
    key text PRIMARY KEY,
    value text NOT NULL
);

-- Seed data for settings
INSERT INTO public.settings (key, value) VALUES
('lead_time_days', '5'),
('max_unpaid_allowed', '1'), -- Important business rule
('max_retries', '3'),
('retry_gap_days', '7'),
('default_currency', 'EUR')
ON CONFLICT (key) DO NOTHING;