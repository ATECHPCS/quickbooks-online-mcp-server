import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  computeSalesTaxLiability,
  SalesTaxLiability,
} from "./sales-tax-liability.handler.js";

/**
 * Florida DR-15 (Sales and Use Tax Return) preparer.
 *
 * Takes a filing period, runs the sales-tax-liability engine over it, and
 * lays the results out as DR-15 line items with due-date and
 * collection-allowance math. This PREPARES the numbers for manual entry on
 * floridarevenue.com — it does not file anything.
 *
 * Assumptions (this company):
 *  - Monthly filing frequency (return due the 1st, late after the 20th of
 *    the following month).
 *  - Sales & services only (DR-15 column A). Taxable purchases/use tax,
 *    commercial rent, and transient rentals are not computed.
 *  - Collection allowance = 2.5% of the first $1,200 of tax due (max $30),
 *    ONLY when e-filed and e-paid on time.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepareDr15Params {
  /** Filing period as YYYY-MM (e.g. "2026-06") */
  period: string;
  /** Will the return be e-filed + e-paid on time? Enables the collection allowance. Default true. */
  efile_on_time?: boolean;
}

export interface Dr15Lines {
  /** Line A-1: gross sales (excluding tax) */
  gross_sales: number;
  /** Line A-2: exempt sales */
  exempt_sales: number;
  /** Line A-3: taxable amount */
  taxable_amount: number;
  /** Line A-4 / Line 5: total tax due (state + surtax) */
  tax_due: number;
  /** Line 11: lawful collection allowance (subtracted) */
  collection_allowance: number;
  /** Line 14: amount due with return (line 10 − line 11) */
  amount_due_with_return: number;
  /** Line 15(d): total discretionary sales surtax collected */
  discretionary_surtax: number;
  /** Informational: the 6% state portion of tax_due */
  state_tax_portion: number;
}

export interface Dr15Result {
  period: string;
  period_start: string;
  period_end: string;
  due_date: string;
  late_after: string;
  efile_on_time: boolean;
  lines: Dr15Lines;
  /** Per-rate breakdown backing the numbers */
  liability: SalesTaxLiability;
  /** Ready-to-type summary matching the DOR portal fields */
  worksheet: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Roll a date forward past Sat/Sun (FL: late-after dates falling on a
 *  weekend or state holiday move to the next business day; we handle
 *  weekends and note holidays as a limitation). */
function nextBusinessDay(year: number, month1to12: number, day: number): string {
  const d = new Date(Date.UTC(year, month1to12 - 1, day));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Money helpers (cents)
// ---------------------------------------------------------------------------

const toCents = (x: number): number => Math.round(x * 100);
const fromCents = (c: number): number => Math.round(c) / 100;
const usd = (x: number): string =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD" });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function prepareDr15(
  params: PrepareDr15Params,
): Promise<ToolResponse<Dr15Result>> {
  try {
    const m = /^(\d{4})-(\d{2})$/.exec(params.period);
    if (!m) {
      return {
        result: null,
        isError: true,
        error: `Invalid period "${params.period}" — expected YYYY-MM (e.g. 2026-06)`,
      };
    }
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) {
      return { result: null, isError: true, error: `Invalid month in period "${params.period}"` };
    }

    const start = `${params.period}-01`;
    const end = `${params.period}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;

    // Filing month = month after the period
    const dueYear = month === 12 ? year + 1 : year;
    const dueMonth = month === 12 ? 1 : month + 1;
    const dueDate = `${dueYear}-${String(dueMonth).padStart(2, "0")}-01`;
    const lateAfter = nextBusinessDay(dueYear, dueMonth, 20);

    const liabilityResp = await computeSalesTaxLiability({
      start_date: start,
      end_date: end,
    });
    if (liabilityResp.isError || !liabilityResp.result) {
      return { result: null, isError: true, error: liabilityResp.error };
    }
    const liability = liabilityResp.result;

    const efile = params.efile_on_time !== false;
    const taxDueCents = toCents(liability.total_tax_collected);

    // Collection allowance: 2.5% of the first $1,200 of tax due, max $30,
    // only for timely e-file + e-pay.
    const allowanceCents = efile
      ? Math.min(3000, Math.round(Math.min(taxDueCents, 120000) * 0.025))
      : 0;

    const amountDueCents = taxDueCents - allowanceCents;

    const lines: Dr15Lines = {
      gross_sales: liability.gross_sales,
      exempt_sales: liability.exempt_sales,
      taxable_amount: liability.taxable_sales,
      tax_due: liability.total_tax_collected,
      collection_allowance: fromCents(allowanceCents),
      amount_due_with_return: fromCents(amountDueCents),
      discretionary_surtax: liability.county_surtax_collected,
      state_tax_portion: liability.state_tax_collected,
    };

    // --- Warnings ----------------------------------------------------------
    const warnings: string[] = [];
    const warningFlags = liability.flags.filter((f) => f.severity === "warning");
    if (warningFlags.length > 0) {
      warnings.push(
        `${warningFlags.length} transaction warning(s) — review liability.flags before filing.`,
      );
    }
    const nonPinellas = liability.by_rate.filter(
      (r) => r.kind === "county_surtax" && !/pinellas/i.test(r.rate_name) && r.tax_collected !== 0,
    );
    if (nonPinellas.length > 0) {
      warnings.push(
        `Surtax collected for counties other than Pinellas (${nonPinellas
          .map((r) => `${r.rate_name}: ${usd(r.tax_collected)}`)
          .join(", ")}) — report on DR-15 line 15(c) (surtax at a rate different than your county's).`,
      );
    }
    const crossCheckCents = toCents(liability.taxable_sales) + toCents(liability.exempt_sales);
    if (Math.abs(crossCheckCents - toCents(liability.gross_sales)) > 1) {
      warnings.push("Gross ≠ taxable + exempt — investigate before filing.");
    }
    warnings.push(
      "Late-after date accounts for weekends but not FL state holidays — double-check floridarevenue.com if the 20th is near a holiday.",
    );
    if (!efile) {
      warnings.push("efile_on_time=false: no collection allowance applied; penalties/interest NOT computed.");
    }

