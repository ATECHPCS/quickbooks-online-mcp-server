import { getQuickbooksSalesReceipt } from "../handlers/get-quickbooks-sales-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "get_sales_receipt";
const toolDescription = "Get a sales receipt by Id from QuickBooks Online.";

// Define the expected input schema for getting a sales receipt
const toolSchema = z.object({
  id: z.string(),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await getQuickbooksSalesReceipt(args.params.id);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error getting sales receipt: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Sales receipt retrieved:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const GetSalesReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
