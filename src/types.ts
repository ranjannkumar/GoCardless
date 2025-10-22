// src/types.ts

export type CustomerStatus = 'active' | 'suspended';
export type MandateStatus = 'pending' | 'active' | 'cancelled' | 'failed';
export type PaymentStatus = 'scheduled' | 'created' | 'submitted' | 'confirmed' | 'failed' | 'refunded' | 'cancelled' | 'chargeback';
export type AdjustmentType = 'increase' | 'decrease';

export interface Customer {
    id: string;
    email: string;
    status: CustomerStatus;
}

export interface GCMandate {
    id: string;
    customer_id: string;
    gc_mandate_id: string;
    status: MandateStatus;
    is_active: boolean;
}

export interface Payment {
    id: string;
    customer_id: string;
    service_id: string;
    original_amount_cents: number;
    final_amount_cents: number;
    status: PaymentStatus;
    attempts: number;
    gc_payment_id: string | null;
}

export interface PaymentAdjustment {
    id: string;
    payment_id: string;
    type: AdjustmentType;
    amount_cents: number;
    reason: string;
    created_by: string;
}

export interface Refund {
    id: string;
    payment_id: string;
    amount_cents: number;
    status: 'pending' | 'processed' | 'failed';
    gc_refund_id: string | null;
}

export interface Settings {
    max_unpaid_allowed: number;
    max_retries: number;
    retry_gap_days: number;
    default_currency: string;
}