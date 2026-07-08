import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Florida sales tax liability engine.
 *
 * Computes DR-15 inputs from actual sales transactions (Invoices, Sales
 * Receipts, Credit Memos, Refund Receipts) in a date range, reading QBO's
 * per-transaction TxnTaxDetail lines. With Automated Sales Tax enabled
 * (this company: PartnerTaxEnabled=true), each transaction carries a
 * per-rate breakdown — Florida State 6% vs. county discretionary surtax —
 * which we aggregate rather than recompute.
 *
 * All money math is done in integer cents to avoid float drift.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalesTaxLiabilityParams {
  start_date: string;
  end_date: string;
}

export type RateKind =
  | "state" // Florida State 6%
  | "county_surtax" // county discretionary surtax (Pinellas 1%, etc.)
  | "combined" // legacy single rate bundling state+county (e.g. 7% "FLORIDA IN STATE")
  | "exempt" // 0% rates (OUT OF STATE / EXEMPT, NO TAX SALES)
  | "other"; // anything unrecognized — always flagged

export interface RateBreakdown {
  rate_id: string;
  rate_name: string;
  rate_percent: number;
  kind: RateKind;
  taxable_amount: number;
  tax_collected: number;
}

export interface TxnFlag {
  severity: "warning" | "info";
  txn_type: string;
  txn_id: string;
  doc_number: string;
  txn_date: string;
  issue: string;
}

export interface SalesTaxLiability {
  start_date: string;
  end_date: string;
  transaction_counts: Record<string, number>;
  /** Gross sales excluding tax (taxable + exempt), net of credit memos/refunds */
  gross_sales: number;
  exempt_sales: number;
  taxable_sales: number;
  total_tax_collected: number;
  state_tax_collected: number;
  county_surtax_collected: number;
  by_rate: RateBreakdown[];
  flags: TxnFlag[];
}

// ---------------------------------------------------------------------------
// Cents helpers
// ---------------------------------------------------------------------------

const toCents = (x: any): number => Math.round(Number(x ?? 0) * 100);
const fromCents = (c: number): number => Math.round(c) / 100;

// ---------------------------------------------------------------------------
// Rate classification
// ---------------------------------------------------------------------------

