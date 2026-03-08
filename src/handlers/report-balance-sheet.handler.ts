import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  extractReportMetadata,
  getColumnIndices,
  extractSectionSummaries,
  ReportMetadata,
  SectionSummary,
} from "../helpers/parse-report-rows.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BalanceSheetParams {
  as_of_date: string;
  accounting_method?: "Accrual" | "Cash";
}

export interface ParsedBalanceSheet {
  metadata: ReportMetadata & { as_of_date: string };
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  assets: SectionSummary[];
  liabilities: SectionSummary[];
  equity: SectionSummary[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function reportBalanceSheet(
  params: BalanceSheetParams,
): Promise<ToolResponse<ParsedBalanceSheet>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    // QBO Balance Sheet uses start_date/end_date even for point-in-time
    const options: Record<string, string> = {
      start_date: params.as_of_date,
      end_date: params.as_of_date,
      accounting_method: params.accounting_method || "Accrual",
    };

    const report = await new Promise<any>((resolve, reject) => {
      (quickbooks as any).reportBalanceSheet(options, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const metadata = extractReportMetadata(report);
    const columnMap = getColumnIndices(report);
    const amountIdx = columnMap.get("Amount") ?? columnMap.get("Total") ?? 1;

    const topRows = report.Rows?.Row || [];
    let assets: SectionSummary[] = [];
    let liabilities: SectionSummary[] = [];
    let equity: SectionSummary[] = [];
    let total_assets = 0;
    let total_liabilities = 0;
    let total_equity = 0;

    for (const row of topRows) {
      if (row.type === "Section") {
        const sectionName =
          row.Header?.ColData?.[0]?.value || row.group || "";
        const innerRows = row.Rows?.Row || [];
        const subs = extractSectionSummaries(innerRows, amountIdx);

        if (/asset/i.test(sectionName)) {
          assets = subs;
          if (row.Summary?.ColData) {
            total_assets = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
          }
        } else if (/liabilit/i.test(sectionName)) {
          liabilities = subs;
          if (row.Summary?.ColData) {
            total_liabilities = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
          }
        } else if (/equity/i.test(sectionName)) {
          equity = subs;
          if (row.Summary?.ColData) {
            total_equity = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
          }
        }
      }
    }

    const result: ParsedBalanceSheet = {
      metadata: { ...metadata, as_of_date: params.as_of_date },
      total_assets,
      total_liabilities,
      total_equity,
      assets,
      liabilities,
      equity,
    };

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
