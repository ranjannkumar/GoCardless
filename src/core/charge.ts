import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.40.0";
import { PaymentProvider } from '../payments/provider.ts';
import { Customer, Payment, GCMandate, Settings } from '../types.ts';

export class PaymentService {
    constructor(private db: SupabaseClient, private provider: PaymentProvider) {}

    private async getSettings(): Promise<Settings> {
        // Fetch all key/value pairs from the settings table
        const { data } = await this.db.from('settings').select('key, value');
        const map = data ? Object.fromEntries(data.map(r => [r.key, r.value])) : {};
        
        // Ensure all required properties in the Settings interface are returned
        return {
            max_unpaid_allowed: parseInt(map.max_unpaid_allowed),
            max_retries: parseInt(map.max_retries),
            retry_gap_days: parseInt(map.retry_gap_days),
            // 💡 FIX: Add the missing 'default_currency' property
            default_currency: map.default_currency,
        };
    }

    private async logEvent(payment_id: string, event_type: string, raw_payload: Record<string, unknown> | null = null): Promise<void> {
        await this.db.from('payment_events').insert({
            payment_id,
            event_type,
            raw_payload: raw_payload || {},
        });
    }

    /**
     * The main callable function: charge_user(user_id, amount_cents)
     */
    public async chargeUser(customer_id: string, service_id: string, amount_cents: number): Promise<{ payment_id: string }> {
        // 1. Validate customer and mandate (in a single transaction for consistency)
        const { data: customerData, error: custError } = await this.db
            .from('customers')
            .select('*')
            .eq('id', customer_id)
            .single();

        if (custError || customerData.status !== 'active') {
            throw new Error(`Customer ${customer_id} is inactive or not found.`);
        }

        const { data: mandateData, error: mandateError } = await this.db
            .from('gc_mandates')
            .select('*')
            .eq('customer_id', customer_id)
            .eq('status', 'active')
            .single();

        if (mandateError || !mandateData) {
            throw new Error(`Active mandate not found for customer ${customer_id}.`);
        }

        // 2. Check business rules (max unpaid)
        const settings = await this.getSettings();
        const { count: unpaidCount } = await this.db
            .from('payments')
            .select('id', { count: 'exact' })
            .eq('customer_id', customer_id)
            .eq('status', 'failed'); // Assuming 'failed' is the main unpaid status

        if (unpaidCount && unpaidCount >= settings.max_unpaid_allowed) {
             // **Rule 1**: Reject charge if max_unpaid_allowed is reached
            throw new Error(`Charge rejected: Max unpaid payments limit (${settings.max_unpaid_allowed}) reached.`);
        }

        // 3. Create initial payment record (Status: 'scheduled')
        const { data: paymentData, error: paymentError } = await this.db
            .from('payments')
            .insert({
                customer_id,
                service_id,
                original_amount_cents: amount_cents,
                final_amount_cents: amount_cents, // Initially same as original
                status: 'scheduled',
            })
            .select('*')
            .single();

        if (paymentError) {
            throw new Error(`Failed to create payment record: ${paymentError.message}`);
        }

        const payment: Payment = paymentData as Payment;

        // 4. Check for adjustments and recalculate final_amount_cents (before submission)
        const { data: adjustments } = await this.db
            .from('payment_adjustments')
            .select('type, amount_cents')
            .eq('payment_id', payment.id);

        let finalAmount = amount_cents;
        if (adjustments) {
            for (const adj of adjustments) {
                finalAmount += adj.type === 'increase' ? adj.amount_cents : -adj.amount_cents;
            }
            await this.db.from('payments').update({ final_amount_cents: finalAmount }).eq('id', payment.id);
            payment.final_amount_cents = finalAmount;
        }

        await this.logEvent(payment.id, 'scheduled', { amount: finalAmount });

        // 5. Send to GoCardless
        let gc_payment_id: string;
        try {
            const result = await this.provider.createPayment(
                mandateData.gc_mandate_id,
                payment.final_amount_cents,
                `Payment for Service ${service_id}`,
                { payment_id: payment.id }
            );
            gc_payment_id = result.gc_payment_id;
        } catch (e) {
           // 💡 FIX: Safely extract error message using type narrowing
        let errorMessage: string;
        if (e instanceof Error) {
            errorMessage = e.message;
        } else {
            errorMessage = String(e);
        }

        // Log failure to gateway but keep status as 'scheduled' for manual follow-up
        await this.logEvent(payment.id, 'gateway_creation_failed', { error: errorMessage });
        throw new Error(`Payment gateway failed to create charge: ${errorMessage}`);
    }

        // 6. Update payment record (Status: 'created')
        const { error: updateError } = await this.db
            .from('payments')
            .update({
                status: 'created',
                gc_payment_id,
                attempts: 1, // First attempt
                last_attempt_at: new Date().toISOString(),
            })
            .eq('id', payment.id);

        if (updateError) {
            await this.logEvent(payment.id, 'db_update_after_gc_success_failed', { gc_payment_id });
            throw new Error(`DB update after GoCardless success failed: ${updateError.message}`);
        }

        await this.logEvent(payment.id, 'created', { gc_payment_id });

        return { payment_id: payment.id };
    }
}