function classifyRate(name: string, percent: number): RateKind {
  if (percent === 0) return "exempt";
  if (/county/i.test(name)) return "county_surtax";
  if (percent === 6 || /florida state|florida dept/i.test(name)) return "state";
  // Legacy combined rates bundle state + surtax into one line (e.g. 7%)
  if (percent > 6) return "combined";
  return "other";
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface EntitySpec {
  entity: string;
  finder: string;
  sign: 1 | -1;
}

const SALES_ENTITIES: EntitySpec[] = [
  { entity: "Invoice", finder: "findInvoices", sign: 1 },
  { entity: "SalesReceipt", finder: "findSalesReceipts", sign: 1 },
  { entity: "CreditMemo", finder: "findCreditMemos", sign: -1 },
  { entity: "RefundReceipt", finder: "findRefundReceipts", sign: -1 },
];

/** Surtax applies only to the first $5,000 of a single item of tangible
 *  personal property; QBO AST handles the cap, but we surface big-ticket
 *  lines so the filer can eyeball them. */
const SURTAX_CAP_CENTS = 5000 * 100;

export async function computeSalesTaxLiability(
  params: SalesTaxLiabilityParams,
): Promise<ToolResponse<SalesTaxLiability>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    // Rate metadata for classification
    const ratesRaw = await new Promise<any[]>((resolve, reject) => {
      (quickbooks as any).findTaxRates({ fetchAll: true }, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(data?.QueryResponse?.TaxRate || []);
      });
    });
    const rateMeta = new Map<string, { name: string; percent: number }>(
      ratesRaw.map((r: any) => [
        String(r.Id),
        { name: r.Name || `rate ${r.Id}`, percent: Number(r.RateValue ?? 0) },
      ]),
    );

    const criteria = [
      { field: "TxnDate", value: params.start_date, operator: ">=" },
      { field: "TxnDate", value: params.end_date, operator: "<=" },
      { field: "fetchAll", value: true },
    ];

    const fetchEntity = (spec: EntitySpec) =>
      new Promise<any[]>((resolve, reject) => {
        (quickbooks as any)[spec.finder](criteria, (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data?.QueryResponse?.[spec.entity] || []);
        });
      });

    const allTxns = await Promise.all(SALES_ENTITIES.map(fetchEntity));

    // Accumulators (cents)
    let grossCents = 0;
    let taxableCents = 0;
    let stateTaxCents = 0;
    let countyTaxCents = 0;
    let otherTaxCents = 0;
    const byRate = new Map<
      string,
      { name: string; percent: number; kind: RateKind; taxable: number; tax: number }
    >();
    const flags: TxnFlag[] = [];
    const counts: Record<string, number> = {};
    // Aggregated (once per rate, not per transaction) legacy-rate usage
    const combinedRateTxns = new Map<string, number>();

    for (let i = 0; i < SALES_ENTITIES.length; i++) {
      const spec = SALES_ENTITIES[i];
      const txns = allTxns[i];
      counts[spec.entity] = txns.length;

      for (const txn of txns) {
        const sign = spec.sign;
        const flagBase = {
          txn_type: spec.entity,
          txn_id: String(txn.Id ?? ""),
          doc_number: String(txn.DocNumber ?? ""),
          txn_date: String(txn.TxnDate ?? ""),
        };

        // --- Line items: gross sales (excluding tax) ------------------------
        // Taxable vs exempt is NOT derived from line-level TAX/NON codes:
        // those only mark "taxable in principle" — a TAX line under an
        // out-of-state 0% transaction code collects nothing. The authoritative
        // taxable base comes from TxnTaxDetail's NetAmountTaxable below.
        let txnGrossCents = 0;
        for (const line of txn.Line || []) {
          const detailType = line.DetailType;

          if (detailType === "SalesItemLineDetail") {
            const amountCents = toCents(line.Amount) * sign;
            txnGrossCents += amountCents;
            if (Math.abs(amountCents) > SURTAX_CAP_CENTS) {
              flags.push({
                ...flagBase,
                severity: "info",
                issue: `Single line over $5,000 (${fromCents(amountCents).toFixed(2)}): county surtax caps at the first $5,000 per item of tangible personal property — verify QBO applied the cap.`,
              });
            }
          } else if (detailType === "GroupLineDetail") {
            for (const gl of line.GroupLineDetail?.Line || []) {
              txnGrossCents += toCents(gl.Amount) * sign;
            }
          } else if (detailType === "DiscountLineDetail") {
            // Discounts reduce gross; QBO reports them as positive amounts
            txnGrossCents -= toCents(line.Amount) * sign;
          }
          // SubTotalLineDetail, DescriptionOnly, etc.: skip
        }
        grossCents += txnGrossCents;

        if (txn.TxnTaxDetail?.TxnTaxCodeRef?.value === "CustomSalesTax") {
          flags.push({
            ...flagBase,
            severity: "warning",
            issue: "Transaction uses CustomSalesTax code — its rate composition is opaque; verify state vs. surtax split manually.",
          });
        }

        // --- Tax detail: per-rate collected tax + taxable base -------------
        const txnTaxDetail = txn.TxnTaxDetail || {};
        const totalTaxCents = toCents(txnTaxDetail.TotalTax) * sign;
        let sumRateTaxCents = 0;
        // DR-15 taxable base for this txn: the largest |NetAmountTaxable|
        // among rates > 0%. With stacked AST rates (state + county) the same
        // base appears on both lines, so summing would double-count; the
        // state line's base is the full DR-15 line A-3 amount (the county
        // base can be smaller due to the $5,000 surtax cap).
        let txnTaxableBaseCents = 0;

        for (const taxLine of txnTaxDetail.TaxLine || []) {
          const detail = taxLine.TaxLineDetail || {};
          const rateId = String(detail.TaxRateRef?.value ?? "");
          const meta = rateMeta.get(rateId) || {
            name: detail.TaxRateRef?.name || `rate ${rateId || "?"}`,
            percent: Number(detail.TaxPercent ?? 0),
          };
          const kind = classifyRate(meta.name, meta.percent);
          const lineTaxCents = toCents(taxLine.Amount) * sign;
          const lineTaxableCents = toCents(detail.NetAmountTaxable) * sign;
          sumRateTaxCents += lineTaxCents;

          if (meta.percent > 0 && Math.abs(lineTaxableCents) > Math.abs(txnTaxableBaseCents)) {
            txnTaxableBaseCents = lineTaxableCents;
          }

          const key = rateId || meta.name;
          const acc =
            byRate.get(key) ||
            { name: meta.name, percent: meta.percent, kind, taxable: 0, tax: 0 };
          acc.taxable += lineTaxableCents;
          acc.tax += lineTaxCents;
          byRate.set(key, acc);

          if (kind === "state") stateTaxCents += lineTaxCents;
          else if (kind === "county_surtax") countyTaxCents += lineTaxCents;
          else if (kind === "combined") {
            // Split arithmetically: state = taxable * 6%, remainder = surtax
            const statePart = Math.round(lineTaxableCents * 0.06);
            stateTaxCents += statePart;
            countyTaxCents += lineTaxCents - statePart;
            const rateKey = `${meta.name} (${meta.percent}%)`;
            combinedRateTxns.set(rateKey, (combinedRateTxns.get(rateKey) || 0) + 1);
          } else if (kind === "other" && lineTaxCents !== 0) {
            otherTaxCents += lineTaxCents;
            flags.push({
              ...flagBase,
              severity: "warning",
              issue: `Unrecognized tax rate "${meta.name}" (${meta.percent}%) collected ${fromCents(lineTaxCents).toFixed(2)} — not classified as FL state or county surtax.`,
            });
          }
        }

        taxableCents += txnTaxableBaseCents;

        // --- Cross-checks ---------------------------------------------------
        if (Math.abs(sumRateTaxCents - totalTaxCents) > 1) {
          flags.push({
            ...flagBase,
            severity: "warning",
            issue: `Tax lines sum to ${fromCents(sumRateTaxCents).toFixed(2)} but TotalTax is ${fromCents(totalTaxCents).toFixed(2)}.`,
          });
        }
        if (txnGrossCents !== 0 && (txnTaxDetail.TaxLine || []).length === 0) {
          flags.push({
            ...flagBase,
            severity: "info",
            issue: `No tax detail on transaction (${fromCents(txnGrossCents).toFixed(2)} gross) — confirm it is genuinely exempt/out-of-scope.`,
          });
        }
      }
    }

    // One aggregate warning per legacy combined rate (not per transaction)
    for (const [rateKey, n] of combinedRateTxns) {
      flags.push({
        severity: "warning",
        txn_type: "*",
        txn_id: "",
        doc_number: "",
        txn_date: "",
        issue: `${n} transaction(s) used legacy combined rate ${rateKey} — state/surtax split computed arithmetically (6% state, remainder surtax). Consider switching sales to county-specific AST tax codes (e.g. FL-Pinellas).`,
      });
    }

    const totalTaxCents = stateTaxCents + countyTaxCents + otherTaxCents;

    const byRateOut: RateBreakdown[] = Array.from(byRate.entries())
      .map(([id, r]) => ({
        rate_id: id,
        rate_name: r.name,
        rate_percent: r.percent,
        kind: r.kind,
        taxable_amount: fromCents(r.taxable),
        tax_collected: fromCents(r.tax),
      }))
      .filter((r) => r.taxable_amount !== 0 || r.tax_collected !== 0)
      .sort((a, b) => b.tax_collected - a.tax_collected);

    const result: SalesTaxLiability = {
      start_date: params.start_date,
      end_date: params.end_date,
      transaction_counts: counts,
      gross_sales: fromCents(grossCents),
      exempt_sales: fromCents(grossCents - taxableCents),
      taxable_sales: fromCents(taxableCents),
      total_tax_collected: fromCents(totalTaxCents),
      state_tax_collected: fromCents(stateTaxCents),
      county_surtax_collected: fromCents(countyTaxCents),
      by_rate: byRateOut,
      flags,
    };

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
