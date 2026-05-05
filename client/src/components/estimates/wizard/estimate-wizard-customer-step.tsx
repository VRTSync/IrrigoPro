import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { LocationFields } from "@/components/location/location-fields";
import { User, Mail, Phone, MapPin, Pencil, Briefcase } from "lucide-react";
import type { Customer } from "@shared/schema";

export interface CustomerStepValue {
  customer: Customer | null;
  projectName: string;
  projectAddress: string;
  useDifferentAddress: boolean;
  locationNotes: string;
  accessInstructions: string;
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

  const handleSelectCustomer = (c: Customer) => {
    const nextAddress = value.useDifferentAddress ? value.projectAddress : (c.address || "");
    onChange({ ...value, customer: c, projectAddress: nextAddress });
    form.setValue("projectAddress", nextAddress, { shouldDirty: false });
    setShowCustomerPicker(false);
  };

  const handleToggleAddress = () => {
    const newUseDifferent = !value.useDifferentAddress;
    const nextAddress = newUseDifferent ? value.projectAddress : (value.customer?.address || "");
    onChange({ ...value, useDifferentAddress: newUseDifferent, projectAddress: nextAddress });
    form.setValue("projectAddress", nextAddress, { shouldDirty: false });
  };

  const canContinue = !!value.customer && value.projectName.trim().length > 0;
  const addressReadOnly = !!value.customer && !value.useDifferentAddress;

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
            <div className="space-y-2">
              <div className="text-base font-semibold text-gray-900" data-testid="wizard-customer-name">
                {value.customer.name}
              </div>
              <div className="text-sm text-gray-700 space-y-1">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-gray-400" />
                  <span>{value.customer.email}</span>
                </div>
                {value.customer.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <span>{value.customer.phone}</span>
                  </div>
                )}
                {value.customer.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    <span className="truncate">{value.customer.address}</span>
                  </div>
                )}
              </div>
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
