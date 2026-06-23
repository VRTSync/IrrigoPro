// Task #1500 — approval signature display in estimate detail modal and
// work-order detail views.
//
// These are static-source guards: they verify that the three consumer files
// correctly import and use ApprovalSignatureBlock, and that the component
// itself renders the right testids for drawn vs. typed signatures.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(import.meta.dirname, "approval-signature-block.tsx");
const ESTIMATE_MODAL_PATH = path.resolve(import.meta.dirname, "estimate-detail-modal.tsx");
const WO_DETAILS_PATH = path.resolve(
  import.meta.dirname,
  "../../components/work-orders/work-order-details.tsx",
);
const WO_DETAILS_PATH_ALT = path.resolve(
  import.meta.dirname,
  "../work-orders/work-order-details.tsx",
);
const COMPLETED_MODAL_PATH = path.resolve(
  import.meta.dirname,
  "../../components/billing/completed-work-detail-modal.tsx",
);
const COMPLETED_MODAL_PATH_ALT = path.resolve(
  import.meta.dirname,
  "../billing/completed-work-detail-modal.tsx",
);

const component = fs.readFileSync(COMPONENT_PATH, "utf8");
const estimateModal = fs.readFileSync(ESTIMATE_MODAL_PATH, "utf8");

const woDetailsSource = fs.existsSync(WO_DETAILS_PATH)
  ? fs.readFileSync(WO_DETAILS_PATH, "utf8")
  : fs.readFileSync(WO_DETAILS_PATH_ALT, "utf8");

const completedModalSource = fs.existsSync(COMPLETED_MODAL_PATH)
  ? fs.readFileSync(COMPLETED_MODAL_PATH, "utf8")
  : fs.readFileSync(COMPLETED_MODAL_PATH_ALT, "utf8");

describe("ApprovalSignatureBlock component source", () => {
  it("renders nothing when approvalSignatureData is absent (null guard)", () => {
    expect(component).toContain("if (!approvalSignatureData) return null");
  });

  it("has a root testid for integration targeting", () => {
    expect(component).toContain('data-testid="approval-signature-block"');
  });

  it("renders a drawn signature as an <img> with testid", () => {
    expect(component).toContain('data-testid="signature-image"');
    expect(component).toContain('approvalSignatureType === "drawn"');
  });

  it("renders a typed signature in a script-font wrapper with testid", () => {
    expect(component).toContain('data-testid="signature-typed-name"');
    expect(component).toContain("cursive");
  });

  it("renders signer name, date, IP, and consent text with testids", () => {
    expect(component).toContain('data-testid="signature-signer-name"');
    expect(component).toContain('data-testid="signature-signed-at"');
    expect(component).toContain('data-testid="signature-signer-ip"');
    expect(component).toContain('data-testid="signature-consent-text"');
  });

  it("guards signer-ip render so it is omitted when the field is absent", () => {
    expect(component).toContain("approvalSignerIp && (");
  });
});

describe("Estimate detail modal — ApprovalSignatureBlock integration", () => {
  it("imports ApprovalSignatureBlock", () => {
    expect(estimateModal).toContain(
      'import { ApprovalSignatureBlock } from "@/components/estimates/approval-signature-block"',
    );
  });

  it("renders ApprovalSignatureBlock inside the scrollable content", () => {
    expect(estimateModal).toContain("<ApprovalSignatureBlock");
    expect(estimateModal).toContain("approvalSignatureData={estimate.approvalSignatureData}");
  });

  it("gates the block on approved or converted-to-work-order state", () => {
    expect(estimateModal).toMatch(/isApproved\(estimate\).*isConvertedToWorkOrder\(estimate\)/s);
  });

  it("does NOT add new WO or billing-sheet columns — estimate fields only", () => {
    const match = estimateModal.match(
      /<ApprovalSignatureBlock[\s\S]*?\/>/,
    );
    expect(match).not.toBeNull();
    const block = match![0];
    expect(block).toContain("estimate.approvalSignatureType");
    expect(block).not.toContain("workOrder.approvalSignature");
  });
});

describe("Work order details view — ApprovalSignatureBlock integration", () => {
  it("imports ApprovalSignatureBlock", () => {
    expect(woDetailsSource).toContain(
      'import { ApprovalSignatureBlock } from "@/components/estimates/approval-signature-block"',
    );
  });

  it("renders ApprovalSignatureBlock when approvalSignatureData is present", () => {
    expect(woDetailsSource).toContain("<ApprovalSignatureBlock");
    expect(woDetailsSource).toContain("approvalSignatureData");
  });

  it("guards the block with approvalSignatureData check (no display when unsigned)", () => {
    expect(woDetailsSource).toContain("approvalSignatureData && (");
  });

  it("does NOT declare new WO schema columns — reads via (workOrder as any) cast", () => {
    expect(woDetailsSource).toContain("(workOrder as any).approvalSignatureData");
  });
});

describe("Completed-work detail modal — ApprovalSignatureBlock integration", () => {
  it("imports ApprovalSignatureBlock", () => {
    expect(completedModalSource).toContain(
      'import { ApprovalSignatureBlock } from "@/components/estimates/approval-signature-block"',
    );
  });

  it("renders ApprovalSignatureBlock for work-order type records only", () => {
    expect(completedModalSource).toContain("isWorkOrder && (wo as any)?.approvalSignatureData");
  });

  it("uses (wo as any) cast — no new billing-sheet or WO schema columns", () => {
    expect(completedModalSource).toContain("(wo as any).approvalSignatureData");
  });

  it("block appears after the Manager Approved approval stamp", () => {
    const approvalStampIdx = completedModalSource.indexOf("Manager Approved");
    // Use the JSX tag opening rather than the testid string, which also
    // appears in the import path earlier in the file.
    const sigBlockIdx = completedModalSource.indexOf("<ApprovalSignatureBlock");
    expect(approvalStampIdx).toBeGreaterThan(0);
    expect(sigBlockIdx).toBeGreaterThan(approvalStampIdx);
  });
});
