import { searchQuickbooksSalesReceipts } from "../handlers/search-quickbooks-sales-receipts.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "search_sales_receipts";
const toolDescription = "Search sales receipts in QuickBooks Online that match given criteria.";

// Define the expected input schema for searching sales receipts
const toolSchema = z.object({
  criteria: z.array(z.any()).optional(),
  asc: z.string().optional(),
  desc: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  count: z.boolean().optional(),
  fetchAll: z.boolean().optional(),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await searchQuickbooksSalesReceipts(args.params);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error searching sales receipts: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Sales receipts found:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const SearchSalesReceiptsTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
