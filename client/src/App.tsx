import { Switch, Route } from "wouter";
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
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/estimates" component={Estimates} />
      <Route path="/parts" component={PartsCatalog} />
      <Route path="/customers" component={Customers} />
      <Route path="/field-tech" component={FieldTech} />
      <Route path="/work-orders" component={WorkOrders} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-gray-50">
          <Navigation />
          <Router />
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
