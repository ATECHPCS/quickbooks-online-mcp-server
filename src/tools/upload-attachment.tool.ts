import { uploadQuickbooksAttachment } from "../handlers/upload-quickbooks-attachment.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

// Define the tool metadata
const toolName = "upload_attachment";
const toolDescription =
  "Upload a file as an attachment to a QuickBooks Online entity. The file must be a PDF, JPG, or PNG within the configured receipts directory. The attachment is linked to the specified entity (Purchase, Invoice, Bill, etc.) after upload.";

// Define the expected input schema
const toolSchema = z.object({
  file_path: z
    .string()
    .describe(
      "Absolute path to the file to upload. Must be within RECEIPTS_DIR."
    ),
  entity_type: z
    .string()
    .describe(
      "QBO entity type to link to: Purchase, Invoice, Bill, Estimate, Vendor, Customer, Employee, JournalEntry, or BillPayment."
    ),
  entity_id: z
    .string()
    .describe("QBO entity ID to link the attachment to."),
});

type ToolParams = z.infer<typeof toolSchema>;

// Define the tool handler
const toolHandler = async (args: any) => {
  const response = await uploadQuickbooksAttachment(
    args.params.file_path,
    args.params.entity_type,
    args.params.entity_id
  );

  if (response.isError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error_type: response.error_type,
            message: response.error,
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response.result),
      },
    ],
  };
};

export const UploadAttachmentTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
