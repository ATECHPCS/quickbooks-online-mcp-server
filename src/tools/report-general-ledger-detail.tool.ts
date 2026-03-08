import { reportGeneralLedgerDetail } from "../handlers/report-general-ledger-detail.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "report_general_ledger_detail";
const toolDescription =
  "Run a General Ledger Detail report from QuickBooks Online. " +
  "Returns transactions grouped by account with debits, credits, and running balances. " +
  "Use the optional 'account' filter to narrow results to a specific account (name or ID). " +
  "For full GL dumps, use narrow date ranges to avoid very large responses.";

const toolSchema = z.object({
  start_date: z.string().describe("Start date in YYYY-MM-DD format"),
  end_date: z.string().describe("End date in YYYY-MM-DD format"),
  accounting_method: z
    .enum(["Accrual", "Cash"])
    .optional()
    .describe("Accounting method (default: Accrual)"),
  account: z
    .string()
    .optional()
    .describe("Filter by account name or ID. Recommended for large ledgers."),
});

const toolHandler = async ({ params }: any) => {
  const { start_date, end_date, accounting_method, account } = params;

  const response = await reportGeneralLedgerDetail({
    start_date,
    end_date,
    accounting_method,
    account,
  });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error running GL Detail report: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const ReportGeneralLedgerDetailTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
