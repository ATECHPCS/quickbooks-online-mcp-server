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

export interface ProfitAndLossParams {
  start_date: string;
  end_date: string;
  accounting_method?: "Accrual" | "Cash";
  compare_to?: "PreviousPeriod" | "PreviousYear" | "YTDPreviousYear";
  compare_start_date?: string;
  compare_end_date?: string;
}

export interface ParsedProfitAndLoss {
  metadata: ReportMetadata;
  summary: {
    total_income: number;
    total_expenses: number;
    net_income: number;
  };
  income: SectionSummary[];
  expenses: SectionSummary[];
  comparison?: {
    prior_period: { start_date: string; end_date: string };
    summary: {
      total_income: number;
      total_expenses: number;
      net_income: number;
    };
    income: SectionSummary[];
    expenses: SectionSummary[];
  };
}

// ---------------------------------------------------------------------------
// Comparison date helpers
// ---------------------------------------------------------------------------

function computeComparisonDates(
  startDate: string,
  endDate: string,
  compareType: string,
  compareStartDate?: string,
  compareEndDate?: string,
): { start_date: string; end_date: string } {
  if (compareStartDate && compareEndDate) {
    return { start_date: compareStartDate, end_date: compareEndDate };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  switch (compareType) {
    case "PreviousYear":
      return {
        start_date: shiftYear(startDate, -1),
        end_date: shiftYear(endDate, -1),
      };
    case "YTDPreviousYear": {
      const priorYear = end.getFullYear() - 1;
      return {
        start_date: `${priorYear}-01-01`,
        end_date: shiftYear(endDate, -1),
      };
    }
    case "PreviousPeriod":
    default: {
      const periodMs = end.getTime() - start.getTime() + 86400000; // +1 day inclusive
      const priorEnd = new Date(start.getTime() - 86400000);
      const priorStart = new Date(priorEnd.getTime() - periodMs + 86400000);
      return {
        start_date: toDateStr(priorStart),
        end_date: toDateStr(priorEnd),
      };
    }
  }
}

function shiftYear(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + delta);
  return toDateStr(d);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Single-period report fetcher
// ---------------------------------------------------------------------------

function fetchPnL(
  quickbooks: any,
  options: Record<string, string>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    (quickbooks as any).reportProfitAndLoss(options, (err: any, report: any) => {
      if (err) reject(err);
      else resolve(report);
    });
  });
}

function parsePnL(report: any): {
  metadata: ReportMetadata;
  income: SectionSummary[];
  expenses: SectionSummary[];
  total_income: number;
  total_expenses: number;
  net_income: number;
} {
  const metadata = extractReportMetadata(report);
  const columnMap = getColumnIndices(report);

  // Determine amount column index — usually "Amount" or the first non-label column
  let amountIdx = columnMap.get("Amount") ?? columnMap.get("Total") ?? 1;

  const topRows = report.Rows?.Row || [];
  let income: SectionSummary[] = [];
  let expenses: SectionSummary[] = [];
  let total_income = 0;
  let total_expenses = 0;
  let net_income = 0;

  for (const row of topRows) {
    if (row.type === "Section") {
      const sectionName =
        row.Header?.ColData?.[0]?.value || row.group || "";

      const innerRows = row.Rows?.Row || [];
      const subs = extractSectionSummaries(innerRows, amountIdx);

      if (/income/i.test(sectionName) && !/net\s+income/i.test(sectionName)) {
        income = subs;
        // Section summary for total
        if (row.Summary?.ColData) {
          total_income = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
        }
      } else if (/expense/i.test(sectionName) || /cost of goods/i.test(sectionName)) {
        expenses = subs;
        if (row.Summary?.ColData) {
          total_expenses = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
        }
      } else if (/net\s+(income|earnings|profit)/i.test(sectionName)) {
        if (row.Summary?.ColData) {
          net_income = parseFloat(row.Summary.ColData[amountIdx]?.value || "0");
        }
      }
    }
    // Net Income may also appear as a standalone Data row at the top level
    if (row.type === "Data" || (!row.type && row.ColData)) {
      const label = row.ColData?.[0]?.value || "";
      if (/net\s+(income|earnings|profit)/i.test(label)) {
        net_income = parseFloat(row.ColData?.[amountIdx]?.value || "0");
      }
    }
  }

  // If net_income was not found, calculate it
  if (net_income === 0 && (total_income !== 0 || total_expenses !== 0)) {
    net_income = total_income - total_expenses;
  }

  return { metadata, income, expenses, total_income, total_expenses, net_income };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function reportProfitAndLoss(
  params: ProfitAndLossParams,
): Promise<ToolResponse<ParsedProfitAndLoss>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    const options: Record<string, string> = {
      start_date: params.start_date,
      end_date: params.end_date,
      accounting_method: params.accounting_method || "Accrual",
    };

    const report = await fetchPnL(quickbooks, options);
    const current = parsePnL(report);

    const result: ParsedProfitAndLoss = {
      metadata: current.metadata,
      summary: {
        total_income: current.total_income,
        total_expenses: current.total_expenses,
        net_income: current.net_income,
      },
      income: current.income,
      expenses: current.expenses,
    };

    // Comparison period (two-call strategy)
    if (params.compare_to) {
      const compDates = computeComparisonDates(
        params.start_date,
        params.end_date,
        params.compare_to,
        params.compare_start_date,
        params.compare_end_date,
      );

      const compOptions: Record<string, string> = {
        start_date: compDates.start_date,
        end_date: compDates.end_date,
        accounting_method: params.accounting_method || "Accrual",
      };

      const compReport = await fetchPnL(quickbooks, compOptions);
      const prior = parsePnL(compReport);

      result.comparison = {
        prior_period: compDates,
        summary: {
          total_income: prior.total_income,
          total_expenses: prior.total_expenses,
          net_income: prior.net_income,
        },
        income: prior.income,
        expenses: prior.expenses,
      };
    }

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
