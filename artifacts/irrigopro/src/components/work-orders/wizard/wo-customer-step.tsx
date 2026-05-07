import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { User, Mail, Phone, MapPin, Pencil, Building2 } from "lucide-react";
import type { Customer } from "@shared/schema";

export interface CustomerStepValue {
  customer: Customer | null;
  customerEmail: string;
  customerPhone: string;
  branchName: string;
}

interface Props {
  value: CustomerStepValue;
  onChange: (next: CustomerStepValue) => void;
  onContinue: () => void;
  onCancel: () => void;
  customerLocked?: boolean;
}

export function WoCustomerStep({ value, onChange, onContinue, onCancel, customerLocked }: Props) {
  const [showPicker, setShowPicker] = useState(!value.customer);
  const valueRef = useRef(value);
  valueRef.current = value;

  const branches: string[] = Array.isArray(value.customer?.branches)
    ? (value.customer!.branches as string[])
    : [];
  const branchRequired = branches.length > 0;

  useEffect(() => {
    if (value.customer) setShowPicker(false);
  }, [value.customer?.id]);

  const handleSelect = (c: Customer) => {
    onChange({
      ...valueRef.current,
      customer: c,
      customerEmail: c.email ?? "",
      customerPhone: c.phone ?? "",
      branchName: "",
    });
    setShowPicker(false);
  };

  const canContinue =
    !!value.customer && (!branchRequired || !!value.branchName);

  return (
    <div className="space-y-4">
      <Card className={value.customer ? "border-l-4 border-l-blue-500" : ""}>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Customer</h2>
          </div>

          {(!value.customer || showPicker) && !customerLocked ? (
            <CustomerSelector
              selectedCustomer={value.customer}
              onSelectCustomer={handleSelect}
              hideLabel
              placeholder="Search and select a customer..."
              autoOpen
            />
          ) : value.customer ? (
            <div className="space-y-3">
              <div className="text-base font-semibold text-gray-900">{value.customer.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-400" /> Email
                  </Label>
                  <Input
                    type="email"
                    value={value.customerEmail}
                    onChange={(e) => onChange({ ...value, customerEmail: e.target.value })}
                    placeholder="customer@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-400" /> Phone
                  </Label>
                  <Input
                    type="tel"
                    value={value.customerPhone}
                    onChange={(e) => onChange({ ...value, customerPhone: e.target.value })}
                    placeholder="(555) 555-5555"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Used for this work order only — won't update the customer record.
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
                  onClick={() => setShowPicker(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Change customer
                </button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {value.customer && branchRequired && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-md">
                <Building2 className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">
                Branch Location <span className="text-red-500">*</span>
              </h2>
            </div>
            <p className="text-xs text-gray-600">
              This customer has multiple branches. Pick the branch this work order is for.
            </p>
            <Select
              value={value.branchName || ""}
              onValueChange={(v) => onChange({ ...value, branchName: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select branch location..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <div className="hidden sm:flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
