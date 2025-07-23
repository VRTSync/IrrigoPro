import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";
import { useState } from "react";
import { Menu, User, LogOut, Settings } from "lucide-react";
import { NotificationSystem } from "@/components/notifications/notification-system";

export default function Navigation() {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    ...(userRole === "irrigation_manager" ? [{ path: "/", label: "Manager Dashboard" }] : []),
    ...(userRole === "field_tech" ? [{ path: "/", label: "Dashboard" }] : []),
    ...(userRole === "admin" || userRole === "irrigation_manager" ? [{ path: "/estimates", label: "Estimates" }] : []),
    { path: "/work-orders", label: "Work Orders" },
    { path: "/billing-sheets", label: "Billing Sheets" },
    ...(userRole === "admin" || userRole === "irrigation_manager" ? [{ path: "/parts", label: "Parts Catalog" }] : []),
    ...(userRole === "admin" || userRole === "irrigation_manager" ? [{ path: "/customers", label: "Customers" }] : []),
    ...(userRole === "admin" ? [{ path: "/field-tech", label: "Field Tech" }] : []),
  ];

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          {/* Mobile Layout: Hamburger + Logo + Account */}
          <div className="flex lg:hidden w-full justify-between items-center">
            {/* Hamburger Menu - Left */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="p-2">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <div className="flex flex-col h-full">
                  {/* Mobile Menu Header */}
                  <div className="px-6 py-4 border-b border-gray-200">
                    <img 
                      src={companyLogo} 
                      alt="Company Logo" 
                      className="h-8 w-auto"
                    />
                  </div>
                  
                  {/* Navigation Items */}
                  <div className="flex-1 py-6">
                    <div className="space-y-1 px-3">
                      {navItems.map((item) => (
                        <Link key={item.path} href={item.path}>
                          <Button
                            variant="ghost"
                            className={`w-full justify-start text-left ${
                              isActive(item.path)
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            }`}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            {item.label}
                          </Button>
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* Mobile Menu Footer */}
                  <div className="border-t border-gray-200 p-4">
                    <div className="flex items-center space-x-3 mb-4">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary text-white">
                          {user.name?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Link href="/user-selector">
                        <Button variant="outline" size="sm" className="w-full">
                          Switch User
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          localStorage.removeItem("user");
                          window.location.href = "/login";
                        }}
                      >
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                      </Button>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {/* Centered Logo Button */}
            <div className="flex-1 flex justify-center relative">
              <Link href="/" className="group relative">
                <div className="bg-white border border-gray-200 shadow-lg rounded-full w-20 h-20 flex items-center justify-center -mt-6 -mb-6 hover:shadow-xl hover:border-gray-300 hover:-mt-7 hover:-mb-7 transition-all duration-200 transform hover:scale-105">
                  <img 
                    src={companyLogo} 
                    alt="Company Logo" 
                    className="max-h-16 max-w-16 w-auto h-auto cursor-pointer object-contain"
                  />
                </div>
                {/* Tooltip */}
                <div className="absolute -bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-50">
                  Dashboard
                </div>
              </Link>
            </div>

            {/* Notifications - Right */}
            <div className="flex items-center">
              <NotificationSystem userId={user.id} />
            </div>
          </div>

          {/* Desktop Layout */}
          <div className="hidden lg:flex w-full justify-between items-center">
            {/* Logo Button */}
            <div className="flex-shrink-0 relative">
              <Link href="/" className="group relative">
                <div className="bg-white border border-gray-200 shadow-lg rounded-full w-24 h-24 flex items-center justify-center -mt-8 -mb-8 hover:shadow-xl hover:border-gray-300 hover:-mt-9 hover:-mb-9 transition-all duration-200 transform hover:scale-105">
                  <img 
                    src={companyLogo} 
                    alt="Company Logo" 
                    className="max-h-20 max-w-20 w-auto h-auto cursor-pointer object-contain"
                  />
                </div>
                {/* Tooltip */}
                <div className="absolute -bottom-16 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-50">
                  ← Back to Dashboard
                </div>
              </Link>
            </div>
            
            {/* Navigation Items */}
            <div className="flex items-center space-x-8">
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

            {/* Desktop User Menu */}
            <div className="flex items-center space-x-2">
              <NotificationSystem userId={user.id} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center space-x-2 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary text-white">
                        {user.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium text-gray-700 hidden xl:block">{user.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-2">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/user-selector" className="w-full">
                      <User className="mr-2 h-4 w-4" />
                      Switch User
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => {
                      localStorage.removeItem("user");
                      window.location.href = "/login";
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
