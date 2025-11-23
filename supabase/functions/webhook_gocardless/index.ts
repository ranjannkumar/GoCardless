import { serve } from "https://deno.land/std@0.207.0/http/server.ts";
import { supabase, logEvent } from '../../../src/db.ts';
import { GoCardlessProvider } from '../../../src/payments/gocardless.ts';
import { PaymentStatus } from '../../../src/types.ts';

// 1. ADD MOLONI IMPORTS
import { createInvoiceReceipt, MoloniDocumentPayload, MoloniProductLine } from "moloni"; 


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
        // MODIFIED: Fetch 'amount' and 'gc_payment_id' for Moloni logic
        const { data: payment } = await supabase.from('payments')
            .select('id, attempts, customer_id, amount, gc_payment_id') 
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

            // --- MOLONI INVOICING LOGIC INSERTED HERE ---
            try {
                // 1. Get full customer details for Moloni fields
                const customerResult = await supabase
                    .from('customers') // Assuming a 'customers' table linked to GC mandates
                    .select('first_name, last_name, email, vat_number')
                    .eq('id', payment.customer_id)
                    .single();
                
                if (customerResult.error || !customerResult.data) {
                    throw new Error(`Customer details not found in DB for Moloni invoicing (ID: ${payment.customer_id})`);
                }
                
                const customer = customerResult.data;
                
                // Convert GoCardless amount (in cents/pence) to Moloni price (€/£)
                const unit_price = payment.amount / 100;
                
                // IMPORTANT: Replace 123 with your actual Moloni Product ID
                const products: MoloniProductLine[] = [{ 
                    product_id: 123, 
                    qty: 1, 
                    price: unit_price,
                }];
                
                const moloniPayload: MoloniDocumentPayload = {
                    customer: {
                        name: `${customer.first_name} ${customer.last_name}`,
                        email: customer.email,
                        vat: customer.vat_number,
                    },
                    products: products,
                    // Use the GoCardless Payment ID as a reference
                    your_reference: payment.gc_payment_id, 
                    notes: `GoCardless Payment ID: ${payment.gc_payment_id}`,
                };

                const { moloni_document_id, invoice_pdf_url } = await createInvoiceReceipt(moloniPayload);

                // 2. Update the payment record with Moloni details
                const { error: updateError } = await supabase
                    .from('payments')
                    .update({
                        moloni_document_id: moloni_document_id,
                        invoice_pdf_url: invoice_pdf_url,
                        moloni_error: null 
                    })
                    .eq('id', payment.id);

                if (updateError) {
                    console.error('Failed to update payment with Moloni details:', updateError);
                }

            } catch (e) {
                // 3. Handle and save Moloni error
                console.error('Moloni Invoicing Error:', e.message);
                const errorMessage = (e.message || 'Unknown Moloni error').substring(0, 255); // Truncate to fit DB column
                await supabase
                    .from('payments')
                    .update({ moloni_error: errorMessage })
                    .eq('id', payment.id);
            }
            // --- END MOLONI INVOICING LOGIC ---

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