import { Switch, Route } from "wouter";
import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navigation from "@/components/layout/navigation";
import Dashboard from "@/pages/dashboard";
import Estimates from "@/pages/estimates";
import PartsCatalog from "@/pages/parts-catalog";
import PartsList from "@/pages/parts-list";
import Customers from "@/pages/customers";
import FieldTech from "@/pages/field-tech";
import WorkOrders from "@/pages/work-orders";
import Login from "@/pages/login";
import SimpleLogin from "@/pages/simple-login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import FieldPortal from "@/pages/field-portal";
import NotFound from "@/pages/not-found";
import ManagerDashboard from "@/pages/manager-dashboard";
import FieldTechDashboard from "@/pages/field-tech-dashboard";
import BillingSheets from "@/pages/billing-sheets";
import CustomerBilling from "@/pages/customer-billing";
import QuickBooksPage from "@/pages/quickbooks";
import AdminDashboard from "@/pages/admin-dashboard";
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

import SiteMapsPage from "@/pages/site-maps";
import FieldTechMaps from "@/pages/field-tech-maps";
import { NotificationPermissionBanner } from "@/components/notifications/notification-permission-banner";
import CompanyAdminApp from "@/components/company-admin-app";
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



function Router() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for saved user in localStorage and force refresh
    const refreshUserSession = async () => {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        try {
          const userData = JSON.parse(savedUser);
          console.log("Found saved user:", userData);
          
          // Force refresh user data from API
          try {
            const response = await fetch('/api/users', {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include'
            });
            
            if (response.ok) {
              try {
                const users = await response.json();
                const updatedUser = users.find((u: any) => u.username === userData.username);
                if (updatedUser) {
                  localStorage.setItem("user", JSON.stringify(updatedUser));
                  setUser(updatedUser);
                  console.log("Updated user session:", updatedUser);
                } else {
                  // If user not found with current username, clear session
                  localStorage.removeItem("user");
                  setUser(null);
                }
              } catch (jsonError) {
                console.error("Error parsing user JSON response:", jsonError);
                setUser(userData);
              }
            } else {
              console.warn(`User fetch failed with status: ${response.status}`);
              setUser(userData);
            }
          } catch (apiError) {
            console.error("Error fetching updated user:", apiError);
            setUser(userData);
          }
        } catch (error) {
          console.error("Error parsing user data:", error);
          localStorage.removeItem("user");
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

  // If no user is logged in, show user selector instead of login
  if (!user) {
    return (
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <Switch>
            <Route path="/login" component={SimpleLogin} />
            <Route path="/old-login" component={Login} />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/license-agreement" component={LicenseAgreement} />
            <Route path="/" component={SimpleLogin} />
            <Route component={SimpleLogin} />
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
                <Route path="/customers" component={Customers} />
                <Route path="/customers/:customerId/site-maps" component={SiteMapsPage} />
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
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/customers" component={Customers} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/site-maps" component={SiteMapsPage} />
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
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0 flex flex-col">
            <Navigation />
            <div className="px-4 flex-1">
              <Switch>
                <Route path="/" component={CustomerBilling} />
                <Route path="/billing" component={CustomerBilling} />
                <Route path="/customers" component={CustomerBilling} />
                <Route path="/quickbooks" component={QuickBooksPage} />
                <Route path="/customer-billing" component={CustomerBilling} />
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
                <Route path="/system-users" component={SystemUserManagement} />
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
              <Route path="/customer-billing" component={CustomerBilling} />
              <Route path="/field-tech" component={FieldTech} />
              <Route path="/billing-sheets" component={BillingSheets} />
              <Route path="/user-manager" component={UserManager} />
              <Route path="/user-profile" component={UserProfile} />
              <Route path="/license-agreement" component={LicenseAgreement} />
              <Route path="/privacy-policy" component={PrivacyPolicy} />
              <Route path="/login" component={Login} />
              <Route path="/field-portal" component={FieldPortal} />
              {/* Redirect estimates and work-orders to operations page */}
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
  return <Router />;
}

export default App;
