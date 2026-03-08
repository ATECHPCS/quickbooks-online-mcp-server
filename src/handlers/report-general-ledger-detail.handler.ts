import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  extractReportMetadata,
  getColumnIndices,
  extractDataRows,
  ReportMetadata,
} from "../helpers/parse-report-rows.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneralLedgerDetailParams {
  start_date: string;
  end_date: string;
  accounting_method?: "Accrual" | "Cash";
  account?: string;
}

export interface GLTransaction {
  date: string;
  transaction_type: string;
  num: string;
  name: string;
  memo: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface GLAccount {
  account_name: string;
  beginning_balance: number;
  ending_balance: number;
  transactions: GLTransaction[];
}

export interface ParsedGeneralLedger {
  metadata: ReportMetadata & { account_filter?: string };
  accounts: GLAccount[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseGLAmount(value: string | undefined): number {
  return parseFloat(value || "0");
}

function parseAccountSection(
  row: any,
  columnMap: Map<string, number>,
): GLAccount | null {
  if (row.type !== "Section") return null;

  const account_name =
    row.Header?.ColData?.[0]?.value || row.group || "Unknown Account";

  // Extract transactions from inner data rows
  const innerRows = row.Rows?.Row || [];
  const dataRows = extractDataRows(innerRows, columnMap);

  const transactions: GLTransaction[] = dataRows.map((dr) => ({
    date: dr["Date"] || dr["Trans Date"] || "",
    transaction_type: dr["Transaction Type"] || dr["Txn Type"] || "",
    num: dr["Num"] || dr["No."] || "",
    name: dr["Name"] || "",
    memo: dr["Memo/Description"] || dr["Memo"] || "",
    debit: parseGLAmount(dr["Debit"] || dr["Amount"]),
    credit: parseGLAmount(dr["Credit"]),
    balance: parseGLAmount(dr["Balance"]),
  }));

  // Beginning / ending balance from Summary or first/last data rows
  let beginning_balance = 0;
  let ending_balance = 0;

  if (row.Summary?.ColData) {
    // Summary typically has the ending balance
    const balIdx = columnMap.get("Balance") ?? columnMap.get("Amount") ?? 1;
    ending_balance = parseGLAmount(row.Summary.ColData[balIdx]?.value);
  }

  // Check for Beginning Balance row in inner rows
  for (const inner of innerRows) {
    if (inner.ColData) {
      const label = inner.ColData[0]?.value || "";
      if (/beginning\s+balance/i.test(label)) {
        const balIdx = columnMap.get("Balance") ?? columnMap.get("Amount") ?? 1;
        beginning_balance = parseGLAmount(inner.ColData[balIdx]?.value);
      }
    }
  }

  return { account_name, beginning_balance, ending_balance, transactions };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function reportGeneralLedgerDetail(
  params: GeneralLedgerDetailParams,
): Promise<ToolResponse<ParsedGeneralLedger>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    const options: Record<string, string> = {
      start_date: params.start_date,
      end_date: params.end_date,
      accounting_method: params.accounting_method || "Accrual",
    };

    if (params.account) {
      options.account = params.account;
    }

    const report = await new Promise<any>((resolve, reject) => {
      (quickbooks as any).reportGeneralLedgerDetail(
        options,
        (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        },
      );
    });

    const metadata = extractReportMetadata(report);
    const columnMap = getColumnIndices(report);
    const topRows = report.Rows?.Row || [];

    const accounts: GLAccount[] = [];
    for (const row of topRows) {
      const account = parseAccountSection(row, columnMap);
      if (account) {
        accounts.push(account);
      }
    }

    const result: ParsedGeneralLedger = {
      metadata: {
        ...metadata,
        ...(params.account ? { account_filter: params.account } : {}),
      },
      accounts,
    };

    return { result, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
