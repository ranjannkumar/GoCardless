// supabase/functions/admin_adjustment/index.ts
import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { supabase, logEvent } from '../../../src/db.ts';
import { AdjustmentType } from '../../../src/types.ts';

serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }
    
    // Auth and User ID (omitted for brevity)
    const { payment_id, type, amount_cents, reason, created_by } = await req.json();

    if (!payment_id || !type || !amount_cents || !reason || !created_by || !['increase', 'decrease'].includes(type)) {
        return new Response('Missing or invalid parameters', { status: 400 });
    }

    // 1. Validate payment status (must be 'scheduled' to allow adjustment)
    const { data: payment, error: fetchError } = await supabase.from('payments')
        .select('status, final_amount_cents, original_amount_cents')
        .eq('id', payment_id)
        .single();

    if (fetchError || !payment) {
        return new Response('Payment not found.', { status: 404 });
    }

    if (payment.status !== 'scheduled') {
        return new Response(`Cannot adjust a payment with status: ${payment.status}.`, { status: 400 });
    }

    // 2. Insert adjustment record
    const { error: adjError } = await supabase.from('payment_adjustments')
        .insert({ payment_id, type, amount_cents, reason, created_by });

    if (adjError) {
        return new Response(`DB error: ${adjError.message}`, { status: 500 });
    }

    // 3. Recalculate and update the final_amount_cents
    const change = type === 'increase' ? amount_cents : -amount_cents;
    const newFinalAmount = payment.final_amount_cents + change;

    if (newFinalAmount < 0) {
        // Prevent negative final amount, should fail adjustment here ideally (need a transaction)
        return new Response('Adjustment would result in a negative payment amount.', { status: 400 });
    }

    const { error: updateError } = await supabase.from('payments')
        .update({ final_amount_cents: newFinalAmount })
        .eq('id', payment_id);

    if (updateError) {
        return new Response(`DB update error: ${updateError.message}`, { status: 500 });
    }

    await logEvent(payment_id, 'manual_adjustment_applied', { type, amount_cents, reason, created_by, new_final_amount: newFinalAmount });

    return new Response(JSON.stringify({ success: true, new_final_amount: newFinalAmount }), {
        headers: { 'Content-Type': 'application/json' },
    });
});