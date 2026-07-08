import { listTaxRates } from "../handlers/list-tax-rates.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "list_tax_rates";
const toolDescription =
  "List the company's sales tax configuration from QuickBooks Online: tax agencies, tax rates " +
  "(e.g. Florida State 6%, county discretionary surtax), and tax codes with their combined rates. " +
  "Read-only. Use to verify tax setup before preparing a sales tax filing.";

const toolSchema = z.object({});

const toolHandler = async (_args: any) => {
  const response = await listTaxRates();

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error listing tax rates: ${response.error}` },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response.result) }],
  };
};

export const ListTaxRatesTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
