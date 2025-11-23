// Deno imports from your import_map.json
import { supabase } from '../db.ts';
import { PostgrestSingleResponse } from 'https://esm.sh/@supabase/supabase-js@2.42.5';

// --- Types for Moloni API Responses and Payloads ---

interface MoloniCustomer {
    customer_id?: number;
    id?: number;
    vat?: string;
    email?: string;
    name?: string;
}

interface MoloniProductLine {
    product_id: number;
    qty?: number;
    price?: number; // unit_price
    unit_price?: number;
    tax_id?: number;
    taxes?: Array<{ tax_id: number }>;
}

interface MoloniDocumentPayload {
    customer: MoloniCustomer;
    date?: string;
    document_set_id?: number;
    your_reference?: string;
    products: MoloniProductLine[];
    notes?: string;
    // Specific for Transport Guide
    warehouse_id?: number;
    delivery_address?: string;
    vehicle?: string;
    load_datetime?: string;
    unload_datetime?: string;
}

interface MoloniToken {
    id: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: number | null; // Milliseconds
    company_id: number;
}

// --- Configuration Constants ---

const SANDBOX = Deno.env.get('MOLONI_SANDBOX') === 'true';

const MOLONI_CLIENT_ID = Deno.env.get('MOLONI_CLIENT_ID')!;
const MOLONI_CLIENT_SECRET = Deno.env.get('MOLONI_CLIENT_SECRET')!;
const MOLONI_REDIRECT_URI = Deno.env.get('MOLONI_REDIRECT_URI')!;
const MOLONI_TAX_ID_DEFAULT = Number(Deno.env.get('MOLONI_TAX_ID_DEFAULT'));
const MOLONI_PM_ID = Number(Deno.env.get('MOLONI_PM_ID'));

const API_BASE = SANDBOX ? 'https://api.moloni.pt/sandbox' : 'https://api.moloni.pt/v1';
const OAUTH_BASE = 'https://id.moloni.pt';

// Endpoints (copied/adapted from server.js)
const EP = {
    invInsert: '/invoices/insert',
    invGetOne: '/invoices/getOne',
    invGetPDF: SANDBOX ? '/documents/getPDFLink' : '/invoices/getPDF',
    invPayment: '/invoices/insertPayment',
    invRecInsert: '/invoiceReceipts/insert',
    invRecGetOne: '/invoiceReceipts/getOne',
    productsSearch: SANDBOX ? '/products/getBySearch' : '/products/search',
    customersSearch: SANDBOX ? '/customers/getBySearch' : '/customers/search',
};

// --- DB Token Management (Replaces moloni_tokens.json logic) ---

async function loadTokens(): Promise<MoloniToken | null> {
    const { data, error } = await supabase
        .from('moloni_credentials')
        .select('*')
        .limit(1)
        .order('created_at', { ascending: false })
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 means "No rows found"
        console.error('Error loading tokens:', error);
    }
    return data as MoloniToken | null;
}

async function saveTokens(tokens: Partial<MoloniToken>): Promise<void> {
    const current = await loadTokens();
    
    // We update the existing record if present, otherwise insert a new one
    if (current) {
        const { error } = await supabase
            .from('moloni_credentials')
            .update(tokens)
            .eq('id', current.id);
        if (error) console.error('Error updating tokens:', error);
    } else {
        const defaultCompanyId = Number(Deno.env.get('MOLONI_COMPANY_ID'));
        if (!defaultCompanyId) throw new Error("MOLONI_COMPANY_ID is required to save new tokens.");
        
        const { error } = await supabase
            .from('moloni_credentials')
            .insert({ ...tokens, company_id: defaultCompanyId });
        if (error) console.error('Error inserting tokens:', error);
    }
}

async function oauthToken(body: Record<string, string>): Promise<any> {
    const url = `${OAUTH_BASE}/oauth/token`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`OAuth token failure: ${r.status} - ${t}`);
    }
    return r.json();
}

