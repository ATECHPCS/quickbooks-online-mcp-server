import { updateQuickbooksBillPayment } from "../handlers/update-quickbooks-bill-payment.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

// Define the tool metadata
const toolName = "update_bill_payment";
const toolDescription = "Update a bill payment in QuickBooks Online.";

// Define the expected input schema for updating a bill payment
const toolSchema = entityParams("billPayment");

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await updateQuickbooksBillPayment(args.params.billPayment);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error updating bill payment: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Bill payment updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateBillPaymentTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 