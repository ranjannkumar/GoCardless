-- 1. Table for Moloni API Tokens (Replacing moloni_tokens.json)
CREATE TABLE IF NOT EXISTS moloni_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at BIGINT, -- Stored as Unix epoch timestamp (ms)
    company_id INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure only one set of tokens is active (or manage per company_id if needed)
CREATE UNIQUE INDEX moloni_credentials_company_id_idx ON moloni_credentials (company_id);

-- 2. Update 'payments' table to track Moloni invoice details (based on supabase/tables/payments.sql)
ALTER TABLE payments
    ADD COLUMN moloni_document_id INT,
    ADD COLUMN invoice_pdf_url TEXT,
    ADD COLUMN moloni_error TEXT;

-- 3. Create a Storage Bucket for PDFs (Run via Supabase CLI or Dashboard)
-- CLI Command: supabase storage bucket create moloni-invoices
-- Set RLS policy to allow read access for authenticated users if needed.