import { useState, useEffect } from "react";
import { safeSet } from "@/utils/safeStorage";
import { Switch, Route, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DesktopShell } from "@/components/layout/desktop-shell";
import { companyAdminNav } from "@/components/layout/nav-config";
import InvoicesPage from "@/pages/invoices";
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
import BillingDashboard from "@/pages/billing-dashboard";
import FieldTech from "@/pages/field-tech";
import BillingSheets from "@/pages/billing-sheets";
import WorkOrders from "@/pages/work-orders";
import WetChecksPage from "@/pages/wet-checks";
import WetCheckReviewPage from "@/pages/wet-check-review";
import AdminWetChecksPage from "@/pages/admin-wet-checks";
import ManagerWetChecksPage from "@/pages/manager-wet-checks";
import AdminIssueTypesPage from "@/pages/admin-issue-types";
import AdminClientErrorsPage from "@/pages/admin-client-errors";
import BillingZeroPriceAuditPage from "@/pages/billing-zero-price-audit";
import LaborRateAuditPage from "@/pages/labor-rate-audit";
import MissingPhotosReport from "@/pages/missing-photos-report";
import WorkOrdersMissingPhotosReport from "@/pages/work-orders-missing-photos-report";
import PartsSettings from "@/pages/parts-settings";
import LaborRates from "@/pages/labor-rates";
import AdminCustomers from "@/pages/admin-customers";
import AdminControllers from "@/pages/admin-controllers";
import PartsPendingApproval from "@/pages/parts-pending-approval";
import EstimatesPendingApproval from "@/pages/estimates-pending-approval";

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

function RedirectToCommandCenter() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/billing/command-center"); }, [navigate]);
  return null;
}

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
    <DesktopShell navConfig={companyAdminNav}>
      <div className="px-4 bg-gray-50">
        <Switch>
          <Route path="/" component={AdminDashboard} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/operations" component={Operations} />
          <Route path="/users" component={CompanyUserManagement} />
          <Route path="/company-profile" component={CompanyProfile} />
          <Route path="/quickbooks" component={QuickBooksPage} />
          <Route path="/invoices" component={InvoicesPage} />
          <Route path="/parts-pending-approval" component={PartsPendingApproval} />
          <Route path="/estimates/pending-approval" component={EstimatesPendingApproval} />
          <Route path="/parts" component={PartsCatalog} />
          <Route path="/parts-settings" component={PartsSettings} />
          <Route path="/labor-rates" component={LaborRates} />
          <Route path="/admin/customers" component={AdminCustomers} />
          <Route path="/admin/controllers" component={AdminControllers} />
          <Route path="/customers" component={Customers} />
          <Route path="/customers/:id/profile" component={CustomerProfile} />
          <Route path="/customers/:customerId/site-maps" component={CustomerSiteMapsPage} />
          <Route path="/site-maps" component={SiteMapsPage} />
          <Route path="/billing" component={BillingDashboard} />
          <Route path="/billing/dashboard" component={BillingDashboard} />
          <Route path="/billing/command-center" component={CustomerBilling} />
          <Route path="/customer-billing" component={RedirectToCommandCenter} />
          <Route path="/field-tech" component={FieldTech} />
          <Route path="/work-orders/missing-photos" component={WorkOrdersMissingPhotosReport} />
          <Route path="/billing-sheets/missing-photos" component={MissingPhotosReport} />
          <Route path="/billing-sheets/zero-price-audit" component={BillingZeroPriceAuditPage} />
          <Route path="/billing-sheets/labor-rate-audit" component={LaborRateAuditPage} />
          <Route path="/billing-sheets" component={BillingSheets} />
          <Route path="/manager/wet-checks" component={ManagerWetChecksPage} />
          <Route path="/manager/wet-checks/:id" component={WetCheckReviewPage} />
          <Route path="/wet-checks/admin" component={AdminWetChecksPage} />
          <Route path="/admin/issue-types" component={AdminIssueTypesPage} />
          <Route path="/admin/client-errors" component={AdminClientErrorsPage} />
          <Route path="/wet-checks/pending-review" component={WetCheckReviewPage} />
          <Route path="/wet-checks/:id/review" component={WetCheckReviewPage} />
          <Route path="/wet-checks" component={WetChecksPage} />
          <Route path="/wet-checks/:id" component={WetChecksPage} />
          <Route path="/work-orders" component={WorkOrders} />
          <Route path="/user-profile" component={UserProfile} />
          <Route path="/switch-user" component={SwitchUser} />
          <Route path="/license-agreement" component={LicenseAgreement} />
          <Route path="/privacy-policy" component={PrivacyPolicy} />
          <Route path="/login" component={Login} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/field-portal" component={FieldPortal} />
          {/* Estimates still routes through the Operations page */}
          <Route path="/estimates" component={Operations} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </DesktopShell>
  );
}