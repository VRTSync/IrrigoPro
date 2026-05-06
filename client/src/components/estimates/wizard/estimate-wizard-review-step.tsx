import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Image as ImageIcon, Paperclip, User, Briefcase, Loader2, MapPin, Cpu } from "lucide-react";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import type { Customer } from "@shared/schema";
import { computeTotals, type WizardLineItem } from "./estimate-wizard-line-items-step";

interface EstimateWizardReviewStepProps {
  customer: Customer | null;
  customerEmail: string;
  customerPhone: string;
  projectName: string;
  projectAddress: string;
  workLocation: { lat: number; lng: number; address?: string } | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  locationNotes: string;
  accessInstructions: string;
  laborRate: number;
  items: WizardLineItem[];
  photos: UploadedFile[];
  attachments: UploadedFile[];
  onPhotosChange: (next: UploadedFile[]) => void;
  onAttachmentsChange: (next: UploadedFile[]) => void;
  onBack: () => void;
  onSubmit: (mode?: "draft" | "submit") => void;
  submitting: boolean;
  isEdit: boolean;
  /**
   * Slice 10c — when editing an estimate whose lifecycle is `draft`, the
   * footer flips to a dual CTA: "Save changes" (PUT only) + "Submit for
   * Approval" (PUT + transition). Pass `true` to enable.
   */
  isDraftEdit?: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function EstimateWizardReviewStep({
  customer,
  customerEmail,
  customerPhone,
  projectName,
  projectAddress,
  workLocation,
  controllerLetter,
  zoneNumber,
  locationNotes,
  accessInstructions,
  laborRate,
  items,
  photos,
  attachments,
  onPhotosChange,
  onAttachmentsChange,
  onBack,
  onSubmit,
  submitting,
  isEdit,
  isDraftEdit,
}: EstimateWizardReviewStepProps) {
  const totals = computeTotals(items, laborRate);
  const [attachOpen, setAttachOpen] = useState(false);
  const total = photos.length + attachments.length;

  return (
    <div className="space-y-4">
      {/* Customer */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Customer</h2>
          </div>
          <div className="text-sm text-gray-700">
            <div className="font-semibold text-gray-900">{customer?.name}</div>
            {customerEmail && <div>{customerEmail}</div>}
            {customerPhone && <div>{customerPhone}</div>}
          </div>
        </CardContent>
      </Card>

      {/* Project */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Briefcase className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Project</h2>
          </div>
          <div className="text-sm text-gray-700 space-y-1">
            <div><span className="text-gray-500">Name: </span>{projectName}</div>
            {projectAddress && <div><span className="text-gray-500">Address: </span>{projectAddress}</div>}
            {workLocation && (
              <div className="flex items-start gap-1.5" data-testid="wizard-review-pinned-location">
                <MapPin className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-gray-500">Pinned: </span>
                  {workLocation.address ||
                    `${workLocation.lat.toFixed(6)}, ${workLocation.lng.toFixed(6)}`}
                </div>
              </div>
            )}
            {(controllerLetter || zoneNumber != null) && (
              <div className="flex items-center gap-1.5" data-testid="wizard-review-controller-zone">
                <Cpu className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                <div>
                  {controllerLetter && (
                    <>
                      <span className="text-gray-500">Controller: </span>
                      {controllerLetter}
                    </>
                  )}
                  {controllerLetter && zoneNumber != null && <span className="mx-2 text-gray-300">•</span>}
                  {zoneNumber != null && (
                    <>
                      <span className="text-gray-500">Zone: </span>
                      {zoneNumber}
                    </>
                  )}
                </div>
              </div>
            )}
            {locationNotes && <div><span className="text-gray-500">Location notes: </span>{locationNotes}</div>}
            {accessInstructions && (
              <div><span className="text-gray-500">Access: </span>{accessInstructions}</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Line items + totals */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pl-3">Part</th>
                <th className="py-2 px-2 w-16 text-right">Qty</th>
                <th className="py-2 px-2 w-24 text-right">Unit</th>
                <th className="py-2 px-2 w-24 text-right">Labor h</th>
                <th className="py-2 pr-3 w-28 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const lineTotal = it.partPrice * it.quantity + it.laborHours * it.quantity * laborRate;
                return (
                  <tr key={it.rowId} className="border-b last:border-b-0 align-top">
                    <td className="py-2 pl-3">
                      <div className="font-medium text-gray-900">{it.partName}</div>
                      {it.description && <div className="text-xs text-gray-600 mt-0.5">{it.description}</div>}
                    </td>
                    <td className="py-2 px-2 text-right">{it.quantity}</td>
                    <td className="py-2 px-2 text-right">{fmt(it.partPrice)}</td>
                    <td className="py-2 px-2 text-right">{(it.laborHours * it.quantity).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{fmt(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-gray-50">
                <td colSpan={4} className="py-2 pl-3 text-sm text-gray-600 text-right">Parts</td>
                <td className="py-2 pr-3 text-right text-sm font-medium">{fmt(totals.partsSubtotal)}</td>
              </tr>
              <tr className="bg-gray-50">
                <td colSpan={4} className="py-2 pl-3 text-sm text-gray-600 text-right">
                  Labor ({totals.totalLaborHours.toFixed(2)} h × {fmt(laborRate)}/hr)
                </td>
                <td className="py-2 pr-3 text-right text-sm font-medium">{fmt(totals.laborSubtotal)}</td>
              </tr>
              <tr className="border-t border-green-200 bg-green-50">
                <td colSpan={4} className="py-3 pl-3 text-base font-semibold text-green-800 text-right">Total</td>
                <td
                  className="py-3 pr-3 text-right text-lg font-bold text-green-700"
                  data-testid="wizard-review-total"
                >
                  {fmt(totals.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Photos & Attachments collapsible */}
      <Card>
        <CardContent className="p-0">
          <Collapsible open={attachOpen} onOpenChange={setAttachOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-md"
                data-testid="wizard-attachments-toggle"
              >
                <div className="flex items-center gap-2">
                  <div className="bg-blue-50 p-2 rounded-md">
                    <ImageIcon className="w-4 h-4 text-blue-600" />
                  </div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Photos &amp; Attachments {total > 0 && <span className="text-gray-500 font-normal">({total})</span>}
                  </h2>
                </div>
                {attachOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 sm:px-5 pb-5 space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-gray-500" /> Site Photos
                  </h3>
                  <FileUpload
                    type="photo"
                    label="Photos"
                    accept="image/*"
                    multiple
                    files={photos}
                    onFilesChange={onPhotosChange}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-gray-500" /> Attachments
                  </h3>
                  <FileUpload
                    type="attachment"
                    label="Attachments"
                    accept="*/*"
                    multiple
                    files={attachments}
                    onFilesChange={onAttachmentsChange}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Desktop footer */}
      <div className="hidden sm:flex flex-col gap-2 pt-2">
        {isDraftEdit && (
          <p className="text-xs text-gray-500 text-right">
            Save changes keeps this as a draft. Submit for Approval sends it to the billing manager.
          </p>
        )}
        <div className="flex justify-between gap-3">
          <Button type="button" variant="outline" onClick={onBack} data-testid="wizard-back-3">
            ← Back to Line Items
          </Button>
          <div className="flex items-center gap-2">
            {!isEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onSubmit("draft")}
                disabled={submitting}
                data-testid="wizard-save-draft"
              >
                Save as draft
              </Button>
            )}
            {isDraftEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onSubmit("draft")}
                disabled={submitting}
                data-testid="wizard-save-draft"
              >
                Save changes
              </Button>
            )}
            <Button
              type="button"
              onClick={() => onSubmit("submit")}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="wizard-submit"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit && !isDraftEdit ? "Save Changes" : "Submit for Approval"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
