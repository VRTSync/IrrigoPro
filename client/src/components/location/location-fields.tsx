import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Key } from "lucide-react";
import { Control } from "react-hook-form";

interface LocationFieldsProps {
  control: Control<any>;
  prefix?: string;
}

export function LocationFields({ control, prefix = "" }: LocationFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 mb-2">
        <MapPin className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-medium text-gray-900">Location Information</h3>
      </div>
      
      <FormField
        control={control}
        name={`${prefix}projectAddress`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Property Address</FormLabel>
            <FormControl>
              <Input 
                {...field} 
                placeholder="123 Main St, City, State 12345"
                className="w-full"
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
            <FormLabel>Location Details</FormLabel>
            <FormControl>
              <Textarea 
                {...field} 
                placeholder="Additional location information, landmarks, or special notes..."
                className="w-full min-h-[80px]"
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
            <FormLabel className="flex items-center space-x-1">
              <Key className="w-3 h-3" />
              <span>Access Instructions</span>
            </FormLabel>
            <FormControl>
              <Textarea 
                {...field} 
                placeholder="How to access the property (gate codes, key location, contact info, etc.)"
                className="w-full min-h-[80px]"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}