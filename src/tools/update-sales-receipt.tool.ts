import { updateQuickbooksSalesReceipt } from "../handlers/update-quickbooks-sales-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "update_sales_receipt";
const toolDescription = "Update a sales receipt in QuickBooks Online.";

// Define the expected input schema for updating a sales receipt
const toolSchema = z.object({
  sales_receipt: z.any(),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await updateQuickbooksSalesReceipt(args.params.sales_receipt);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error updating sales receipt: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Sales receipt updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateSalesReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
