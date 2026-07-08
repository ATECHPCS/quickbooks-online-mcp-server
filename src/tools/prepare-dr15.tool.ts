import { prepareDr15 } from "../handlers/prepare-dr15.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "prepare_dr15";
const toolDescription =
  "Prepare a Florida DR-15 sales tax return worksheet for a monthly filing period from QBO data. " +
  "Computes gross/exempt/taxable sales, tax due (state 6% + county discretionary surtax), the " +
  "collection allowance (2.5% of first $1,200, max $30, for timely e-filing), amount due, " +
  "discretionary surtax line 15(d), due date and late-after date. Returns structured lines plus a " +
  "ready-to-type worksheet for manual entry on floridarevenue.com. Read-only — does NOT file anything.";

const toolSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .describe("Filing period as YYYY-MM, e.g. 2026-06"),
  efile_on_time: z
    .boolean()
    .optional()
    .describe(
      "Whether the return will be e-filed and e-paid on time (enables the collection allowance). Default true.",
    ),
});

const toolHandler = async ({ params }: any) => {
  const { period, efile_on_time } = params;

  const response = await prepareDr15({ period, efile_on_time });

  if (response.isError) {
    return {
      content: [
        { type: "text" as const, text: `Error preparing DR-15: ${response.error}` },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response.result) }],
  };
};

export const PrepareDr15Tool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
