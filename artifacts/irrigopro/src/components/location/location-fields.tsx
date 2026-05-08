import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Key, Hexagon, FileText } from "lucide-react";
import { Control } from "react-hook-form";

interface LocationFieldsProps {
  control: Control<any>;
  prefix?: string;
  readOnlyAddress?: boolean;
  /** Acres of the customer's saved property boundary. When provided, a small
   *  purple chip is rendered to remind the user that customer-scoped maps will
   *  be centered on the saved boundary. */
  propertyAcres?: number | null;
}

export function LocationFields({
  control,
  prefix = "",
  readOnlyAddress = false,
  propertyAcres,
}: LocationFieldsProps) {
  const hasBoundary = typeof propertyAcres === "number" && Number.isFinite(propertyAcres);
  return (
    <div className="w-full rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/60 via-white to-indigo-50/60 p-4 sm:p-5 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/80 backdrop-blur px-3 py-1 border border-blue-200 shadow-sm">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white">
            <MapPin className="w-3.5 h-3.5" />
          </span>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-blue-900">
            Location Information
          </span>
        </div>
        {hasBoundary && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-300 bg-purple-50 px-3 py-1 text-[11px] font-medium text-purple-700 shadow-sm">
            <Hexagon className="w-3 h-3" />
            Maps centered on saved boundary · {propertyAcres!.toFixed(2)} ac
          </span>
        )}
      </div>

      <FormField
        control={control}
        name={`${prefix}projectAddress`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] uppercase tracking-wide font-semibold text-gray-600 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" />
              Property Address {readOnlyAddress && (
                <span className="normal-case font-normal text-gray-400">
                  (from customer profile)
                </span>
              )}
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                readOnly={readOnlyAddress}
                placeholder="123 Main St, City, State 12345"
                className={`w-full min-w-0 rounded-lg ${readOnlyAddress ? "bg-gray-50 text-gray-700" : "bg-white"}`}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${prefix}locationNotes`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] uppercase tracking-wide font-semibold text-gray-600 flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Location Details
            </FormLabel>
            <FormControl>
              <Textarea
                {...field}
                placeholder="Additional location information, landmarks, or special notes..."
                className="w-full min-w-0 min-h-[80px] rounded-lg bg-white"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${prefix}accessInstructions`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] uppercase tracking-wide font-semibold text-gray-600 flex items-center gap-1.5">
              <Key className="w-3 h-3" />
              Access Instructions
            </FormLabel>
            <FormControl>
              <Textarea
                {...field}
                placeholder="How to access the property (gate codes, key location, contact info, etc.)"
                className="w-full min-w-0 min-h-[80px] rounded-lg bg-white"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