    // --- Worksheet ----------------------------------------------------------
    const surtaxByCounty = liability.by_rate
      .filter((r) => r.kind === "county_surtax" && (r.tax_collected !== 0 || r.taxable_amount !== 0))
      .map((r) => `    ${r.rate_name} (${r.rate_percent}%): taxable ${usd(r.taxable_amount)} → surtax ${usd(r.tax_collected)}`)
      .join("\n");

    const worksheet = [
      `FLORIDA DR-15 WORKSHEET — ${params.period} (${start} … ${end})`,
      `Due: ${dueDate} | LATE AFTER: ${lateAfter}`,
      ``,
      `A. Sales/Services`,
      `   1. Gross Sales .......................... ${usd(lines.gross_sales)}`,
      `   2. Exempt Sales ......................... ${usd(lines.exempt_sales)}`,
      `   3. Taxable Amount ....................... ${usd(lines.taxable_amount)}`,
      `   4. Tax Due (state + surtax) ............. ${usd(lines.tax_due)}`,
      ``,
      ` 5. Total Amount of Tax Due ................ ${usd(lines.tax_due)}`,
      ` 6. Less Lawful Deductions ................. $0.00`,
      ` 7. Total Tax Due .......................... ${usd(lines.tax_due)}`,
      ` 8. Less Est. Tax Paid / DOR Credit Memo ... $0.00`,
      ` 9. Plus Est. Tax Due Current Month ........ $0.00`,
      `10. Amount Due ............................. ${usd(lines.tax_due)}`,
      `11. Less Collection Allowance (2.5%, max $30) ${usd(lines.collection_allowance)}`,
      `12. Plus Penalty ........................... $0.00 (file by ${lateAfter}!)`,
      `13. Plus Interest .......................... $0.00`,
      `14. Amount Due with Return ................. ${usd(lines.amount_due_with_return)}`,
      ``,
      `15(d). Total Discretionary Sales Surtax .... ${usd(lines.discretionary_surtax)}`,
      surtaxByCounty ? `  Surtax by county:\n${surtaxByCounty}` : ``,
      ``,
      `  State 6% portion (info): ${usd(lines.state_tax_portion)}`,
      `  Transactions: ${Object.entries(liability.transaction_counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
      warnings.length ? `\n⚠ WARNINGS:\n${warnings.map((w) => `  - ${w}`).join("\n")}` : ``,
    ]
      .filter((l) => l !== "")
      .join("\n");

    const result: Dr15Result = {
      period: params.period,
      period_start: start,
      period_end: end,
      due_date: dueDate,
      late_after: lateAfter,
      efile_on_time: efile,
      lines,
      liability,
      worksheet,
      warnings,
    };

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
