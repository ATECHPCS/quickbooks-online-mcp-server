import { computeSalesTaxLiability } from "../handlers/sales-tax-liability.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "report_sales_tax_liability";
const toolDescription =
  "Compute Florida sales tax liability for a date range from actual QBO sales transactions " +
  "(invoices, sales receipts, minus credit memos and refund receipts). Returns gross/exempt/taxable " +
  "sales, tax collected split into FL state (6%) vs county discretionary surtax, a per-rate breakdown, " +
  "and data-quality flags (missing tax codes, legacy combined rates, $5,000 surtax-cap lines). " +
  "Read-only. This is the ground truth behind prepare_dr15.";

const toolSchema = z.object({
  start_date: z.string().describe("Start date in YYYY-MM-DD format"),
  end_date: z.string().describe("End date in YYYY-MM-DD format"),
});

const toolHandler = async ({ params }: any) => {
  const { start_date, end_date } = params;

  const response = await computeSalesTaxLiability({ start_date, end_date });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error computing sales tax liability: ${response.error}` },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response.result) }],
  };
};

export const ReportSalesTaxLiabilityTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
