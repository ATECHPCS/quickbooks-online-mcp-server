import { createQuickbooksEstimate } from "../handlers/create-quickbooks-estimate.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

const toolName = "create_estimate";
const toolDescription = "Create an estimate in QuickBooks Online.";
const toolSchema = entityParams("estimate");

const toolHandler = async (args: any) => {
  const response = await createQuickbooksEstimate(args.params.estimate);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error creating estimate: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Estimate created:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const CreateEstimateTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 