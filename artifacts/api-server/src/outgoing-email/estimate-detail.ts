import type { EstimateEmailData } from "../email-service";
import { escapeHtml } from "./layout";

type EstimateItems = NonNullable<EstimateEmailData["items"]>;

export function buildEmailZoneGroups(
  items: NonNullable<EstimateEmailData['items']>,
  laborRate: number,
) {
  type EmailZoneGroup = {
    controllerLetter: string;
    zoneNumber: number;
    zoneLabel: string;
    items: NonNullable<EstimateEmailData['items']>;
    partsTotal: number;
    laborHrs: number;
    laborAmt: number;
    zoneTotal: number;
  };
  const groupMap = new Map<string, EmailZoneGroup>();
  for (const item of items) {
    const cl = item.controllerLetter ?? '';
    const zn = item.zoneNumber ?? 0;
    const key = `${cl}|${zn}`;
    let group = groupMap.get(key);
    if (!group) {
      const zoneLabel =
        cl && zn
          ? `Controller ${cl} \u00b7 Zone ${zn}`
          : cl
          ? `Controller ${cl}`
          : `Zone ${zn}`;
      group = {
        controllerLetter: cl,
        zoneNumber: zn,
        zoneLabel,
        items: [],
        partsTotal: 0,
        laborHrs: 0,
        laborAmt: 0,
        zoneTotal: 0,
      };
      groupMap.set(key, group);
    }
    group.items.push(item);
    group.partsTotal += item.partsCost;
    group.laborHrs += item.laborHours;
  }
  for (const g of groupMap.values()) {
    g.laborAmt = g.laborHrs * laborRate;
    g.zoneTotal = g.partsTotal + g.laborAmt;
  }
  return [...groupMap.values()].sort((a, b) => {
    const cl = a.controllerLetter.localeCompare(b.controllerLetter);
    if (cl !== 0) return cl;
    return a.zoneNumber - b.zoneNumber;
  });
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const hours = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: false });
const labelStyle = "margin:0 0 8px;font-size:12px;font-weight:bold;text-transform:uppercase;color:#4a7419;";
const cellStyle = "border-top:1px solid #dbe4ee;padding:9px 12px;";

export function renderEstimateDetail(data: EstimateEmailData): { html: string; text: string } {
  const esc = escapeHtml;
  const work = data.workDescription?.trim();
  const items = data.items ?? [];
  const htmlRows: string[] = [];
  const textLines = ["Work included"];

  function addItems(lines: EstimateItems) {
    for (const item of lines) {
      const name = item.description || item.partName;
      const qty = String(item.quantity);
      const amount = currency.format(item.lineTotal);
      htmlRows.push(`<tr>
        <td style="${cellStyle}">${esc(name)}</td>
        <td align="right" style="${cellStyle}">${esc(qty)}</td>
        <td align="right" style="${cellStyle}">${esc(amount)}</td>
      </tr>`);
      textLines.push(`- ${name} × ${qty}  ${amount}`);
    }
  }

  if (data.isInspectionOrigin) {
    for (const group of buildEmailZoneGroups(items, data.laborRate ?? 0)) {
      htmlRows.push(`<tr bgcolor="#f5f8fb"><th colspan="3" align="left" style="${cellStyle}font-weight:bold;">${esc(group.zoneLabel)}</th></tr>`);
      textLines.push(group.zoneLabel);
      addItems(group.items);
    }
  } else {
    addItems(items);
  }

  const parts = data.partsSubtotal ?? 0;
  const labor = data.laborSubtotal ?? 0;
  if (parts > 0 || labor > 0) {
    for (const [label, value] of [["Parts", currency.format(parts)], [`Labor · ${hours.format(data.totalLaborHours ?? 0)} h`, currency.format(labor)]]) {
      htmlRows.push(`<tr>
        <th scope="row" colspan="2" align="left" style="${cellStyle}font-weight:bold;">${esc(label)}</th>
        <td align="right" style="${cellStyle}">${esc(value)}</td>
      </tr>`);
      textLines.push(`${label}: ${value}`);
    }
  }

  return {
    html: `${work ? `<p style="${labelStyle}">Work description</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f8fb" style="margin:0 0 18px;border-radius:10px;">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#102a43;white-space:pre-wrap;">${esc(work)}</td></tr>
      </table>` : ""}
      <p style="${labelStyle}">Work included</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;border:1px solid #dbe4ee;border-radius:10px;overflow:hidden;font-size:14px;color:#102a43;">
        <tr bgcolor="#eef4fa" style="font-size:12px;font-weight:bold;color:#334e68;">
          <th scope="col" align="left" style="padding:9px 12px;">Item</th>
          <th scope="col" align="right" style="padding:9px 12px;">Qty</th>
          <th scope="col" align="right" style="padding:9px 12px;">Amount</th>
        </tr>
        ${htmlRows.join("")}
      </table>`,
    text: [work ? `Work description\n${work}` : "", textLines.join("\n")].filter(Boolean).join("\n\n"),
  };
}
