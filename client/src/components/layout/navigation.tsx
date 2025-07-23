import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";
import { useState } from "react";
import { Home, FileText, Package, Users, Wrench, ClipboardList, Calculator, UserCheck, Settings, LogOut, User } from "lucide-react";
import { NotificationSystem } from "@/components/notifications/notification-system";

export default function Navigation() {
  const [location] = useLocation();

  const isActive = (path: string) => {  
    if (path === "/" && location === "/") return true;
    if (path !== "/" && location.startsWith(path)) return true;
    return false;
  };

  // Get current user role from localStorage
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userRole = user.role;

  // Define navigation items based on user role
  const getNavItems = () => {
    switch (userRole) {
      case "admin":
        return [
          { path: "/operations", label: "Operations", icon: FileText },
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/parts", label: "Parts", icon: Package },
          { path: "/admin", label: "Users", icon: Settings },
        ];
      case "irrigation_manager":
        return [
          { path: "/estimates", label: "Estimates", icon: FileText },
          { path: "/work-orders", label: "Work Orders", icon: Wrench },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/billing-sheets", label: "Billing", icon: ClipboardList },
          { path: "/customers", label: "Customers", icon: Users },
        ];
      case "field_tech":
        return [
          { path: "/work-orders", label: "Work Orders", icon: Wrench },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/billing-sheets", label: "Billing", icon: ClipboardList },
        ];
      case "billing_manager":
        return [
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  return (
    <>
      {/* Desktop Navigation - Top */}
      <nav className="hidden lg:block bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo Button */}
            <div className="flex-shrink-0">
              <Link href="/">
                <div className="bg-white border border-gray-200 shadow-lg rounded-full w-12 h-12 flex items-center justify-center hover:shadow-xl hover:border-gray-300 transition-all duration-200 transform hover:scale-105">
                  <img 
                    src={companyLogo} 
                    alt="Company Logo" 
                    className="max-h-8 max-w-8 w-auto h-auto cursor-pointer object-contain"
                  />
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
                    <span className="hidden sm:block text-sm font-medium">{user.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <Link href="/user-selector">
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      Switch User
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuItem
                    onClick={() => {
                      localStorage.removeItem("user");
                      window.location.href = "/login";
                    }}
                    className="text-red-600"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Bottom */}
      <div className="lg:hidden m-0 p-0">
        {/* Top Bar with Logo and Notifications */}
        <div className="bg-white shadow-sm border-b border-gray-200 m-0 p-0">
          <div className="flex justify-between items-center h-16 px-4">
            {/* Logo */}
            <div className="flex items-center">
              <img 
                src={companyLogo} 
                alt="Company Logo" 
                className="h-10 w-auto"
              />
            </div>

            {/* User Menu and Notifications */}
            <div className="flex items-center space-x-2">
              <NotificationSystem userId={user.id} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary text-white">
                        {user.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <Link href="/user-selector">
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      Switch User
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuItem
                    onClick={() => {
                      localStorage.removeItem("user");
                      window.location.href = "/login";
                    }}
                    className="text-red-600"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Bottom Navigation Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
          <div className="relative flex justify-around items-center py-2">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              const isCenter = item.isCenter;
              
              if (isCenter) {
                return (
                  <div key={item.path} className="flex-1 flex justify-center">
                    <Link href={item.path}>
                      <div className="relative">
                        <Button
                          variant="ghost"
                          className={`flex flex-col items-center justify-center w-20 h-20 rounded-lg -mt-10 border-4 border-white shadow-lg px-2 py-2 ${
                            active
                              ? "bg-primary text-white hover:bg-primary/90"
                              : "bg-white text-primary hover:bg-gray-50 border-gray-200"
                          }`}
                        >
                          <Icon className="h-6 w-6" />
                          <span className="text-xs font-medium mt-1 leading-tight">{item.label}</span>
                        </Button>
                      </div>
                    </Link>
                  </div>
                );
              }
              
              return (
                <Link key={item.path} href={item.path} className="flex-1">
                  <Button
                    variant="ghost"
                    className={`flex flex-col items-center justify-center w-full h-16 space-y-1 ${
                      active
                        ? "text-primary bg-primary/10"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-medium">{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>


      </div>
    </>
  );
}