async function refreshLive(refreshToken: string): Promise<string> {
    const j = await oauthToken({
        grant_type: 'refresh_token',
        client_id: MOLONI_CLIENT_ID,
        client_secret: MOLONI_CLIENT_SECRET,
        refresh_token: refreshToken,
    });
    const expires_at = Date.now() + (j.expires_in * 1000) - 30000;
    await saveTokens({ 
        access_token: j.access_token, 
        refresh_token: j.refresh_token ?? refreshToken, 
        expires_at 
    });
    return j.access_token;
}

async function getAccessToken(): Promise<{ token: string, company_id: number }> {
    const t = await loadTokens();
    if (!t?.access_token) {
        throw new Error('Moloni access_token not found in database. Please authorize first.');
    }
    
    const companyId = Number(Deno.env.get('MOLONI_COMPANY_ID')) || t.company_id;
    if (!companyId) {
        throw new Error('MOLONI_COMPANY_ID is required.');
    }

    if (!SANDBOX && t.expires_at && Date.now() >= t.expires_at) {
        const newToken = await refreshLive(t.refresh_token!);
        return { token: newToken, company_id: companyId };
    }
    return { token: t.access_token, company_id: companyId };
}

// --- Moloni API Wrappers (Replaces moloniGet/moloniPostJson) ---

function ep(url: string) { return url.endsWith('/') ? url : url + '/'; }

async function moloniGet(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    const { token: access_token, company_id } = await getAccessToken();
    const base = { access_token, company_id };
    
    const allParams = { ...base, ...params };
    const q = new URLSearchParams(allParams).toString();
    const url = `${API_BASE}${ep(endpoint)}?${q}`;
    
    const r = await fetch(url);
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('GET fail:', url, r.status, t);
        throw new Error(`${endpoint} GET ${r.status} :: ${t}`);
    }
    return r.json();
}

async function moloniPostJson(endpoint: string, payload: Record<string, any> = {}): Promise<any> {
    const { token: access_token, company_id } = await getAccessToken();
    const base = { access_token, company_id };
    const q = new URLSearchParams(base).toString();
    const url = `${API_BASE}${ep(endpoint)}?${q}`;

    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('POST fail:', url, r.status, t);
        throw new Error(`${endpoint} POST ${r.status} :: ${t}`);
    }
    return r.json();
}

// --- Core Business Logic (Adapted from server.js) ---

async function ensureCustomer(input: MoloniCustomer): Promise<number> {
    if (input?.customer_id) return input.customer_id;

    const { vat, email } = input || {};

    // 1. Search by VAT
    if (vat && vat !== '999999990') {
        try {
            const c = await moloniGet('/customers/getByVat', { vat });
            if (c?.customer_id) return c.customer_id;
        } catch (_) { /* ignore Moloni error on search miss */ }
    }

    // 2. Search by Email (if VAT fails or is not provided)
    if (email) {
        try {
            const list = await moloniGet(EP.customersSearch, { search: email, qty: 50, offset: 0 });
            const hit = (list || []).find(c => (c.email || '').toLowerCase() === String(email).toLowerCase());
            if (hit?.customer_id) return hit.customer_id;
        } catch (_) { /* ignore Moloni error on search miss */ }
    }
    
    // 3. Create new customer
    const created = await moloniPostJson('/customers/insert', {
        name: input?.name || 'Consumidor Final',
        vat: input?.vat || '999999990',
        email: input?.email || '',
        language_id: 1, country_id: 1, // Default to Portugal
    });

    return created?.customer_id ?? created?.id ?? created;
}

/**
 * Uploads PDF content from Moloni response to Supabase Storage.
 * @param kind 'invoice' or 'invoice_receipt'
 * @param numberOrId The document number or Moloni ID
 * @param res Moloni API response object with 'pdf' (base64) or 'url' fields
 * @returns The public URL of the uploaded PDF
 */
