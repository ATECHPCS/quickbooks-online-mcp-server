/**
 * Shared utilities for parsing QBO report JSON responses.
 *
 * QBO reports use a recursive Row/ColData structure:
 *   - Section rows contain nested Rows.Row arrays and a Summary row
 *   - Data rows contain ColData arrays with leaf-level values
 *   - Summary rows provide subtotals for their parent Section
 *
 * All amount values come as strings from QBO; we parse them with parseFloat.
 */

// ---------------------------------------------------------------------------
// Types (internal, matching QBO report response shape)
// ---------------------------------------------------------------------------

interface ColDataItem {
  value: string;
  id?: string;
}

interface QBORow {
  type?: "Section" | "Data";
  group?: string;
  Header?: { ColData: ColDataItem[] };
  Rows?: { Row: QBORow[] };
  Summary?: { ColData: ColDataItem[] };
  ColData?: ColDataItem[];
}

interface QBOReportHeader {
  ReportName: string;
  StartPeriod: string;
  EndPeriod: string;
  ReportBasis?: string;
  Currency?: string;
  Time?: string;
  Option?: Array<{ Name: string; Value: string }>;
}

interface QBOReport {
  Header: QBOReportHeader;
  Columns: {
    Column: Array<{ ColTitle: string; ColType: string }>;
  };
  Rows: { Row: QBORow[] };
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

export interface ReportMetadata {
  report_name: string;
  start_date: string;
  end_date: string;
  accounting_basis: string;
  currency: string;
}

/**
 * Extract standard metadata from a QBO report Header.
 */
export function extractReportMetadata(report: QBOReport): ReportMetadata {
  const header = report.Header;
  return {
    report_name: header.ReportName || "",
    start_date: header.StartPeriod || "",
    end_date: header.EndPeriod || "",
    accounting_basis: header.ReportBasis || "Accrual",
    currency: header.Currency || "USD",
  };
}

// ---------------------------------------------------------------------------
// Column index mapping
// ---------------------------------------------------------------------------

/**
 * Build a map of ColTitle -> column index from the report's Columns section.
 * This is critical because column indices shift when comparison periods are
 * enabled. Never hardcode indices.
 */
export function getColumnIndices(report: QBOReport): Map<string, number> {
  const map = new Map<string, number>();
  const columns = report.Columns?.Column || [];
  for (let i = 0; i < columns.length; i++) {
    map.set(columns[i].ColTitle, i);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Section summary extraction (P&L, Balance Sheet, Tax Summary)
// ---------------------------------------------------------------------------

export interface SectionSummary {
  category: string;
  amount: number;
}

/**
 * Walk a Row array and extract one summary per top-level Section.
 *
 * For each Section row that has a Summary, we extract:
 *   - category: from Summary.ColData[0].value, or Header.ColData[0].value,
 *     or the row's group field
 *   - amount: from Summary.ColData[amountColumnIndex].value parsed as float
 *
 * Only Summary rows are used to avoid double-counting sub-categories.
 */
export function extractSectionSummaries(
  rows: QBORow[],
  amountColumnIndex: number = 1,
): SectionSummary[] {
  const results: SectionSummary[] = [];

  for (const row of rows) {
    if (row.type === "Section" && row.Summary) {
      const category =
        row.Summary.ColData?.[0]?.value ||
        row.Header?.ColData?.[0]?.value ||
        row.group ||
        "Unknown";
      const rawAmount = row.Summary.ColData?.[amountColumnIndex]?.value;
      const amount = parseFloat(rawAmount || "0");
      results.push({ category, amount });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Data row extraction (General Ledger detail)
// ---------------------------------------------------------------------------

/**
 * Recursively walk rows and extract Data rows (leaf entries) as objects
 * with fields mapped from column titles.
 *
 * Section rows are traversed recursively; their nested Rows.Row may contain
 * more Data rows and sub-Sections.
 */
export function extractDataRows(
  rows: QBORow[],
  columnMap: Map<string, number>,
): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  const titles = Array.from(columnMap.entries());

  for (const row of rows) {
    if (row.ColData && (!row.type || row.type === "Data")) {
      // Leaf data row
      const obj: Record<string, string> = {};
      for (const [title, idx] of titles) {
        const key = title || `col_${idx}`;
        obj[key] = row.ColData[idx]?.value ?? "";
      }
      results.push(obj);
    }

    // Recurse into Section sub-rows
    if (row.type === "Section" && row.Rows?.Row) {
      results.push(...extractDataRows(row.Rows.Row, columnMap));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Comparison summary extraction (period-over-period)
// ---------------------------------------------------------------------------

export interface ComparisonSummary {
  category: string;
  current_amount: number;
  comparison_amount: number;
  delta: number;
  delta_percent: number | null;
}

/**
 * Same as extractSectionSummaries but extracts both current and comparison
 * amounts from multi-column reports.
 *
 * Computes delta (current - comparison) and delta_percent
 * ((delta / |comparison|) * 100, null if comparison is 0).
 */
export function extractComparisonSummaries(
  rows: QBORow[],
  currentColIndex: number,
  priorColIndex: number,
): ComparisonSummary[] {
  const results: ComparisonSummary[] = [];

  for (const row of rows) {
    if (row.type === "Section" && row.Summary) {
      const category =
        row.Summary.ColData?.[0]?.value ||
        row.Header?.ColData?.[0]?.value ||
        row.group ||
        "Unknown";
      const current = parseFloat(
        row.Summary.ColData?.[currentColIndex]?.value || "0",
      );
      const comparison = parseFloat(
        row.Summary.ColData?.[priorColIndex]?.value || "0",
      );
      const delta = current - comparison;
      const delta_percent =
        comparison !== 0
          ? (delta / Math.abs(comparison)) * 100
          : null;

      results.push({
        category,
        current_amount: current,
        comparison_amount: comparison,
        delta,
        delta_percent:
          delta_percent !== null
            ? Math.round(delta_percent * 100) / 100
            : null,
      });
    }
  }

  return results;
}
