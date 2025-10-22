// supabase/functions/retry_daemon/index.ts
import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { supabase, logEvent, getSettings } from '../../../src/db.ts';
import { GoCardlessProvider } from '../../../src/payments/gocardless.ts';
import { Payment, PaymentStatus } from '../../../src/types.ts';

const provider = new GoCardlessProvider();

serve(async (_req) => {
    // 1. Only allow internal or cron calls (authentication omitted for brevity)
    if (_req.headers.get('Authorization') !== `Bearer ${Deno.env.get('RETRY_DAEMON_SECRET')}`) {
        // return new Response('Unauthorized', { status: 401 });
    }

    const settings = await getSettings();
    const retryGapDays = settings.retry_gap_days;
    const maxRetries = settings.max_retries;

    const retryThresholdDate = new Date();
    retryThresholdDate.setDate(retryThresholdDate.getDate() - retryGapDays);

    // 2. Find failed payments eligible for retry
    const { data: payments, error } = await supabase.from('payments')
        .select('*')
        .eq('status', 'failed')
        .lt('attempts', maxRetries)
        .or(`last_attempt_at.is.null,last_attempt_at.lt.${retryThresholdDate.toISOString()}`);

    if (error) {
        console.error('Failed to fetch retry payments:', error);
        return new Response(JSON.stringify({ error: 'DB Error' }), { status: 500 });
    }

    if (!payments || payments.length === 0) {
        return new Response(JSON.stringify({ message: 'No payments eligible for retry.' }), { status: 200 });
    }

    let retriesCount = 0;
    for (const p of payments as Payment[]) {
        try {
            // 3. Check for active mandate again (best practice before charging)
            const { data: mandate } = await supabase.from('gc_mandates')
                .select('gc_mandate_id')
                .eq('customer_id', p.customer_id)
                .eq('status', 'active')
                .single();

            if (!mandate) {
                await logEvent(p.id, 'retry_rejected_no_active_mandate');
                continue;
            }

            // 4. Create new payment via GoCardless
            const { gc_payment_id } = await provider.createPayment(
                mandate.gc_mandate_id,
                p.final_amount_cents,
                `Retry for Service ${p.service_id}`,
                { original_payment_id: p.id, retry_attempt: p.attempts + 1 }
            );

            // 5. Update payment record (in a transaction is ideal)
            await supabase.from('payments')
                .update({
                    status: 'created' as PaymentStatus,
                    gc_payment_id: gc_payment_id,
                    attempts: p.attempts + 1,
                    last_attempt_at: new Date().toISOString(),
                })
                .eq('id', p.id);

            await logEvent(p.id, 'retry_scheduled', { new_gc_id: gc_payment_id });
            retriesCount++;

        } catch (e) {
            // Fix: Check if 'e' is an Error object before accessing .message
            let errorMessage: string;
            if (e instanceof Error) {
                errorMessage = e.message;
            } else {
                // Safely convert to a string if it's not a standard Error object
                errorMessage = String(e);
            }
            
            // Use the safely extracted errorMessage for logging and console.error
            console.error(`Retry failed for payment ${p.id}: ${errorMessage}`);
            
            await logEvent(p.id, 'retry_failed_gateway_error', { error: errorMessage });
            // The payment remains in 'failed' status to be picked up later or manually resolved
        }
    }

    return new Response(JSON.stringify({ success: true, retries_initiated: retriesCount }), {
        headers: { 'Content-Type': 'application/json' },
    });
});