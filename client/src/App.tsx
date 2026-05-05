import { Switch, Route, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { safeGet, safeRemove } from "@/utils/safeStorage";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navigation from "@/components/layout/navigation";
import { clearStaleCache } from "@/utils/clearStaleCache";
import Dashboard from "@/pages/dashboard";
import Estimates from "@/pages/estimates";
import PartsCatalog from "@/pages/parts-catalog";
import PartsList from "@/pages/parts-list";
import Customers from "@/pages/customers";
import FieldTech from "@/pages/field-tech";
import WorkOrders from "@/pages/work-orders";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import FieldPortal from "@/pages/field-portal";
import NotFound from "@/pages/not-found";
import ManagerDashboard from "@/pages/manager-dashboard";
import FieldTechDashboard from "@/pages/field-tech-dashboard";
import BillingSheets from "@/pages/billing-sheets";
import MissingPhotosReport from "@/pages/missing-photos-report";
import WorkOrdersMissingPhotosReport from "@/pages/work-orders-missing-photos-report";
import BillingZeroPriceAuditPage from "@/pages/billing-zero-price-audit";
import AdminIssueTypesPage from "@/pages/admin-issue-types";
import LaborRateAuditPage from "@/pages/labor-rate-audit";
import CustomerBilling from "@/pages/customer-billing";
import QuickBooksPage from "@/pages/quickbooks";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminControllers from "@/pages/admin-controllers";
import Operations from "@/pages/operations";
import SuperAdminDashboard from "@/pages/super-admin-dashboard";
import SystemUserManagement from "@/pages/system-user-management";
import CompanyUserManagement from "@/pages/company-user-management";
import CompanyProfile from "@/pages/company-profile";
import UserProfile from "@/pages/user-profile";
import UserManager from "@/pages/UserManager";
import LicenseAgreement from "@/pages/license-agreement";
import PrivacyPolicy from "@/pages/privacy-policy";
import SwitchUser from "@/pages/switch-user";
import CustomerProfile from "@/pages/customer-profile";
import EstimateApproval from "@/pages/estimate-approval";
import PartsSettings from "@/pages/parts-settings";
import PartsPendingApproval from "@/pages/parts-pending-approval";
import EstimatesPendingApproval from "@/pages/estimates-pending-approval";
import BillingDashboard from "@/pages/billing-dashboard";
import InvoicesPage from "@/pages/invoices";
import WetChecksPage from "@/pages/wet-checks";
import AdminWetChecksPage from "@/pages/admin-wet-checks";
import WetCheckReviewPage from "@/pages/wet-check-review";
import ManagerWetChecksPage from "@/pages/manager-wet-checks";
import { WetCheckConfirm } from "@/components/manager/wet-check-confirm";
import { WetCheckDone } from "@/components/manager/wet-check-done";

import SiteMapsPage from "@/pages/site-maps";
import CustomerSiteMapsPage from "@/pages/customer-site-maps-page";
import FieldTechMaps from "@/pages/field-tech-maps";
import { NotificationPermissionBanner } from "@/components/notifications/notification-permission-banner";
import CompanyAdminApp from "@/components/company-admin-app";
import PoweredByFooter from "@/components/layout/powered-by-footer";
import { DesktopShell } from "@/components/layout/desktop-shell";
import { billingManagerNav } from "@/components/layout/nav-config";
import { ServiceWorkerRegistration, ServiceWorkerUpdatePrompt } from "@/components/offline/service-worker-update-prompt";
import { ConflictToastBridge } from "@/components/offline/conflict-toast-bridge";


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



function Router() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Clear stale cache on app startup
    clearStaleCache();
    
    // Check for saved user in localStorage and validate session
    const refreshUserSession = async () => {
      const savedUser = safeGet("user");
      if (savedUser) {
        try {
          const userData = JSON.parse(savedUser);
          // Production user session initialization
          setUser(userData);
        } catch (error) {
          console.error("Error parsing user data:", error);
          safeRemove("user");
        }
      } else {
        console.log("No saved user found");
      }
      setIsLoading(false);
    };
    
    refreshUserSession();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If no user is logged in, show the original login design
  if (!user) {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <Switch>
            <Route path="/login" component={Login} />

            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/estimate-approval/:token" component={EstimateApproval} />
            <Route path="/license-agreement" component={LicenseAgreement} />
            <Route path="/" component={Login} />
            <Route component={Login} />
          </Switch>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Field tech gets simplified dashboard
  if (user.role === "field_tech") {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0 flex flex-col">
            <Navigation />
            <div className="px-4 flex-1">
              <Switch>
                <Route path="/" component={FieldTechDashboard} />
                <Route path="/field-tech" component={FieldTechDashboard} />
                <Route path="/field-portal" component={FieldPortal} />
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/wet-checks" component={WetChecksPage} />
                <Route path="/wet-checks/c/:clientId" component={WetChecksPage} />
                <Route path="/wet-checks/:id" component={WetChecksPage} />
                <Route path="/customers" component={Customers} />
                <Route path="/customers/:id/profile" component={CustomerProfile} />
                <Route path="/customers/:customerId/site-maps" component={CustomerSiteMapsPage} />
                <Route path="/site-maps" component={FieldTechMaps} />
                <Route path="/switch-user" component={SwitchUser} />
                <Route path="/user-profile" component={UserProfile} />
                <Route path="/license-agreement" component={LicenseAgreement} />
                <Route path="/privacy-policy" component={PrivacyPolicy} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
            <PoweredByFooter />
          </div>
          <ServiceWorkerUpdatePrompt />
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Irrigation manager gets access to specific pages
  if (user.role === "irrigation_manager") {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0 flex flex-col">
            <Navigation />
            <div className="px-4 flex-1">
              <Switch>
                <Route path="/" component={ManagerDashboard} />
                <Route path="/manager" component={ManagerDashboard} />
                <Route path="/estimates" component={Estimates} />
                <Route path="/parts" component={PartsCatalog} />
                <Route path="/parts-list" component={PartsList} />
                <Route path="/parts-settings" component={PartsSettings} />
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/customers" component={Customers} />
                <Route path="/customers/:id/profile" component={CustomerProfile} />
                <Route path="/customers/:customerId/site-maps" component={CustomerSiteMapsPage} />
                <Route path="/site-maps" component={SiteMapsPage} />
                <Route path="/work-orders/missing-photos" component={WorkOrdersMissingPhotosReport} />
                <Route path="/billing-sheets/missing-photos" component={MissingPhotosReport} />
                <Route path="/billing-sheets/zero-price-audit" component={BillingZeroPriceAuditPage} />
                <Route path="/billing-sheets/labor-rate-audit" component={LaborRateAuditPage} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/admin/issue-types" component={AdminIssueTypesPage} />
                <Route path="/manager/wet-checks" component={ManagerWetChecksPage} />
                <Route path="/manager/wet-checks/:id/confirm">
                  {(params) => <WetCheckConfirm id={parseInt(params.id)} />}
                </Route>
                <Route path="/manager/wet-checks/:id/done">
                  {(params) => <WetCheckDone id={parseInt(params.id)} />}
                </Route>
                <Route path="/manager/wet-checks/:id" component={WetCheckReviewPage} />
                <Route path="/wet-checks/admin" component={AdminWetChecksPage} />
                <Route path="/wet-checks/pending-review" component={WetCheckReviewPage} />
                <Route path="/wet-checks/:id/review" component={WetCheckReviewPage} />
                <Route path="/wet-checks" component={WetChecksPage} />
                <Route path="/wet-checks/c/:clientId" component={WetChecksPage} />
                <Route path="/wet-checks/:id" component={WetChecksPage} />
                <Route path="/switch-user" component={SwitchUser} />
                <Route path="/user-profile" component={UserProfile} />
                <Route path="/license-agreement" component={LicenseAgreement} />
                <Route path="/privacy-policy" component={PrivacyPolicy} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
            <PoweredByFooter />
          </div>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Billing manager gets customer billing interface
  if (user.role === "billing_manager") {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <DesktopShell navConfig={billingManagerNav}>
            <div className="px-4">
              <Switch>
                <Route path="/" component={BillingDashboard} />
                <Route path="/billing" component={BillingDashboard} />
                <Route path="/billing/dashboard" component={BillingDashboard} />
                <Route path="/billing/command-center" component={CustomerBilling} />
                <Route path="/customer-billing" component={RedirectToCommandCenter} />
                <Route path="/customers" component={Customers} />
                <Route path="/customers/:id/profile" component={CustomerProfile} />
                <Route path="/work-orders/missing-photos" component={WorkOrdersMissingPhotosReport} />
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/billing-sheets/missing-photos" component={MissingPhotosReport} />
                <Route path="/billing-sheets/zero-price-audit" component={BillingZeroPriceAuditPage} />
                <Route path="/billing-sheets/labor-rate-audit" component={LaborRateAuditPage} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/wet-checks/pending-review" component={WetCheckReviewPage} />
                <Route path="/wet-checks/:id/review" component={WetCheckReviewPage} />
                <Route path="/wet-checks" component={WetChecksPage} />
                <Route path="/wet-checks/c/:clientId" component={WetChecksPage} />
                <Route path="/wet-checks/:id" component={WetChecksPage} />
                <Route path="/parts" component={PartsCatalog} />
                <Route path="/parts-settings" component={PartsSettings} />
                <Route path="/parts-pending-approval" component={PartsPendingApproval} />
                <Route path="/estimates/pending-approval" component={EstimatesPendingApproval} />
                <Route path="/quickbooks" component={QuickBooksPage} />
                <Route path="/invoices" component={InvoicesPage} />
                <Route path="/admin/issue-types" component={AdminIssueTypesPage} />
                <Route path="/switch-user" component={SwitchUser} />
                <Route path="/user-profile" component={UserProfile} />
                <Route path="/license-agreement" component={LicenseAgreement} />
                <Route path="/privacy-policy" component={PrivacyPolicy} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </DesktopShell>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Super Admin gets system-wide access
  if (user.role === "super_admin") {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen pb-20 lg:pb-0 flex flex-col">
            <Navigation />
            <div className="px-4 bg-gray-50 flex-1">
              <Switch>
                <Route path="/" component={SuperAdminDashboard} />
                <Route path="/super-admin" component={SuperAdminDashboard} />
                <Route path="/manager/wet-checks" component={ManagerWetChecksPage} />
                <Route path="/manager/wet-checks/:id/confirm">
                  {(params) => <WetCheckConfirm id={parseInt(params.id)} />}
                </Route>
                <Route path="/manager/wet-checks/:id/done">
                  {(params) => <WetCheckDone id={parseInt(params.id)} />}
                </Route>
                <Route path="/manager/wet-checks/:id" component={WetCheckReviewPage} />
                <Route path="/wet-checks/pending-review" component={WetCheckReviewPage} />
                <Route path="/wet-checks/:id/review" component={WetCheckReviewPage} />
                <Route path="/wet-checks" component={WetChecksPage} />
                <Route path="/wet-checks/c/:clientId" component={WetChecksPage} />
                <Route path="/wet-checks/:id" component={WetChecksPage} />
                <Route path="/system-users" component={SystemUserManagement} />
                <Route path="/admin/controllers" component={AdminControllers} />
                <Route path="/user-manager" component={UserManager} />
                <Route path="/switch-user" component={SwitchUser} />
                <Route path="/user-profile" component={UserProfile} />
                <Route path="/license-agreement" component={LicenseAgreement} />
                <Route path="/privacy-policy" component={PrivacyPolicy} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
            <PoweredByFooter />
          </div>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Company Admin gets access to company-specific dashboard and management
  if (user.role === "company_admin") {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <CompanyAdminApp user={user} />
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Default fallback - treat as regular admin
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen pb-20 lg:pb-0 flex flex-col">
          <Navigation />
          <div className="px-4 bg-gray-50 flex-1">
            <Switch>
              <Route path="/" component={AdminDashboard} />
              <Route path="/admin" component={AdminDashboard} />
              <Route path="/operations" component={Operations} />
              <Route path="/parts" component={PartsCatalog} />
              <Route path="/customers" component={Customers} />
              <Route path="/site-maps" component={SiteMapsPage} />
              <Route path="/admin/controllers" component={AdminControllers} />
              <Route path="/customer-billing" component={CustomerBilling} />
              <Route path="/field-tech" component={FieldTech} />
              <Route path="/billing-sheets/zero-price-audit" component={BillingZeroPriceAuditPage} />
              <Route path="/billing-sheets/labor-rate-audit" component={LaborRateAuditPage} />
              <Route path="/billing-sheets" component={BillingSheets} />
              <Route path="/wet-checks/pending-review" component={WetCheckReviewPage} />
              <Route path="/wet-checks/:id/review" component={WetCheckReviewPage} />
              <Route path="/wet-checks" component={WetChecksPage} />
              <Route path="/wet-checks/c/:clientId" component={WetChecksPage} />
              <Route path="/wet-checks/:id" component={WetChecksPage} />
              <Route path="/user-manager" component={UserManager} />
              <Route path="/user-profile" component={UserProfile} />
              <Route path="/license-agreement" component={LicenseAgreement} />
              <Route path="/privacy-policy" component={PrivacyPolicy} />
              <Route path="/login" component={Login} />
              <Route path="/field-portal" component={FieldPortal} />
              {/* Redirect estimates and work-orders to operations page */}
              <Route path="/estimates/pending-approval" component={EstimatesPendingApproval} />
              <Route path="/estimates" component={Operations} />
              <Route path="/work-orders" component={Operations} />
              <Route component={NotFound} />
            </Switch>
          </div>
          <PoweredByFooter />
        </div>
        <NotificationPermissionBanner />
        <Toaster />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

function App() {
  return (
    <>
      <ServiceWorkerRegistration />
      <ConflictToastBridge />
      <Router />
    </>
  );
}

export default App;
