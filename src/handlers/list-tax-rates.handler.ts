import { quickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxRateInfo {
  id: string;
  name: string;
  rate_percent: number;
  agency_id: string | null;
  active: boolean;
}

export interface TaxCodeInfo {
  id: string;
  name: string;
  description: string;
  taxable: boolean;
  active: boolean;
  /** Names of the TaxRates this code applies on sales (e.g. ["Florida State", "Florida, Pinellas County"]) */
  sales_rate_names: string[];
  /** Combined percentage of all sales rates under this code */
  combined_rate_percent: number;
}

export interface TaxAgencyInfo {
  id: string;
  name: string;
}

export interface TaxConfig {
  automated_sales_tax: boolean;
  default_tax_code_id: string | null;
  agencies: TaxAgencyInfo[];
  rates: TaxRateInfo[];
  codes: TaxCodeInfo[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Read the company's sales tax configuration: agencies, rates, and tax codes.
 * Read-only. Useful for verifying how QBO is set up (e.g. FL 6% state +
 * county discretionary surtax) before relying on transaction tax details.
 */
export async function listTaxRates(): Promise<ToolResponse<TaxConfig>> {
  try {
    await quickbooksClient.authenticate();
    const quickbooks = quickbooksClient.getQuickbooks();

    // node-quickbooks pluralization is irregular (findTaxAgencies)
    const query = (entity: string, finder: string) =>
      new Promise<any[]>((resolve, reject) => {
        (quickbooks as any)[finder](
          { fetchAll: true },
          (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data?.QueryResponse?.[entity] || []);
          },
        );
      });

    const getPreferences = () =>
      new Promise<any>((resolve, reject) => {
        (quickbooks as any).getPreferences((err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

    const [agenciesRaw, ratesRaw, codesRaw, prefs] = await Promise.all([
      query("TaxAgency", "findTaxAgencies"),
      query("TaxRate", "findTaxRates"),
      query("TaxCode", "findTaxCodes"),
      getPreferences().catch(() => null),
    ]);

    const rateById = new Map<string, any>(
      ratesRaw.map((r: any) => [String(r.Id), r]),
    );

    const agencies: TaxAgencyInfo[] = agenciesRaw.map((a: any) => ({
      id: String(a.Id),
      name: a.DisplayName || "",
    }));

    const rates: TaxRateInfo[] = ratesRaw.map((r: any) => ({
      id: String(r.Id),
      name: r.Name || "",
      rate_percent: Number(r.RateValue ?? 0),
      agency_id: r.AgencyRef?.value ? String(r.AgencyRef.value) : null,
      active: r.Active !== false,
    }));

    const codes: TaxCodeInfo[] = codesRaw.map((c: any) => {
      const details: any[] = c.SalesTaxRateList?.TaxRateDetail || [];
      const saleNames: string[] = [];
      let combined = 0;
      for (const d of details) {
        const ref = d.TaxRateRef || {};
        const rate = rateById.get(String(ref.value));
        saleNames.push(ref.name || rate?.Name || String(ref.value || "?"));
        combined += Number(rate?.RateValue ?? 0);
      }
      return {
        id: String(c.Id),
        name: c.Name || "",
        description: c.Description || "",
        taxable: c.Taxable !== false,
        active: c.Active !== false,
        sales_rate_names: saleNames,
        combined_rate_percent: Math.round(combined * 10000) / 10000,
      };
    });

    const taxPrefs = prefs?.TaxPrefs || {};

    return {
      result: {
        automated_sales_tax: taxPrefs.PartnerTaxEnabled === true,
        default_tax_code_id: taxPrefs.TaxGroupCodeRef?.value
          ? String(taxPrefs.TaxGroupCodeRef.value)
          : null,
        agencies,
        rates,
        codes,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
