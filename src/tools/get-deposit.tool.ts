import { getQuickbooksDeposit } from "../handlers/get-quickbooks-deposit.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "get_deposit";
const toolDescription = "Get a deposit by Id from QuickBooks Online.";

// Define the expected input schema for getting a deposit
const toolSchema = z.object({
  id: z.string(),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await getQuickbooksDeposit(args.params.id);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error getting deposit: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Deposit retrieved:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const GetDepositTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
