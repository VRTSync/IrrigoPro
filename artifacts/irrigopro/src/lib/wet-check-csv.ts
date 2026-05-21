import { asArray } from "@/lib/queryClient";
import type { WetCheckWithDetails } from "@workspace/db/schema";

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(values: Array<string | number | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

function toIsoDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function wetCheckCsvFilename(wc: WetCheckWithDetails): string {
  const date = toIsoDate(wc.startedAt) || toIsoDate(wc.createdAt) || "unknown";
  const customer = (wc.customerName ?? "customer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `wet-check-${wc.id}-${customer}-${date}.csv`;
}

export function buildWetCheckCsv(wc: WetCheckWithDetails): string {
  const lines: string[] = [];

  lines.push(row(["Wet Check ID", wc.id ?? ""]));
  lines.push(row(["Customer", wc.customerName ?? ""]));
  lines.push(row(["Address", wc.propertyAddress ?? ""]));
  lines.push(row(["Technician", wc.technicianName ?? ""]));
  lines.push(row(["Status", wc.status ?? ""]));
  lines.push(row(["Started", toIsoDate(wc.startedAt)]));
  lines.push(row(["Submitted", toIsoDate(wc.submittedAt)]));
  lines.push(row(["Approved", toIsoDate(wc.approvedAt)]));
  lines.push(row(["Weather", wc.weather ?? ""]));
  lines.push(row(["Notes", wc.notes ?? ""]));
  lines.push(row(["Total Labor Hours", wc.totalLaborHours ?? "0.00"]));

  lines.push("");

  lines.push(row([
    "Controller",
    "Zone",
    "Zone Status",
    "Ran OK",
    "Pressure (PSI)",
    "Flow (GPM)",
    "Repair Labor Hrs",
    "Zone Notes",
    "Finding Issue Type",
    "Issue Group",
    "Severity",
    "Part",
    "Unit Price",
    "Qty",
    "Finding Labor Hrs",
    "Resolution",
    "Tech Disposition",
    "Finding Notes",
  ]));

  for (const zone of asArray(wc.zoneRecords)) {
    const findings = asArray(zone.findings);
    const ranOk =
      zone.ranSuccessfully === true
        ? "Yes"
        : zone.ranSuccessfully === false
        ? "No"
        : "";

    if (findings.length === 0) {
      lines.push(row([
        zone.controllerLetter,
        zone.zoneNumber,
        zone.status,
        ranOk,
        zone.observedPressure ?? "",
        zone.observedFlow ?? "",
        zone.repairLaborHours ?? "0.00",
        zone.notes ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]));
    } else {
      for (const finding of findings) {
        lines.push(row([
          zone.controllerLetter,
          zone.zoneNumber,
          zone.status,
          ranOk,
          zone.observedPressure ?? "",
          zone.observedFlow ?? "",
          zone.repairLaborHours ?? "0.00",
          zone.notes ?? "",
          finding.issueType,
          finding.issueGroup,
          finding.severity ?? "",
          finding.partName ?? "",
          finding.partPrice ?? "",
          finding.quantity,
          finding.laborHours ?? "0.00",
          finding.resolution,
          finding.techDisposition ?? "",
          finding.notes ?? "",
        ]));
      }
    }
  }

  return lines.join("\r\n") + "\r\n";
}
