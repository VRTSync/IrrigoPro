import { useState, useEffect } from "react";
import { safeSet } from "@/utils/safeStorage";
import { Switch, Route } from "wouter";
import { useQuery } from "@tanstack/react-query";
import Navigation from "@/components/layout/navigation";
import AdminDashboard from "@/pages/admin-dashboard";
import Operations from "@/pages/operations";
import CompanyUserManagement from "@/pages/company-user-management";
import CompanyProfile from "@/pages/company-profile";
import QuickBooksPage from "@/pages/quickbooks";
import PartsCatalog from "@/pages/parts-catalog";
import Customers from "@/pages/customers";
import SiteMapsPage from "@/pages/site-maps";
import CustomerSiteMapsPage from "@/pages/customer-site-maps-page";
import CustomerProfile from "@/pages/customer-profile";
import CustomerBilling from "@/pages/customer-billing";
import FieldTech from "@/pages/field-tech";
import BillingSheets from "@/pages/billing-sheets";
import PartsSettings from "@/pages/parts-settings";

import UserProfile from "@/pages/user-profile";
import LicenseAgreement from "@/pages/license-agreement";
import PrivacyPolicy from "@/pages/privacy-policy";
import SwitchUser from "@/pages/switch-user";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import FieldPortal from "@/pages/field-portal";
import NotFound from "@/pages/not-found";
import OnboardingFlow from "@/components/onboarding/onboarding-flow";
import PoweredByFooter from "@/components/layout/powered-by-footer";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "company_admin" | "irrigation_manager" | "field_tech" | "billing_manager";
  companyId?: number | null;
  isActive: boolean;
}

interface CompanyAdminAppProps {
  user: User;
}

export default function CompanyAdminApp({ user }: CompanyAdminAppProps) {
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  // Check if onboarding has been completed
  useEffect(() => {
    const onboardingCompleted = localStorage.getItem("onboarding_completed");
    if (!onboardingCompleted && user.companyId) {
      // Check if company profile exists
      fetch(`/api/company/${user.companyId}/setup-status`, {
        headers: {
          'x-user-role': user.role,
          'x-user-company-id': user.companyId.toString(),
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data.requiresSetup) {
            setNeedsOnboarding(true);
          }
          setIsCheckingSetup(false);
        })
        .catch(() => {
          setNeedsOnboarding(true);
          setIsCheckingSetup(false);
        });
    } else {
      setIsCheckingSetup(false);
    }
  }, [user.companyId, user.role]);

  const handleOnboardingComplete = () => {
    setNeedsOnboarding(false);
    safeSet("onboarding_completed", "true");
  };

  // Show loading while checking setup
  if (isCheckingSetup) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show onboarding flow if needed
  if (needsOnboarding && user.companyId) {
    return (
      <OnboardingFlow
        companyId={user.companyId}
        currentUser={user}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  // Regular company admin app
  return (
    <div className="min-h-screen pb-20 lg:pb-0 flex flex-col">
      <Navigation />
      <div className="px-4 bg-gray-50 flex-1">
        <Switch>
          <Route path="/" component={AdminDashboard} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/operations" component={Operations} />
          <Route path="/users" component={CompanyUserManagement} />
          <Route path="/company-profile" component={CompanyProfile} />
          <Route path="/quickbooks" component={QuickBooksPage} />
          <Route path="/parts" component={PartsCatalog} />
          <Route path="/parts-settings" component={PartsSettings} />
          <Route path="/customers" component={Customers} />
          <Route path="/customers/:id/profile" component={CustomerProfile} />
          <Route path="/customers/:customerId/site-maps" component={CustomerSiteMapsPage} />
          <Route path="/site-maps" component={SiteMapsPage} />
          <Route path="/customer-billing" component={CustomerBilling} />
          <Route path="/field-tech" component={FieldTech} />
          <Route path="/billing-sheets" component={BillingSheets} />
          <Route path="/user-profile" component={UserProfile} />
          <Route path="/switch-user" component={SwitchUser} />
          <Route path="/license-agreement" component={LicenseAgreement} />
          <Route path="/privacy-policy" component={PrivacyPolicy} />
          <Route path="/login" component={Login} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/field-portal" component={FieldPortal} />
          {/* Redirect estimates and work-orders to operations page */}
          <Route path="/estimates" component={Operations} />
          <Route path="/work-orders" component={Operations} />
          <Route component={NotFound} />
        </Switch>
      </div>
      <PoweredByFooter />
    </div>
  );
}