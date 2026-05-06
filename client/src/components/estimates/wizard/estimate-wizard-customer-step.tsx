import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { LocationFields } from "@/components/location/location-fields";
import { LocationPicker } from "@/components/ui/location-picker";
import { composeCustomerAddress } from "@/lib/customer-address";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Pencil,
  Briefcase,
  Cpu,
  Droplets,
} from "lucide-react";
import type { Customer, PropertyController } from "@shared/schema";

export interface WorkLocation {
  lat: number;
  lng: number;
  address?: string;
}

export interface CustomerStepValue {
  customer: Customer | null;
  customerEmail: string;
  customerPhone: string;
  projectName: string;
  projectAddress: string;
  useDifferentAddress: boolean;
  locationNotes: string;
  accessInstructions: string;
  workLocation: WorkLocation | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
}

interface EstimateWizardCustomerStepProps {
  value: CustomerStepValue;
  onChange: (next: CustomerStepValue) => void;
  onContinue: () => void;
  onCancel: () => void;
  customerLocked?: boolean;
}

interface LocationFormValues {
  projectAddress: string;
  locationNotes: string;
  accessInstructions: string;
}

export function EstimateWizardCustomerStep({
  value,
  onChange,
  onContinue,
  onCancel,
  customerLocked,
}: EstimateWizardCustomerStepProps) {
  const projectNameRef = useRef<HTMLInputElement | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(!value.customer);
  const [showLocationPicker, setShowLocationPicker] = useState(!!value.workLocation);
  // valueRef avoids stale closures inside the form `watch` subscription.
  const valueRef = useRef(value);
  valueRef.current = value;

  const form = useForm<LocationFormValues>({
    defaultValues: {
      projectAddress: value.projectAddress,
      locationNotes: value.locationNotes,
      accessInstructions: value.accessInstructions,
    },
  });

  // Mirror form changes back up to the wizard's controlled state.
  useEffect(() => {
    const sub = form.watch((v) => {
      const current = valueRef.current;
      const projectAddress = v.projectAddress ?? "";
      const locationNotes = v.locationNotes ?? "";
      const accessInstructions = v.accessInstructions ?? "";
      if (
        projectAddress === current.projectAddress &&
        locationNotes === current.locationNotes &&
        accessInstructions === current.accessInstructions
      ) {
        return;
      }
      onChange({
        ...current,
        projectAddress,
        locationNotes,
        accessInstructions,
      });
    });
    return () => sub.unsubscribe();
  }, [form, onChange]);

  // Keep the form's projectAddress field in sync whenever the controlled
  // value changes (e.g. on customer selection or "use different address"
  // toggle). `handleSelectCustomer` and `handleToggleAddress` are the only
  // places that compute a new address, so this just mirrors that into the
  // form.
  useEffect(() => {
    if (form.getValues("projectAddress") !== value.projectAddress) {
      form.setValue("projectAddress", value.projectAddress, { shouldDirty: false });
    }
  }, [value.projectAddress, form]);

  useEffect(() => {
    if (value.customer) {
      projectNameRef.current?.focus();
    }
  }, [value.customer?.id]);

  // Load the customer's controllers (A, B, ...) once a customer is picked.
  const { data: controllers = [], isLoading: controllersLoading } = useQuery<PropertyController[]>({
    queryKey: ["/api/properties", value.customer?.id, "controllers"],
    enabled: !!value.customer,
  });

  const selectedController = controllers.find(
    (c) => c.controllerLetter === value.controllerLetter,
  );
  const zoneCount = selectedController?.zoneCount ?? 0;

  // If the chosen controller no longer exists in the customer's list (e.g.
  // customer changed), clear the controller/zone state.
  useEffect(() => {
    if (!value.controllerLetter) return;
    if (controllersLoading) return; // wait until the query resolves
    if (controllers.length === 0) return;
    const stillThere = controllers.some(
      (c) => c.controllerLetter === value.controllerLetter,
    );
    if (!stillThere) {
      onChange({ ...valueRef.current, controllerLetter: null, zoneNumber: null });
    }
  }, [controllers, controllersLoading, value.controllerLetter, onChange]);

  // If the chosen zone is now out of range for the (possibly changed)
  // controller, clear it.
  useEffect(() => {
    if (value.zoneNumber == null) return;
    if (!selectedController) return;
    if (value.zoneNumber > zoneCount) {
      onChange({ ...valueRef.current, zoneNumber: null });
    }
  }, [selectedController, zoneCount, value.zoneNumber, onChange]);

  const handleSelectCustomer = (c: Customer) => {
    // A single customer pick fans out to every customer-derived default:
    // contact info, project address (snap back to the customer's address
    // even if a previous selection had toggled "use different address"),
    // map pin, and controller/zone. The user never has to re-select.
    const nextAddress = c.address || "";
    onChange({
      ...value,
      customer: c,
      customerEmail: c.email ?? "",
      customerPhone: c.phone ?? "",
      projectAddress: nextAddress,
      useDifferentAddress: false,
      workLocation: null,
      controllerLetter: null,
      zoneNumber: null,
    });
    form.setValue("projectAddress", nextAddress, { shouldDirty: false });
    setShowCustomerPicker(false);
    setShowLocationPicker(false);
  };

  const handleToggleAddress = () => {
    const newUseDifferent = !value.useDifferentAddress;
    const nextAddress = newUseDifferent ? value.projectAddress : (value.customer?.address || "");
    onChange({ ...value, useDifferentAddress: newUseDifferent, projectAddress: nextAddress });
    form.setValue("projectAddress", nextAddress, { shouldDirty: false });
  };

  const handleLocationSelect = (loc: WorkLocation) => {
    onChange({ ...valueRef.current, workLocation: loc });
  };

  const handleClearLocation = () => {
    onChange({ ...valueRef.current, workLocation: null });
  };

  const handleControllerChange = (letter: string) => {
    const next = letter === "__none__" ? null : letter;
    onChange({ ...valueRef.current, controllerLetter: next, zoneNumber: null });
  };

  const handleZoneChange = (zone: string) => {
    const next = zone === "__none__" ? null : Number(zone);
    onChange({ ...valueRef.current, zoneNumber: next });
  };

  const canContinue = !!value.customer && value.projectName.trim().length > 0;
  const addressReadOnly = !!value.customer && !value.useDifferentAddress;

  const mapDefaultAddress =
    value.workLocation?.address ||
    value.projectAddress ||
    composeCustomerAddress(value.customer);

  return (
    <div className="space-y-4">
      {/* Customer card */}
      <Card className={value.customer ? "border-l-4 border-l-blue-500" : ""}>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Customer</h2>
          </div>

          {(!value.customer || showCustomerPicker) && !customerLocked ? (
            <CustomerSelector
              selectedCustomer={value.customer}
              onSelectCustomer={handleSelectCustomer}
              hideLabel
              placeholder="Search and select a customer..."
              autoOpen
            />
          ) : value.customer ? (
            <div className="space-y-3">
              <div className="text-base font-semibold text-gray-900" data-testid="wizard-customer-name">
                {value.customer.name}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="wizard-customer-email"
                    className="text-xs text-gray-600 flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5 text-gray-400" /> Email
                  </Label>
                  <Input
                    id="wizard-customer-email"
                    type="email"
                    value={value.customerEmail}
                    onChange={(e) => onChange({ ...value, customerEmail: e.target.value })}
                    placeholder="customer@example.com"
                    className="focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                    data-testid="wizard-customer-email"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="wizard-customer-phone"
                    className="text-xs text-gray-600 flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5 text-gray-400" /> Phone
                  </Label>
                  <Input
                    id="wizard-customer-phone"
                    type="tel"
                    value={value.customerPhone}
                    onChange={(e) => onChange({ ...value, customerPhone: e.target.value })}
                    placeholder="(555) 555-5555"
                    className="focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                    data-testid="wizard-customer-phone"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Used for this estimate only — won't update the customer record.
              </p>
              {value.customer.address && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  <span className="truncate">{value.customer.address}</span>
                </div>
              )}
              {!customerLocked && (
                <button
                  type="button"
                  onClick={() => setShowCustomerPicker(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                  data-testid="wizard-change-customer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Change customer
                </button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Project Details card — gated until a customer is chosen so it's
          obvious that customer selection is the first step. */}
      {value.customer && (
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Briefcase className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Project Details</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wizard-project-name" className="text-sm">
              Project Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="wizard-project-name"
              ref={projectNameRef}
              value={value.projectName}
              onChange={(e) => onChange({ ...value, projectName: e.target.value })}
              placeholder="e.g., Backyard Irrigation System"
              className="focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              data-testid="wizard-project-name"
            />
          </div>

          <div className="flex justify-end -mb-2">
            <button
              type="button"
              onClick={handleToggleAddress}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
              data-testid="wizard-toggle-address"
            >
              {value.useDifferentAddress ? "Use customer address" : "Use a different address"}
            </button>
          </div>

          <Form {...form}>
            <LocationFields control={form.control} readOnlyAddress={addressReadOnly} />
          </Form>
        </CardContent>
      </Card>
      )}

      {/* Work Location (map) card */}
      {value.customer && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="bg-blue-50 p-2 rounded-md">
                  <MapPin className="w-4 h-4 text-blue-600" />
                </div>
                <h2 className="text-base font-semibold text-gray-900">
                  Work Location <span className="text-xs text-gray-500 font-normal">(optional)</span>
                </h2>
              </div>
              <Button
                type="button"
                variant={showLocationPicker ? "default" : "outline"}
                size="sm"
                onClick={() => setShowLocationPicker((s) => !s)}
                data-testid="wizard-toggle-map"
                className="inline-flex items-center gap-1.5"
              >
                <MapPin className="w-3.5 h-3.5" />
                {showLocationPicker ? "Close map" : "Open map"}
              </Button>
            </div>

            {!showLocationPicker && !value.workLocation && (
              <p className="text-xs text-gray-500">
                Pick a precise spot on the map so the field tech can navigate straight to the
                work area.
              </p>
            )}

            {showLocationPicker && (
              <LocationPicker
                key={value.customer.id}
                defaultAddress={mapDefaultAddress}
                onLocationSelect={handleLocationSelect}
                selectedLocation={value.workLocation}
              />
            )}

            {value.workLocation && (
              <div
                className="border-l-4 border-l-blue-500 bg-blue-50/50 border border-blue-200 rounded-lg p-3"
                data-testid="wizard-location-confirmation"
              >
                <p className="text-sm font-medium text-blue-900">Pinned Location:</p>
                <p className="text-sm text-blue-800 mt-1">
                  {value.workLocation.address ||
                    `${value.workLocation.lat.toFixed(6)}, ${value.workLocation.lng.toFixed(6)}`}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearLocation}
                  className="mt-2 text-blue-700 hover:text-blue-900"
                  data-testid="wizard-clear-location"
                >
                  Clear
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Controller & Zone card */}
      {value.customer && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-md">
                <Cpu className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">
                Controller &amp; Zone <span className="text-xs text-gray-500 font-normal">(optional)</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Controller</Label>
                <Select
                  value={value.controllerLetter ?? "__none__"}
                  onValueChange={handleControllerChange}
                  disabled={controllersLoading || controllers.length === 0}
                >
                  <SelectTrigger data-testid="wizard-controller-select">
                    <SelectValue
                      placeholder={
                        controllersLoading
                          ? "Loading controllers…"
                          : controllers.length === 0
                          ? "No controllers on file"
                          : "Select controller"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {controllers.map((c) => (
                      <SelectItem key={c.controllerLetter} value={c.controllerLetter}>
                        Controller {c.controllerLetter}{" "}
                        <span className="text-gray-500">({c.zoneCount} zones)</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600 flex items-center gap-1">
                  <Droplets className="w-3 h-3" /> Zone
                </Label>
                <Select
                  value={value.zoneNumber == null ? "__none__" : String(value.zoneNumber)}
                  onValueChange={handleZoneChange}
                  disabled={!selectedController || zoneCount === 0}
                >
                  <SelectTrigger data-testid="wizard-zone-select">
                    <SelectValue
                      placeholder={
                        !selectedController ? "Pick a controller first" : "Select zone"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {Array.from({ length: zoneCount }, (_, i) => i + 1).map((z) => (
                      <SelectItem key={z} value={String(z)}>
                        Zone {z}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="hidden sm:flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} data-testid="wizard-cancel">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          data-testid="wizard-continue-1"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
