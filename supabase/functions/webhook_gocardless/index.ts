// supabase/functions/webhook_gocardless/index.ts
import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { supabase, logEvent } from '../../../src/db.ts';
import { GoCardlessProvider } from '../../../src/payments/gocardless.ts';
import { PaymentStatus } from '../../../src/types.ts';

const provider = new GoCardlessProvider();

serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    // 1. Validate signature
    const signature = req.headers.get('Webhook-Signature') || '';
    const rawPayload = await req.text();

    if (!await provider.validateWebhook(rawPayload, signature)) {
        return new Response('Unauthorized: Invalid Signature', { status: 403 });
    }

    // 2. Parse payload
    const gcEvents = provider.parseWebhook(rawPayload);

    for (const event of gcEvents) {
        // 3. Prevent duplicate processing (Idempotency)
        const { count } = await supabase.from('payment_events')
            .select('id', { count: 'exact' })
            .eq('event_type', `webhook_${event.type}`)
            .eq('raw_payload->>id', event.id);

        if (count && count > 0) {
            console.log(`Webhook event ${event.id} already processed. Skipping.`);
            continue;
        }

        // 4. Find the internal payment
        const { data: payment } = await supabase.from('payments')
            .select('id, attempts, customer_id')
            .eq('gc_payment_id', event.gc_payment_id)
            .single();

        if (!payment) continue;

        const newStatus = event.new_status;

        // 5. Update status and log event
        await supabase.from('payments')
            .update({ status: newStatus })
            .eq('id', payment.id);

        await logEvent(payment.id, `webhook_${event.type}`, { 
            event_id: event.id, 
            new_status: newStatus, 
            raw_payload: rawPayload 
        });

        // 6. Handle specific terminal states
        if (newStatus === 'confirmed') {
            // Mark as paid, send receipt (not implemented here)
            console.log(`Payment ${payment.id} confirmed. Sending receipt.`);
        } else if (newStatus === 'failed' && payment.attempts < 3) { // Use hardcoded 3 for simplicity, or fetch settings
            // Failed: Schedule a retry (handled by retry_daemon, but log the failure)
            console.log(`Payment ${payment.id} failed. Will be retried.`);
        } else if (newStatus === 'chargeback' || newStatus === 'cancelled') {
            // Flag/Suspend customer (not implemented here, but necessary)
            console.log(`Payment ${payment.id} terminal state ${newStatus}. Review customer ${payment.customer_id}.`);
        }
    }

    return new Response(JSON.stringify({ success: true, processed_events: gcEvents.length }), {
        headers: { 'Content-Type': 'application/json' },
    });
});