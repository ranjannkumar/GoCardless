// src/payments/provider.ts
import { PaymentStatus } from '../types.ts';

/**
 * Interface for all external payment gateway interactions.
 */
export interface PaymentProvider {
    /**
     * Creates a payment in the gateway for a given mandate.
     * @returns The gateway's payment ID.
     */
    createPayment(
        mandateId: string,
        amount_cents: number,
        description: string,
        metadata: Record<string, unknown>
    ): Promise<{ gc_payment_id: string }>;

    /**
     * Issues a refund for an existing payment.
     * @returns The gateway's refund ID.
     */
    refundPayment(
        gc_payment_id: string,
        amount_cents: number,
        reason: string
    ): Promise<{ gc_refund_id: string }>;

    /**
     * Validates the webhook signature.
     */
    validateWebhook(payload: string, signature: string): Promise<boolean>;

    /**
     * Parses the raw webhook payload into structured events.
     */
    parseWebhook(payload: string): { id: string, type: string, gc_payment_id: string, new_status: PaymentStatus }[];
}