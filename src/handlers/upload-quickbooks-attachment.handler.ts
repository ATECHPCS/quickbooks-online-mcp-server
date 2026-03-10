import fs from "fs";
import path from "path";
import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface UploadAttachmentResponse<T> extends ToolResponse<T> {
  error_type?:
    | "FILE_NOT_FOUND"
    | "PATH_NOT_ALLOWED"
    | "INVALID_FILE_TYPE"
    | "FILE_TOO_LARGE"
    | "QBO_API_ERROR";
}

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const ENTITY_GETTERS: Record<string, string> = {
  Purchase: "getPurchase",
  Invoice: "getInvoice",
  Bill: "getBill",
  Estimate: "getEstimate",
  Vendor: "getVendor",
  Customer: "getCustomer",
  Employee: "getEmployee",
  JournalEntry: "getJournalEntry",
  BillPayment: "getBillPayment",
};

/**
 * Upload a file as an attachment to a QuickBooks Online entity.
 * Validates file existence, path containment, type, size, and entity existence
 * before calling the QBO upload API.
 */
export async function uploadQuickbooksAttachment(
  filePath: string,
  entityType: string,
  entityId: string
): Promise<UploadAttachmentResponse<any>> {
  try {
    // a. Resolve receipts directory
    const receiptsDir =
      process.env.RECEIPTS_DIR ||
      path.join(
        process.env.HOME || "~",
        ".nanobot-stefany-home",
        ".receipts"
      );

    if (!fs.existsSync(receiptsDir)) {
      return {
        result: null,
        isError: true,
        error_type: "PATH_NOT_ALLOWED",
        error:
          "RECEIPTS_DIR is not configured or directory does not exist: " +
          receiptsDir,
      };
    }

    // b. File existence check (symlink-safe)
    let resolvedFilePath: string;
    try {
      resolvedFilePath = fs.realpathSync(filePath);
    } catch {
      return {
        result: null,
        isError: true,
        error_type: "FILE_NOT_FOUND",
        error: `File not found: ${filePath}`,
      };
    }

    // c. Path containment check (symlink-safe)
    const resolvedReceiptsDir = fs.realpathSync(receiptsDir);
    if (
      resolvedFilePath !== resolvedReceiptsDir &&
      !resolvedFilePath.startsWith(resolvedReceiptsDir + path.sep)
    ) {
      return {
        result: null,
        isError: true,
        error_type: "PATH_NOT_ALLOWED",
        error: "File must be within the receipts directory",
      };
    }

    // d. Extension check
    const ext = path.extname(resolvedFilePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        result: null,
        isError: true,
        error_type: "INVALID_FILE_TYPE",
        error: `Invalid file type '${ext}'. Allowed types: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      };
    }

    // e. Size check
    const fileSize = fs.statSync(resolvedFilePath).size;
    if (fileSize > MAX_FILE_SIZE) {
      return {
        result: null,
        isError: true,
        error_type: "FILE_TOO_LARGE",
        error: `File size ${fileSize} bytes exceeds maximum of ${MAX_FILE_SIZE} bytes (25MB)`,
      };
    }

    // f. Entity type validation
    if (!(entityType in ENTITY_GETTERS)) {
      return {
        result: null,
        isError: true,
        error_type: "QBO_API_ERROR",
        error: `Unsupported entity type '${entityType}'. Supported types: ${Object.keys(ENTITY_GETTERS).join(", ")}`,
      };
    }

    // g. Authenticate
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    // h. Entity pre-validation
    const getterMethod = ENTITY_GETTERS[entityType];
    await new Promise<void>((resolve, reject) => {
      (quickbooks as any)[getterMethod](
        entityId,
        (err: any, _entity: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    }).catch((err) => {
      // Re-throw as a structured error to be caught by the outer handler
      const error = new Error(
        `${entityType} with ID ${entityId} not found or QBO error: ${formatError(err)}`
      );
      (error as any).error_type = "QBO_API_ERROR";
      throw error;
    });

    // i. Upload
    const filename = path.basename(resolvedFilePath);
    const contentType = MIME_TYPES[ext];
    const stream = fs.createReadStream(resolvedFilePath);

    return new Promise((resolve) => {
      quickbooks.upload(
        filename,
        contentType,
        stream,
        entityType,
        entityId,
        (err: any, attachable: any) => {
          if (err) {
            resolve({
              result: null,
              isError: true,
              error_type: "QBO_API_ERROR",
              error: formatError(err),
            });
          } else {
            resolve({
              result: {
                attachable_id:
                  attachable.Id ||
                  attachable.AttachableResponse?.Id,
                filename,
                entity_type: entityType,
                entity_id: entityId,
              },
              isError: false,
              error: null,
            });
          }
        }
      );
    });
  } catch (error: any) {
    // j. Outer catch -- handles entity pre-validation errors and unexpected errors
    if (error.error_type) {
      return {
        result: null,
        isError: true,
        error_type: error.error_type,
        error: error.message,
      };
    }
    return {
      result: null,
      isError: true,
      error_type: "QBO_API_ERROR",
      error: formatError(error),
    };
  }
}
