import { updateQuickbooksEstimate } from "../handlers/update-quickbooks-estimate.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

const toolName = "update_estimate";
const toolDescription = "Update an estimate in QuickBooks Online.";
const toolSchema = entityParams("estimate");

const toolHandler = async (args: any) => {
  const response = await updateQuickbooksEstimate(args.params.estimate);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error updating estimate: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Estimate updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateEstimateTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 