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

interface User {
  id: string;
  name: string;
  role: "admin" | "irrigation_manager" | "field_tech";
  isActive: boolean;
}

function Router() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for saved user in localStorage
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        console.log("Found saved user:", userData);
        setUser(userData);
      } catch (error) {
        console.error("Error parsing user data:", error);
        localStorage.removeItem("user");
      }
    } else {
      console.log("No saved user found");
    }
    setIsLoading(false);
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

  // If no user is logged in, show login page
  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/" component={Login} />
        <Route component={Login} />
      </Switch>
    );
  }

  // Field tech gets simplified dashboard
  if (user.role === "field_tech") {
    return (
      <Switch>
        <Route path="/" component={FieldTechDashboard} />
        <Route path="/field-tech" component={FieldTechDashboard} />
        <Route path="/login" component={Login} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // Irrigation manager gets access to specific pages with navigation
  if (user.role === "irrigation_manager") {
    return (
      <div>
        <Navigation />
        <Switch>
          <Route path="/" component={ManagerDashboard} />
          <Route path="/manager" component={ManagerDashboard} />
          <Route path="/estimates" component={Estimates} />
          <Route path="/parts" component={PartsCatalog} />
          <Route path="/work-orders" component={WorkOrders} />
          <Route path="/customers" component={Customers} />
          <Route path="/login" component={Login} />
          <Route component={NotFound} />
        </Switch>
      </div>
    );
  }

  // Admin gets full access to the system
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/estimates" component={Estimates} />
      <Route path="/parts" component={PartsCatalog} />
      <Route path="/customers" component={Customers} />
      <Route path="/field-tech" component={FieldTech} />
      <Route path="/work-orders" component={WorkOrders} />
      <Route path="/login" component={Login} />
      <Route path="/field-portal" component={FieldPortal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
      } catch (error) {
        console.error("Error parsing user data:", error);
        localStorage.removeItem("user");
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-gray-50">
          {/* Show navigation for admin and irrigation_manager users */}
          {(user?.role === "admin" || user?.role === "irrigation_manager") && <Navigation />}
          <Router />
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
