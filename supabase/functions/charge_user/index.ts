import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0";
import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { PaymentService } from '../../../src/core/charge.ts';
// NOTE: For a real deployment, you'd use gocardless.ts
// For local testing, you might use mock.ts or switch based on an env var.
import { MockPaymentProvider } from '../../../src/payments/mock.ts';
// import { GoCardlessProvider } from '../../../src/payments/gocardless.ts';

// Get access to the DB with Service Role for RLS bypass
const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const provider = new MockPaymentProvider(); // Replace with GoCardlessProvider in production
const paymentService = new PaymentService(supabase, provider);

serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { user_id, amount_cents, service_id } = await req.json();

        if (!user_id || !amount_cents || !service_id) {
            return new Response(JSON.stringify({ error: 'Missing required parameters: user_id, amount_cents, service_id' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const result = await paymentService.chargeUser(user_id, service_id, amount_cents);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (e) {
       // Fix: Safely determine the error message by narrowing the type of 'e'.
        let errorMessage: string;
        if (e instanceof Error) {
            errorMessage = e.message;
        } else {
            // Fallback for non-Error objects (e.g., strings or thrown promises)
            errorMessage = String(e);
        }

        // Use the safely extracted errorMessage
        console.error('Charge failed:', errorMessage);
        
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});