// supabase/functions/admin_refund/index.ts
import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { supabase, logEvent } from '../../../src/db.ts';
import { GoCardlessProvider } from '../../../src/payments/gocardless.ts';
import { Refund } from '../../../src/types.ts';

const provider = new GoCardlessProvider();

serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }
    
    // Auth and User ID (omitted for brevity)
    const { payment_id, amount_cents, reason, created_by } = await req.json();

    if (!payment_id || !amount_cents || !reason || !created_by) {
        return new Response('Missing parameters', { status: 400 });
    }

    // 1. Validate payment and get GC ID
    const { data: payment } = await supabase.from('payments')
        .select('gc_payment_id, status, final_amount_cents')
        .eq('id', payment_id)
        .single();

    if (!payment || !payment.gc_payment_id) {
        return new Response('Payment not found or not submitted to GC.', { status: 404 });
    }
    
    // Check if payment is already fully refunded or has chargeback

    // 2. Create local refund record (Status: pending)
    const { data: refundData, error: refundError } = await supabase.from('refunds')
        .insert({ payment_id, amount_cents, reason, created_by, status: 'pending' })
        .select('*').single();

    if (refundError) {
        return new Response(`DB error: ${refundError.message}`, { status: 500 });
    }
    
    const refund: Refund = refundData as Refund;

    // 3. Send to GoCardless
    try {
        const { gc_refund_id } = await provider.refundPayment(
            payment.gc_payment_id,
            amount_cents,
            reason
        );

        // 4. Update refund record (with GC ID)
        await supabase.from('refunds')
            .update({ gc_refund_id, status: 'processed' })
            .eq('id', refund.id);

        await logEvent(payment_id, 'refund_request_processed', { refund_id: refund.id, gc_refund_id });
        
        // **NOTE**: The final payment status ('refunded') should ideally be set by the GC webhook for eventual consistency.

        return new Response(JSON.stringify({ success: true, refund_id: refund.id }), { status: 200 });

    } catch (e) {
       // Fix: Determine the error message safely by checking if 'e' is an Error object.
        let errorMessage: string;
        if (e instanceof Error) {
            errorMessage = e.message;
        } else {
            // Handle cases where non-Error objects (like strings or numbers) are thrown
            errorMessage = String(e);
        }

        // If GC request fails, mark local refund as failed
        await supabase.from('refunds')
            .update({ status: 'failed' })
            .eq('id', refund.id);
            
        // Use the safely extracted errorMessage
        await logEvent(payment_id, 'refund_request_failed', { reason: errorMessage }); 
        
        return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
    }
});