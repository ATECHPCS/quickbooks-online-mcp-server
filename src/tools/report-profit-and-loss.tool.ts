import { reportProfitAndLoss } from "../handlers/report-profit-and-loss.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "report_profit_and_loss";
const toolDescription =
  "Run a Profit & Loss (Income Statement) report from QuickBooks Online. " +
  "Returns income and expense categories with totals. " +
  "Optionally compare against a prior period or prior year.";

const toolSchema = z.object({
  start_date: z.string().describe("Start date in YYYY-MM-DD format"),
  end_date: z.string().describe("End date in YYYY-MM-DD format"),
  accounting_method: z
    .enum(["Accrual", "Cash"])
    .optional()
    .describe("Accounting method (default: Accrual)"),
  compare_to: z
    .enum(["PreviousPeriod", "PreviousYear", "YTDPreviousYear"])
    .optional()
    .describe("Optional comparison period type"),
  compare_start_date: z
    .string()
    .optional()
    .describe("Custom comparison start date (YYYY-MM-DD). Overrides compare_to date calculation."),
  compare_end_date: z
    .string()
    .optional()
    .describe("Custom comparison end date (YYYY-MM-DD). Overrides compare_to date calculation."),
});

const toolHandler = async ({ params }: any) => {
  const {
    start_date,
    end_date,
    accounting_method,
    compare_to,
    compare_start_date,
    compare_end_date,
  } = params;

  const response = await reportProfitAndLoss({
    start_date,
    end_date,
    accounting_method,
    compare_to,
    compare_start_date,
    compare_end_date,
  });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error running P&L report: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const ReportProfitAndLossTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
