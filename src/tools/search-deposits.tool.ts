import { searchQuickbooksDeposits } from "../handlers/search-quickbooks-deposits.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "search_deposits";
const toolDescription = "Search deposits in QuickBooks Online that match given criteria.";

// Define the expected input schema for searching deposits
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
  const response = await searchQuickbooksDeposits(args.params);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error searching deposits: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Deposits found:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const SearchDepositsTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
