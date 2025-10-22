// src/payments/mock.ts
import { PaymentProvider } from './provider.ts';
import { PaymentStatus } from '../types.ts';

/**
 * Mock implementation for local development and unit tests.
 * Simulates immediate 'submitted' status for payments.
 */
export class MockPaymentProvider implements PaymentProvider {
    // Simple state to simulate IDs
    private paymentCounter = 1000;
    private refundCounter = 500;

    async createPayment(mandateId: string, amount_cents: number): Promise<{ gc_payment_id: string }> {
        console.log(`[MOCK GC] Creating payment for Mandate ${mandateId}, Amount ${amount_cents}`);
        this.paymentCounter++;
        return { gc_payment_id: `PM${this.paymentCounter}` };
    }

    async refundPayment(gc_payment_id: string, amount_cents: number): Promise<{ gc_refund_id: string }> {
        console.log(`[MOCK GC] Issuing refund for Payment ${gc_payment_id}, Amount ${amount_cents}`);
        this.refundCounter++;
        return { gc_refund_id: `RF${this.refundCounter}` };
    }

    async validateWebhook(payload: string, signature: string): Promise<boolean> {
        // Mock always validates successfully
        return true;
    }

    parseWebhook(payload: string): { id: string, type: string, gc_payment_id: string, new_status: PaymentStatus }[] {
        // Mock implementation should be used carefully, typically it simulates
        // a 'confirmed' or 'failed' event for a known mock ID.
        return [];
    }
}