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
import Customers from "@/pages/customers";
import FieldTech from "@/pages/field-tech";
import WorkOrders from "@/pages/work-orders";
import Login from "@/pages/login";
import FieldPortal from "@/pages/field-portal";
import NotFound from "@/pages/not-found";
import ManagerDashboard from "@/pages/manager-dashboard";
import FieldTechDashboard from "@/pages/field-tech-dashboard";
import BillingSheets from "@/pages/billing-sheets";
import CustomerBilling from "@/pages/customer-billing";
import AdminDashboard from "@/pages/admin-dashboard";
import Operations from "@/pages/operations";
import { UserSelector } from "@/components/user-selector";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "admin" | "irrigation_manager" | "field_tech" | "billing_manager";
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
            const response = await fetch('/api/users');
            if (response.ok) {
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
            } else {
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
            <Route path="/login" component={Login} />
            <Route path="/user-selector" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
            <Route path="/" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
            <Route component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
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
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0">
            <Navigation />
            <div className="px-4 py-6">
              <Switch>
                <Route path="/" component={FieldTechDashboard} />
                <Route path="/field-tech" component={FieldTechDashboard} />
                <Route path="/field-portal" component={FieldPortal} />
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/user-selector" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
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
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0">
            <Navigation />
            <div className="px-4 py-6">
              <Switch>
                <Route path="/" component={ManagerDashboard} />
                <Route path="/manager" component={ManagerDashboard} />
                <Route path="/estimates" component={Estimates} />
                <Route path="/parts" component={PartsCatalog} />
                <Route path="/work-orders" component={WorkOrders} />
                <Route path="/customers" component={Customers} />
                <Route path="/billing-sheets" component={BillingSheets} />
                <Route path="/user-selector" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
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
          <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0">
            <Navigation />
            <div className="px-4 py-6">
              <Switch>
                <Route path="/" component={CustomerBilling} />
                <Route path="/customers" component={CustomerBilling} />
                <Route path="/customer-billing" component={CustomerBilling} />
                <Route path="/user-selector" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
                <Route path="/login" component={Login} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </div>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    );
  }

  // Admin gets access to admin-specific dashboard only
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-gray-50 pb-20 lg:pb-0">
          <Navigation />
          <div className="px-4 py-6">
            <Switch>
              <Route path="/" component={AdminDashboard} />
              <Route path="/admin" component={AdminDashboard} />
              <Route path="/operations" component={Operations} />
              <Route path="/estimates" component={Estimates} />
              <Route path="/parts" component={PartsCatalog} />
              <Route path="/customers" component={Customers} />
              <Route path="/customer-billing" component={CustomerBilling} />
              <Route path="/field-tech" component={FieldTech} />
              <Route path="/work-orders" component={WorkOrders} />
              <Route path="/billing-sheets" component={BillingSheets} />
              <Route path="/user-selector" component={() => <UserSelector onUserSelect={setUser} currentUser={user} />} />
              <Route path="/login" component={Login} />
              <Route path="/field-portal" component={FieldPortal} />
              <Route component={NotFound} />
            </Switch>
          </div>
        </div>
        <Toaster />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

function App() {
  return <Router />;
}

export default App;
