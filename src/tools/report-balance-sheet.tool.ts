import { reportBalanceSheet } from "../handlers/report-balance-sheet.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "report_balance_sheet";
const toolDescription =
  "Run a Balance Sheet report from QuickBooks Online. " +
  "Returns a point-in-time snapshot of assets, liabilities, and equity.";

const toolSchema = z.object({
  as_of_date: z.string().describe("Point-in-time date in YYYY-MM-DD format"),
  accounting_method: z
    .enum(["Accrual", "Cash"])
    .optional()
    .describe("Accounting method (default: Accrual)"),
});

const toolHandler = async ({ params }: any) => {
  const { as_of_date, accounting_method } = params;

  const response = await reportBalanceSheet({ as_of_date, accounting_method });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error running Balance Sheet report: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const ReportBalanceSheetTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
