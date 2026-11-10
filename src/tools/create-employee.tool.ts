import { createQuickbooksEmployee } from "../handlers/create-quickbooks-employee.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { entityParams } from "../helpers/entity-params.js";

// Define the tool metadata
const toolName = "create_employee";
const toolDescription = "Create an employee in QuickBooks Online.";

// Define the expected input schema for creating an employee
const toolSchema = entityParams("employee");

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await createQuickbooksEmployee(args.params.employee);

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error creating employee: ${response.error}` },
      ],
    };
  }

  return {
    content: [
      { type: "text" as const, text: `Employee created:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const CreateEmployeeTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 