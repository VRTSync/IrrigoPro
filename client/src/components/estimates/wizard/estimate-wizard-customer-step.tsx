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

  // When the selected customer changes and we're using their address,
  // sync the project address in the form to match the customer.
  useEffect(() => {
    if (value.customer && !value.useDifferentAddress) {
      const next = value.customer.address || "";
      if (form.getValues("projectAddress") !== next) {
        form.setValue("projectAddress", next, { shouldDirty: false });
      }
    }
  }, [value.customer?.id, value.useDifferentAddress, form]);

  useEffect(() => {
    if (value.customer) {
      projectNameRef.current?.focus();
    }
  }, [value.customer?.id]);

  // Load the customer's controllers (A, B, ...) once a customer is picked.
  const { data: controllers = [] } = useQuery<PropertyController[]>({
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
    if (controllers.length === 0) return; // not loaded yet
    const stillThere = controllers.some(
      (c) => c.controllerLetter === value.controllerLetter,
    );
    if (!stillThere) {
      onChange({ ...valueRef.current, controllerLetter: null, zoneNumber: null });
    }
  }, [controllers, value.controllerLetter, onChange]);

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
    const nextAddress = value.useDifferentAddress ? value.projectAddress : (c.address || "");
    // Reset the map pin and controller/zone whenever the customer changes —
    // those choices are scoped to the previous customer's setup.
    onChange({
      ...value,
      customer: c,
      customerEmail: c.email ?? "",
      customerPhone: c.phone ?? "",
      projectAddress: nextAddress,
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
    value.customer?.address ||
    "";

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

      {/* Project card */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Briefcase className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Project</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wizard-project-name" className="text-sm">
              Project Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="wizard-project-name"
              ref={projectNameRef}
              autoFocus
              value={value.projectName}
              onChange={(e) => onChange({ ...value, projectName: e.target.value })}
              placeholder="e.g., Backyard Irrigation System"
              className="focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              data-testid="wizard-project-name"
            />
          </div>

          {value.customer && (
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
          )}

          <Form {...form}>
            <LocationFields control={form.control} readOnlyAddress={addressReadOnly} />
          </Form>

          {/* Map picker — mirrors the work order form pattern */}
          {value.customer && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-900">Work Location on Map</span>
                </div>
                <Button
                  type="button"
                  variant={showLocationPicker ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowLocationPicker((s) => !s)}
                  data-testid="wizard-toggle-map"
                >
                  {showLocationPicker ? "Hide Map" : "Select Location on Map"}
                </Button>
              </div>

              {!showLocationPicker && !value.workLocation && (
                <p className="text-xs text-gray-500">
                  Optional — pick a precise spot on the map so the field tech can navigate
                  straight to the work area.
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
                  className="bg-green-50 border border-green-200 rounded-lg p-3"
                  data-testid="wizard-location-confirmation"
                >
                  <p className="text-sm font-medium text-green-900">Pinned Location:</p>
                  <p className="text-sm text-green-800 mt-1">
                    {value.workLocation.address ||
                      `${value.workLocation.lat.toFixed(6)}, ${value.workLocation.lng.toFixed(6)}`}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearLocation}
                    className="mt-2 text-green-700 hover:text-green-900"
                    data-testid="wizard-clear-location"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Controller + Zone selectors */}
          {value.customer && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-gray-900">
                  Controller &amp; Zone <span className="text-xs text-gray-500 font-normal">(optional)</span>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">Controller</Label>
                  <Select
                    value={value.controllerLetter ?? "__none__"}
                    onValueChange={handleControllerChange}
                    disabled={controllers.length === 0}
                  >
                    <SelectTrigger data-testid="wizard-controller-select">
                      <SelectValue
                        placeholder={
                          controllers.length === 0
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
            </div>
          )}
        </CardContent>
      </Card>

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
