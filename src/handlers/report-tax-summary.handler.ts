import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  extractReportMetadata,
  getColumnIndices,
  extractSectionSummaries,
  ReportMetadata,
} from "../helpers/parse-report-rows.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxSummaryParams {
  start_date: string;
  end_date: string;
}

export interface TaxCategory {
  name: string;
  taxable_amount: number;
  tax_amount: number;
  non_taxable_amount: number;
}

export interface ParsedTaxSummary {
  metadata: ReportMetadata;
  tax_collected: number;
  tax_paid: number;
  net_tax: number;
  categories: TaxCategory[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTaxSections(
  topRows: any[],
  amountIdx: number,
): { categories: TaxCategory[]; tax_collected: number; tax_paid: number } {
  const categories: TaxCategory[] = [];
  let tax_collected = 0;
  let tax_paid = 0;

  for (const row of topRows) {
    if (row.type !== "Section") continue;

    const sectionName =
      row.Header?.ColData?.[0]?.value || row.group || "Unknown";
    const innerRows = row.Rows?.Row || [];

    // Extract sub-section summaries as categories
    const subs = extractSectionSummaries(innerRows, amountIdx);

    // Parse each sub-section for taxable/non-taxable/tax breakdowns
    // QBO Tax Summary typically has sections like "Taxable Sales", "Non-Taxable Sales", etc.
    let taxable_amount = 0;
    let non_taxable_amount = 0;
    let tax_amount = 0;

    for (const sub of subs) {
      const label = sub.category.toLowerCase();
      if (/tax\s+(amount|collected|on sales|on purchases)/i.test(label) || /sales tax/i.test(label)) {
        tax_amount += sub.amount;
      } else if (/non[-\s]?taxable/i.test(label)) {
        non_taxable_amount += sub.amount;
      } else if (/taxable/i.test(label)) {
        taxable_amount += sub.amount;
      }
    }

    // Section summary total
    if (row.Summary?.ColData) {
      const sectionTotal = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
      // Determine if this is sales (collected) or purchases (paid) tax
      if (/sales|collected|revenue/i.test(sectionName)) {
        tax_collected += tax_amount || sectionTotal;
      } else if (/purchase|paid|expense/i.test(sectionName)) {
        tax_paid += Math.abs(tax_amount || sectionTotal);
      }
    }

    categories.push({
      name: sectionName,
      taxable_amount,
      tax_amount,
      non_taxable_amount,
    });
  }

  return { categories, tax_collected, tax_paid };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function reportTaxSummary(
  params: TaxSummaryParams,
): Promise<ToolResponse<ParsedTaxSummary>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    const options: Record<string, string> = {
      start_date: params.start_date,
      end_date: params.end_date,
    };

    const report = await new Promise<any>((resolve, reject) => {
      (quickbooks as any).reportTaxSummary(options, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const metadata = extractReportMetadata(report);
    const columnMap = getColumnIndices(report);
    const amountIdx = columnMap.get("Amount") ?? columnMap.get("Total") ?? 1;

    const topRows = report.Rows?.Row || [];
    const { categories, tax_collected, tax_paid } = parseTaxSections(topRows, amountIdx);

    const result: ParsedTaxSummary = {
      metadata,
      tax_collected,
      tax_paid,
      net_tax: tax_collected - tax_paid,
      categories,
    };

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
