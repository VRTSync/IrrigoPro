import { Link, useLocation } from "wouter";
import { Bell, Droplets, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";

export default function Navigation() {
  const [location] = useLocation();
  const isMobile = useIsMobile();

  const isActive = (path: string) => {
    if (path === "/" && location === "/") return true;
    if (path !== "/" && location.startsWith(path)) return true;
    return false;
  };

  // Get current user role from localStorage
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userRole = user.role;

  const navItems = [
    ...(userRole === "admin" ? [{ path: "/", label: "Dashboard" }] : []),
    ...(userRole === "admin" ? [{ path: "/estimates", label: "Estimates" }] : []),
    { path: "/work-orders", label: "Work Orders" },
    ...(userRole === "admin" ? [{ path: "/parts", label: "Parts Catalog" }] : []),
    { path: "/customers", label: "Customers" },
    ...(userRole === "admin" ? [{ path: "/field-tech", label: "Field Tech" }] : []),
  ];

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <img 
                  src={companyLogo} 
                  alt="Company Logo" 
                  className="h-10 w-auto mr-3"
                />
              </div>
            </div>
            
            {!isMobile && (
              <div className="hidden md:flex items-center space-x-8">
                {navItems.map((item) => (
                  <Link key={item.path} href={item.path}>
                    <Button
                      variant="ghost"
                      className={`font-medium ${
                        isActive(item.path)
                          ? "text-primary border-b-2 border-primary rounded-none hover:bg-transparent"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </div>
            )}

            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700 relative">
                <Bell className="h-5 w-5" />
                <Badge 
                  variant="destructive" 
                  className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-xs"
                >
                  3
                </Badge>
              </Button>
              <div className="flex items-center space-x-2">
                <img 
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=100&h=100" 
                  alt="User avatar" 
                  className="h-8 w-8 rounded-full"
                />
                <span className="text-sm font-medium text-gray-700">Admin User</span>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    localStorage.removeItem("user");
                    window.location.href = "/login";
                  }}
                  className="ml-2 text-gray-500 hover:text-gray-700"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {isMobile && (
        <div className="md:hidden bg-white border-b border-gray-200">
          <div className="px-4 py-2 flex space-x-4 overflow-x-auto">
            {navItems.map((item) => (
              <Link key={item.path} href={item.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`font-medium whitespace-nowrap ${
                    isActive(item.path)
                      ? "text-primary border-b-2 border-primary rounded-none hover:bg-transparent"
                      : "text-gray-500"
                  }`}
                >
                  {item.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
