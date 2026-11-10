import { createQuickbooksCustomer } from "../handlers/create-quickbooks-customer.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

// Define the tool metadata
const toolName = "create_customer";
const toolDescription = "Create a customer in QuickBooks Online.";

// Define the expected input schema for creating a customer
const toolSchema = entityParams("customer");

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await createQuickbooksCustomer(args.params.customer);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error creating customer: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Customer created:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const CreateCustomerTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 