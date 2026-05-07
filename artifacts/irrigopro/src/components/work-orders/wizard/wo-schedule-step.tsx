import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Users, Camera, ChevronDown, ChevronRight } from "lucide-react";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import type { WorkLocation } from "./wo-location-step";
import type { User as UserType } from "@shared/schema";
import { WizardSummaryStrip } from "./wo-summary-strip";

export interface ScheduleStepValue {
  priority: string;
  scheduledDate: string;
  assignedTechnicianId: number | null;
  assignedTechnicianName: string;
  specialInstructions: string;
  notes: string;
}

interface Props {
  value: ScheduleStepValue;
  onChange: (next: ScheduleStepValue) => void;
  customerName: string;
  branchName: string;
  pinnedLocation: WorkLocation | null;
  photos: UploadedFile[];
  onPhotosChange: (next: UploadedFile[]) => void;
  onEditPin: () => void;
  onBack: () => void;
  onContinue: () => void;
}

export function WoScheduleStep({
  value,
  onChange,
  customerName,
  branchName,
  pinnedLocation,
  photos,
  onPhotosChange,
  onEditPin,
  onBack,
  onContinue,
}: Props) {
  const [photosOpen, setPhotosOpen] = useState(photos.length > 0);
  const { data: fieldTechs } = useQuery<UserType[]>({
    queryKey: ["/api/users/field-techs"],
  });
  const allUsers: UserType[] = fieldTechs ?? [];
  const managers = allUsers.filter((u) => u.role === "irrigation_manager");
  const techs = allUsers.filter((u) => u.role === "field_tech");

  return (
    <div className="space-y-4">
      <WizardSummaryStrip
        customerName={customerName}
        branchName={branchName}
        pinnedLocation={pinnedLocation}
        onEditPin={onEditPin}
      />

      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Calendar className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Schedule &amp; Assign</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Priority</Label>
              <Select
                value={value.priority}
                onValueChange={(v) => onChange({ ...value, priority: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Scheduled Date</Label>
              <Input
                type="datetime-local"
                value={value.scheduledDate}
                onChange={(e) => onChange({ ...value, scheduledDate: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> Assign To
              </Label>
              <Select
                value={value.assignedTechnicianId?.toString() || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    onChange({ ...value, assignedTechnicianId: null, assignedTechnicianName: "" });
                    return;
                  }
                  const id = parseInt(v, 10);
                  const u = allUsers.find((x) => x.id === id);
                  onChange({
                    ...value,
                    assignedTechnicianId: id,
                    assignedTechnicianName: u?.name ?? "",
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select person (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Unassigned —</SelectItem>
                  {managers.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Managers
                      </div>
                      {managers.map((u) => (
                        <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                      ))}
                    </>
                  )}
                  {techs.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-1 pt-1">
                        Field Techs
                      </div>
                      {techs.map((u) => (
                        <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Special Instructions</Label>
            <Textarea
              value={value.specialInstructions}
              onChange={(e) => onChange({ ...value, specialInstructions: e.target.value })}
              placeholder="Any special instructions for the technician..."
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Internal Notes</Label>
            <Textarea
              value={value.notes}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              placeholder="Internal notes (not visible to customer)..."
              className="min-h-[60px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Collapsible Site Photos — capture optional site photos here so the
          tech doesn't have to leave Step 4 to attach them. The same photos
          array is rendered (also collapsible) in Step 5 review. */}
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
        <Button type="button" variant="outline" onClick={onBack}>← Back</Button>
        <Button
          type="button"
          onClick={onContinue}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
