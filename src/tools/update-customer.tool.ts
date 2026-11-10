import { updateQuickbooksCustomer } from "../handlers/update-quickbooks-customer.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

const toolName = "update_customer";
const toolDescription = "Update an existing customer in QuickBooks Online.";
const toolSchema = entityParams("customer");

type ToolParams = z.infer<typeof toolSchema>;

const toolHandler = async (args: any) => {
  const response = await updateQuickbooksCustomer(args.params.customer);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error updating customer: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Customer updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateCustomerTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 