async function uploadPdfToStorage(kind: string, numberOrId: string | number, res: any): Promise<string> {
    const filePath = `${kind}/${numberOrId}.pdf`;
    let pdfBuffer: ArrayBuffer;

    if (res?.pdf) {
        // PDF is Base64 encoded (LIVE mode)
        const base64String = res.pdf.replace(/-/g, '+').replace(/_/g, '/'); // Handle Moloni's custom Base64 (if any)
        pdfBuffer = Uint8Array.from(atob(base64String), c => c.charCodeAt(0)).buffer;
    } else if (res?.url) {
        // PDF is a direct URL (SANDBOX mode)
        const r = await fetch(res.url);
        if (!r.ok) throw new Error(`Download PDF failed with status ${r.status}`);
        pdfBuffer = await r.arrayBuffer();
    } else {
        throw new Error('Moloni response did not contain pdf (base64) or url.');
    }

    const { data, error } = await supabase.storage
        .from('moloni-invoices') // Use the storage bucket created in Step 1
        .upload(filePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
        });

    if (error) {
        console.error('Supabase Storage upload error:', error);
        throw new Error(`Failed to upload PDF to storage: ${error.message}`);
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
        .from('moloni-invoices')
        .getPublicUrl(data.path);

    return urlData.publicUrl;
}

/**
 * Creates an Invoice-Receipt document in Moloni.
 * @param payload The document details.
 * @returns Object with Moloni document ID and PDF URL.
 */
export async function createInvoiceReceipt(payload: MoloniDocumentPayload): Promise<{ moloni_document_id: number, invoice_pdf_url: string }> {
    const { products, customer } = payload;
    const date = payload.date || new Date().toISOString().slice(0, 10);
    const document_set_id = Number(Deno.env.get('MOLONI_INVOICE_RECEIPT_SET_ID'));
    const invoice_set_id = Number(Deno.env.get('MOLONI_INVOICE_SET_ID'));
    const useDirect = Deno.env.get('USE_DIRECT_INVOICE_RECEIPT') === 'true';

    const customer_id = await ensureCustomer(customer);
    
    // Prepare lines (handle tax_id fallback if needed)
    const lines = products.map(p => ({
        product_id: p.product_id,
        qty: Number(p.qty ?? 1),
        price: Number(p.unit_price ?? p.price ?? 0),
        tax_id: Number(p.tax_id ?? MOLONI_TAX_ID_DEFAULT),
    }));

    let document_id: number;
    let number: string | number;

    if (useDirect) {
        // Direct Invoice-Receipt insertion (Single API call)
        const ir = await moloniPostJson(EP.invRecInsert, { date, document_set_id, customer_id, products: lines, notes: payload.notes, your_reference: payload.your_reference });
        document_id = ir?.document_id ?? ir?.id ?? ir;
        number = ir?.number || `ir-${document_id}`;
    } else {
        // Invoice + Payment flow
        const inv = await moloniPostJson(EP.invInsert, { 
            date, document_set_id: invoice_set_id, customer_id, products: lines, notes: payload.notes, your_reference: payload.your_reference 
        });
        document_id = inv?.document_id ?? inv?.id ?? inv;
        
        const gross = lines.reduce((s, p) => s + (Number(p.qty) * Number(p.price || 0)), 0);
        await moloniPostJson(EP.invPayment, { 
            document_id, 
            payment_method_id: MOLONI_PM_ID, 
            date, 
            value: gross 
        });
        
        // Fetch document number (required for PDF filename/storage)
        const info = await moloniGet(EP.invGetOne, { document_id });
        number = info?.number || `inv-${document_id}`;
    }

    // Get PDF (uses the appropriate endpoint based on SANDBOX/LIVE)
    const pdfRes = await moloniGet(useDirect ? EP.invRecGetPDF : EP.invGetPDF, { document_id });
    
    // Upload PDF to Supabase Storage
    const pdfUrl = await uploadPdfToStorage(useDirect ? 'invoice_receipt' : 'invoice', number, pdfRes);

    return {
        moloni_document_id: document_id,
        invoice_pdf_url: pdfUrl,
    };
}