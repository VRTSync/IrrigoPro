import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import {
  User,
  Briefcase,
  MapPin,
  Cpu,
  Calendar,
  Camera,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Customer } from "@shared/schema";
import type { WorkLocation } from "./wo-location-step";
import { WizardSummaryStrip } from "./wo-summary-strip";

interface Props {
  customer: Customer | null;
  customerEmail: string;
  customerPhone: string;
  branchName: string;
  projectName: string;
  projectAddress: string;
  description: string;
  locationNotes: string;
  accessInstructions: string;
  workLocation: WorkLocation | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  priority: string;
  scheduledDate: string;
  assignedTechnicianName: string;
  specialInstructions: string;
  notes: string;
  photos: UploadedFile[];
  onPhotosChange: (next: UploadedFile[]) => void;
  onEditPin: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  isEdit: boolean;
}

export function WoReviewStep({
  customer,
  customerEmail,
  customerPhone,
  branchName,
  projectName,
  projectAddress,
  description,
  locationNotes,
  accessInstructions,
  workLocation,
  controllerLetter,
  zoneNumber,
  priority,
  scheduledDate,
  assignedTechnicianName,
  specialInstructions,
  notes,
  photos,
  onPhotosChange,
  onEditPin,
  onBack,
  onSubmit,
  submitting,
  isEdit,
}: Props) {
  const [photosOpen, setPhotosOpen] = useState(photos.length > 0);

  return (
    <div className="space-y-4">
      <WizardSummaryStrip
        customerName={customer?.name ?? ""}
        branchName={branchName}
        pinnedLocation={workLocation}
        onEditPin={onEditPin}
      />

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
            {branchName && (
              <div className="text-gray-500">
                Branch: <span className="text-gray-800">{branchName}</span>
              </div>
            )}
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
            {projectName && (
              <div>
                <span className="text-gray-500">Name: </span>
                {projectName}
              </div>
            )}
            {description && (
              <div>
                <span className="text-gray-500">Description: </span>
                {description}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Work Location — dedicated review block grouping pin + address +
           controller/zone + location notes + access instructions */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <MapPin className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Work Location</h2>
          </div>
          <div className="text-sm text-gray-700 space-y-1">
            {workLocation ? (
              <div>
                <span className="text-gray-500">Pin: </span>
                {workLocation.address ||
                  `${workLocation.lat.toFixed(6)}, ${workLocation.lng.toFixed(6)}`}
              </div>
            ) : (
              <div className="italic text-amber-700">No pin set.</div>
            )}
            {projectAddress && (
              <div>
                <span className="text-gray-500">Address: </span>
                {projectAddress}
              </div>
            )}
            {(controllerLetter || zoneNumber != null) && (
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                <div>
                  {controllerLetter && (
                    <>
                      <span className="text-gray-500">Controller: </span>
                      {controllerLetter}
                    </>
                  )}
                  {controllerLetter && zoneNumber != null && (
                    <span className="mx-2 text-gray-300">•</span>
                  )}
                  {zoneNumber != null && (
                    <>
                      <span className="text-gray-500">Zone: </span>
                      {zoneNumber}
                    </>
                  )}
                </div>
              </div>
            )}
            {locationNotes && (
              <div>
                <span className="text-gray-500">Location notes: </span>
                {locationNotes}
              </div>
            )}
            {accessInstructions && (
              <div>
                <span className="text-gray-500">Access: </span>
                {accessInstructions}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Schedule & Assignment */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Calendar className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Schedule &amp; Assignment</h2>
          </div>
          <div className="text-sm text-gray-700 space-y-1">
            <div>
              <span className="text-gray-500">Priority: </span>
              <span className="capitalize">{priority}</span>
            </div>
            {scheduledDate && (
              <div>
                <span className="text-gray-500">Scheduled: </span>
                {new Date(scheduledDate).toLocaleString()}
              </div>
            )}
            <div>
              <span className="text-gray-500">Assigned to: </span>
              {assignedTechnicianName || (
                <span className="italic text-gray-400">Unassigned</span>
              )}
            </div>
            {specialInstructions && (
              <div>
                <span className="text-gray-500">Special instructions: </span>
                {specialInstructions}
              </div>
            )}
            {notes && (
              <div>
                <span className="text-gray-500">Internal notes: </span>
                {notes}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Site Photos — collapsible */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <button
            type="button"
            onClick={() => setPhotosOpen((s) => !s)}
            className="w-full flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-md">
                <Camera className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">
                Site Photos{" "}
                <span className="text-xs text-gray-500 font-normal">
                  {photos.length > 0 ? `(${photos.length})` : "(optional)"}
                </span>
              </h2>
            </span>
            {photosOpen ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
          </button>
          {photosOpen && (
            <FileUpload
              type="photo"
              label="Photos"
              accept="image/*"
              multiple
              files={photos}
              onFilesChange={onPhotosChange}
            />
          )}
        </CardContent>
      </Card>

      <div className="hidden sm:flex justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isEdit ? "Save Changes" : "Create Work Order"}
        </Button>
      </div>
    </div>
  );
}
