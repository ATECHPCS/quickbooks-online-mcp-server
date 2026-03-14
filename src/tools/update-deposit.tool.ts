import { updateQuickbooksDeposit } from "../handlers/update-quickbooks-deposit.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "update_deposit";
const toolDescription = "Update a deposit in QuickBooks Online.";

// Define the expected input schema for updating a deposit
const toolSchema = z.object({
  deposit: z.any(),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await updateQuickbooksDeposit(args.params.deposit);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error updating deposit: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Deposit updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateDepositTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
