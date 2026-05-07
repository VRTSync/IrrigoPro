// Work Order Wizard location step is now powered by the shared wizard
// location step under client/src/components/wizard-shared/, so the Work
// Order Wizard and the Billing Sheet Wizard cannot drift on map pin /
// controller logic. This file re-exports the shared component under the
// previous names so existing imports keep working.

import {
  WizardLocationStep,
  type WizardLocationValue,
  type WorkLocation,
} from "@/components/wizard-shared/wizard-location-step";

export type LocationStepValue = WizardLocationValue;
export type { WorkLocation };
export const WoLocationStep = WizardLocationStep;
