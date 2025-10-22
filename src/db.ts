// src/db.ts
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.40.0";
import { Settings } from './types.ts';

// Note: This must be run in the Deno/Edge Function environment.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            // Disable session storage since we use the service role key
            persistSession: false,
        }
    }
);

// Helper for logging events (used by all Edge Functions)
export async function logEvent(payment_id: string, event_type: string, raw_payload: Record<string, unknown> | null = null): Promise<void> {
    await supabase.from('payment_events').insert({
        payment_id,
        event_type,
        raw_payload: raw_payload || {},
    });
}

export async function getSettings(): Promise<Settings> {
    const { data } = await supabase.from('settings').select('key, value');
    const map = data ? Object.fromEntries(data.map(r => [r.key, r.value])) : {};
    return {
        max_unpaid_allowed: parseInt(map.max_unpaid_allowed),
        max_retries: parseInt(map.max_retries),
        retry_gap_days: parseInt(map.retry_gap_days),
        default_currency: map.default_currency,
    } as Settings;
}