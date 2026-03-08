import { reportTaxSummary } from "../handlers/report-tax-summary.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "report_tax_summary";
const toolDescription =
  "Run a Tax Summary report from QuickBooks Online. " +
  "Returns generic QBO tax categories with taxable amounts, tax collected, and tax paid. " +
  "Use for sales tax reconciliation and filing preparation.";

const toolSchema = z.object({
  start_date: z.string().describe("Start date in YYYY-MM-DD format"),
  end_date: z.string().describe("End date in YYYY-MM-DD format"),
});

const toolHandler = async ({ params }: any) => {
  const { start_date, end_date } = params;

  const response = await reportTaxSummary({ start_date, end_date });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error running Tax Summary report: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const ReportTaxSummaryTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
