import type { Customer, InsertCustomer, InsertCustomerSyncReview } from "@workspace/db/schema";
import { changedLockedFields, QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";

export type MappedQbCustomer = {
  qbId: string; name: string; companyName: string; contactFirstName: string; contactLastName: string;
  email: string; phone: string; mobilePhone: string;
  address: string; street: string; city: string; state: string; zip: string; country: string;
  serviceStreet: string; serviceCity: string; serviceState: string; serviceZip: string;
  /** undefined = absent/unavailable; null = an unsupported term */
  paymentTerms: "net_30" | "net_15" | "due_on_receipt" | null | undefined;
  termName: string | null;
  qbLastUpdatedAt: Date | null;
  qbParentId: string | null;
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
function addressParts(value: unknown) {
  const addr = record(value);
  return {
    street: [addr.Line1, addr.Line2, addr.Line3].map(text).filter(Boolean).join(", "),
    city: text(addr.City), state: text(addr.CountrySubDivisionCode), zip: text(addr.PostalCode),
    country: text(addr.Country),
  };
}

export function mapQbCustomer(raw: Record<string, unknown>, termNames: Map<string, string> | null): MappedQbCustomer {
  const billing = addressParts(raw.BillAddr);
  const service = addressParts(raw.ShipAddr);
  const termId = text(record(raw.SalesTermRef).value);
  const termName = termId && termNames?.has(termId) ? text(termNames.get(termId)) : null;
  let paymentTerms: MappedQbCustomer["paymentTerms"];
  if (termName !== null) {
    switch (termName.toLowerCase()) {
      case "net 30": paymentTerms = "net_30"; break;
      case "net 15": paymentTerms = "net_15"; break;
      case "due on receipt": paymentTerms = "due_on_receipt"; break;
      default: paymentTerms = null;
    }
  }
  const timestamp = text(record(raw.MetaData).LastUpdatedTime);
  const date = timestamp ? new Date(timestamp) : null;
  return {
    qbId: text(raw.Id),
    qbParentId: text(record(raw.ParentRef).value) || null,
    name: text(raw.DisplayName) || text(raw.CompanyName) || text(raw.FullyQualifiedName),
    companyName: text(raw.CompanyName), contactFirstName: text(raw.GivenName), contactLastName: text(raw.FamilyName),
    email: text(record(raw.PrimaryEmailAddr).Address),
    phone: text(record(raw.PrimaryPhone).FreeFormNumber), mobilePhone: text(record(raw.Mobile).FreeFormNumber),
    ...billing, address: [billing.street, billing.city, billing.state, billing.zip].filter(Boolean).join(" "),
    serviceStreet: service.street, serviceCity: service.city, serviceState: service.state, serviceZip: service.zip,
    paymentTerms, termName, qbLastUpdatedAt: date && Number.isFinite(date.getTime()) ? date : null,
  };
}

export function buildSyncPatch(existing: Customer, mapped: MappedQbCustomer, locked: boolean):
  { patch: Partial<InsertCustomer>; ownedChanged: boolean } {
  const patch: Partial<InsertCustomer> = {};
  // Use the lock contract itself for normalization and ordered comparison.
  const changed = changedLockedFields(existing, mapped);
  for (const field of changed) {
    const value = mapped[field];
    if (field === "paymentTerms" && value == null) continue;
    if (!locked && (changedLockedFields({}, { [field]: existing[field] }).length || !value)) continue;
    Object.assign(patch, { [field]: value || (field === "email" ? "" : null) });
  }
  const ownedChanged = Object.keys(patch).length > 0;
  if ((existing.qbLastUpdatedAt?.getTime() ?? null) !== (mapped.qbLastUpdatedAt?.getTime() ?? null)) {
    patch.qbLastUpdatedAt = mapped.qbLastUpdatedAt;
  }
  return { patch, ownedChanged };
}

export type QbSyncSummary = {
  heldForReview: number; ignored: number;
  customersAdded: number; customersUpdated: number; customersUnchanged: number;
  totalCustomers: number; unmappedTerms: string[]; termsError?: string;
  results: Array<{ action: "created" | "updated" | "unchanged" | "error" | "held" | "ignored"; customer: unknown; error?: string }>;
};

export function normalizeCustomerName(name: string): string {
  const tokens = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens[0] === "the") tokens.shift();
  const suffixes = new Set(["llc", "inc", "co", "corp", "company", "ltd", "hoa"]);
  while (tokens.length && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function rankQbCandidates(customer: Pick<Customer, "name" | "irrigoName" | "street" | "zip">,
  qb: MappedQbCustomer[], limit = 5): Array<{ qbId: string; name: string; address: string; score: number }> {
  const tokens = (name: string) => new Set(normalizeCustomerName(name).split(" ").filter(Boolean));
  const names = [tokens(customer.name), tokens(customer.irrigoName ?? "")];
  const street = (value: string | null) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  return qb.map(row => {
    const other = tokens(row.name);
    const score = Math.max(...names.map(name => {
      if (!name.size || !other.size) return 0;
      return [...name].filter(token => other.has(token)).length / new Set([...name, ...other]).size;
    })) + (customer.zip?.trim() && customer.zip.trim() === row.zip.trim() ? 0.3 : 0)
      + (street(customer.street) && street(customer.street) === street(row.street) ? 0.3 : 0);
    return { qbId: row.qbId, name: row.name, address: row.address, score };
  }).filter(row => row.score >= 0.3).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

/** One creation policy shared by sync and explicit human review resolution. */
export function buildQbCustomerInsert(companyId: number, mapped: MappedQbCustomer): InsertCustomer {
  const data: InsertCustomer = { companyId, quickbooksId: mapped.qbId, name: mapped.name,
    email: mapped.email, qbLastUpdatedAt: mapped.qbLastUpdatedAt };
  for (const field of QB_OWNED_CUSTOMER_FIELDS) {
    if (mapped[field]) Object.assign(data, { [field]: mapped[field] });
  }
  return data;
}

export async function applyQbCustomers(args: {
  companyId: number;
  qbCustomers: Record<string, unknown>[];
  termNames: Map<string, string> | null;
  termsError?: string;
  deps: {
    getCustomerRecordsLock(companyId: number): Promise<{ locked: boolean }>;
    getCustomerByQuickBooksId(companyId: number, qbId: string): Promise<Customer | undefined>;
    createCustomer(data: InsertCustomer): Promise<Customer>;
    updateCustomer(id: number, data: Partial<InsertCustomer>): Promise<Customer | undefined>;
    getReviewRow(companyId: number, qbId: string): Promise<{ status: "open" | "dismissed" } | undefined>;
    getUnlinkedCustomers(companyId: number): Promise<Array<{ id: number; name: string }>>;
    insertReviewRow(row: InsertCustomerSyncReview): Promise<void>;
  };
}): Promise<QbSyncSummary> {
  const { companyId, qbCustomers, termNames, termsError, deps } = args;
  const { locked } = await deps.getCustomerRecordsLock(companyId);
  const unlinked = new Map<string, number>();
  for (const customer of await deps.getUnlinkedCustomers(companyId)) {
    const name = normalizeCustomerName(customer.name);
    if (name && (!unlinked.has(name) || customer.id < unlinked.get(name)!)) unlinked.set(name, customer.id);
  }
  const summary: QbSyncSummary = {
    heldForReview: 0, ignored: 0,
    customersAdded: 0, customersUpdated: 0, customersUnchanged: 0,
    totalCustomers: qbCustomers.length, unmappedTerms: [], results: [],
    ...(termsError === undefined ? {} : { termsError }),
  };
  const unmapped = new Set<string>();
  for (const raw of qbCustomers) {
    let mapped: MappedQbCustomer | undefined;
    try {
      mapped = mapQbCustomer(raw, termNames);
      if (!mapped.name) continue;
      if (mapped.paymentTerms === null && mapped.termName !== null) unmapped.add(mapped.termName);
      const existing = await deps.getCustomerByQuickBooksId(companyId, mapped.qbId);
      if (!existing) {
        const review = await deps.getReviewRow(companyId, mapped.qbId);
        if (review?.status === "dismissed") {
          summary.ignored++;
          summary.results.push({ action: "ignored", customer: mapped });
          continue;
        }
        const candidateId = unlinked.get(normalizeCustomerName(mapped.name));
        if (review || mapped.qbParentId || candidateId !== undefined) {
          if (!review) await deps.insertReviewRow({
            companyId, qbCustomerId: mapped.qbId, qbName: mapped.name, qbAddress: mapped.address,
            kind: mapped.qbParentId ? "sub_customer" : "possible_duplicate",
            qbParentId: mapped.qbParentId, candidateCustomerId: mapped.qbParentId ? null : candidateId,
          });
          summary.heldForReview++;
          summary.results.push({ action: "held", customer: mapped });
          continue;
        }
        const customer = await deps.createCustomer(buildQbCustomerInsert(companyId, mapped));
        summary.customersAdded++;
        summary.results.push({ action: "created", customer });
      } else {
        const { patch, ownedChanged } = buildSyncPatch(existing, mapped, locked);
        const customer = Object.keys(patch).length ? await deps.updateCustomer(existing.id, patch) : existing;
        if (ownedChanged) summary.customersUpdated++;
        else summary.customersUnchanged++;
        summary.results.push({ action: ownedChanged ? "updated" : "unchanged", customer: customer ?? existing });
      }
    } catch (error) {
      summary.results.push({ action: "error", customer: mapped ?? raw, error: error instanceof Error ? error.message : String(error) });
    }
  }
  summary.unmappedTerms = [...unmapped];
  return summary;
}
