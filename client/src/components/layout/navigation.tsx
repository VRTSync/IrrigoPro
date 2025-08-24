import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  User, 
  LogOut, 
  Home,
  FileText,
  Users,
  Settings,
  ClipboardList,
  Wrench,
  Package,
  MapPin,
  UserCog,
  Building2,
  ChevronDown,
  DollarSign
} from "lucide-react";
import irrigoProLogo from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { NotificationSystem } from "@/components/notifications/notification-system";
import { useQuery } from "@tanstack/react-query";

// Company banner component to show logo from company profile
function CompanyLogoBanner({ companyId }: { companyId: number }) {
  const { data: companyProfile } = useQuery({
    queryKey: [`/api/company/${companyId}/profile`],
  });

  if (!companyProfile?.logo) {
    return null;
  }

  return (
    <div className="w-full bg-gradient-to-r from-blue-50 to-white border-b border-gray-100 py-2">
      <div className="container mx-auto px-4 flex justify-center">
        <img 
          src={`${companyProfile.logo}?t=${Date.now()}`}
          alt="Company Logo"
          className="h-12 w-auto object-contain"
          onError={(e) => {
            console.error('Company logo failed to load:', companyProfile.logo);
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

interface NavigationProps {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    companyId: number;
  };
}

export default function Navigation({ user }: NavigationProps) {
  const [location] = useLocation();

  const isActive = (path: string) => {
    if (path === "/") {
      return location === "/";
    }
    return location.startsWith(path);
  };

  // Role-based navigation logic
  const getNavigationItems = () => {
    const commonItems = [];

    if (user.role === 'company_admin') {
      return [
        { path: "/", label: "Dashboard", icon: Home, isCenter: true },
        { path: "/operations", label: "Operations", icon: ClipboardList },
        { path: "/customers", label: "Customers", icon: Users },
        { 
          path: "/admin", 
          label: "Admin", 
          icon: Settings,
          isDropdown: true,
          dropdownItems: [
            { path: "/team-management", label: "Team", icon: UserCog },
            { path: "/company-profile", label: "Company", icon: Building2 },
            { path: "/quickbooks", label: "QuickBooks", icon: DollarSign }
          ]
        }
      ];
    }

    if (user.role === 'irrigation_manager') {
      return [
        { path: "/work-orders", label: "Work Orders", icon: ClipboardList },
        { path: "/billing-sheets", label: "Billing", icon: FileText },
        { path: "/customers", label: "Customers", icon: Users },
        { path: "/", label: "Dashboard", icon: Home, isCenter: true },
        {
          path: "/parts",
          label: "Parts",
          icon: Package,
          isDropdown: true,
          dropdownItems: [
            { path: "/parts-catalog", label: "Catalog", icon: Package },
            { path: "/parts-list", label: "List", icon: ClipboardList }
          ]
        }
      ];
    }

    if (user.role === 'billing_manager') {
      return [
        { path: "/", label: "Dashboard", icon: Home, isCenter: true },
        { path: "/billing-sheets", label: "Billing Sheets", icon: FileText },
        { path: "/customers", label: "Customers", icon: Users },
        { path: "/parts-catalog", label: "Parts", icon: Package }
      ];
    }

    if (user.role === 'field_tech') {
      return [
        { path: "/work-orders", label: "Work Orders", icon: ClipboardList },
        { path: "/customers", label: "Customers", icon: Users },
        { path: "/", label: "Dashboard", icon: Home, isCenter: true },
        { path: "/parts-list", label: "Parts", icon: Package }
      ];
    }

    // Super admin gets access to everything
    return [
      { path: "/", label: "Dashboard", icon: Home, isCenter: true },
      { path: "/estimates", label: "Estimates", icon: FileText },
      { path: "/work-orders", label: "Work Orders", icon: ClipboardList },
      { path: "/billing-sheets", label: "Billing", icon: FileText },
      { path: "/customers", label: "Customers", icon: Users },
      { path: "/parts-catalog", label: "Parts", icon: Package },
      { path: "/team-management", label: "Team", icon: UserCog }
    ];
  };

  const navItems = getNavigationItems();
  
  // Split into desktop (first 5) and mobile (smart selection)
  const desktopNavItems = navItems.slice(0, 5);

  return (
    <>
      {/* Company Logo Banner */}
      <CompanyLogoBanner companyId={user.companyId} />

      {/* Desktop Navigation */}
      <nav className="hidden lg:block bg-white shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <img 
                src={irrigoProLogo} 
                alt="IrrigoPro Logo"
                className="h-10 w-auto"
              />
            </div>

            {/* Desktop Navigation Links */}
            <div className="hidden lg:flex items-center space-x-1">
              {(() => {
                if (!user?.role) return null;
                
                return desktopNavItems.map((item) => {
                  if (item.isDropdown && item.dropdownItems) {
                    // Check if any dropdown item is active
                    const isDropdownActive = item.dropdownItems.some(dropdownItem => isActive(dropdownItem.path));
                    
                    return (
                      <DropdownMenu key={item.path}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className={`font-medium flex items-center gap-2 ${
                              isDropdownActive
                                ? "text-primary border-b-2 border-primary rounded-none hover:bg-transparent"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            <item.icon className="h-4 w-4" />
                            {item.label}
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {item.dropdownItems.map((dropdownItem) => (
                            <Link key={dropdownItem.path} href={dropdownItem.path}>
                              <DropdownMenuItem>
                                <dropdownItem.icon className="mr-2 h-4 w-4" />
                                {dropdownItem.label}
                              </DropdownMenuItem>
                            </Link>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  }
                  
                  return (
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
                  );
                });
              })()}
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
                  <Link href="/user-profile">
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      My Account
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
                src={irrigoProLogo} 
                alt="IrrigoPro Logo"
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
                  <Link href="/user-profile">
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      My Account
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
        <div className="fixed bottom-0 left-0 right-0 mobile-nav-gradient border-t border-gray-100/50 shadow-xl z-50 pb-safe">
          <div className="relative py-3 px-4 pb-4">
            {/* 5-Column Grid Layout with Dashboard in center */}
            <div className="grid grid-cols-5 gap-2 items-center max-w-sm mx-auto">
              {(() => {
                // Create 5 slots with dashboard always in position 3 (center)
                const slots = Array(5).fill(null);
                const centerIndex = 2; // Position 3 (0-indexed)
                
                // Find center item and place it in slot 3
                const centerItem = navItems.find(item => item.isCenter);
                if (centerItem) {
                  slots[centerIndex] = centerItem;
                }

                // Get other items (non-center and not dropdown)
                const nonCenterItems = navItems.filter(item => !item.isCenter && !item.isDropdown);
                
                // Smart selection logic for irrigation managers
                if (user.role === 'irrigation_manager') {
                  // Prioritize primary parts access over dropdown
                  const workOrdersItem = nonCenterItems.find(item => item.path === '/work-orders');
                  const billingItem = nonCenterItems.find(item => item.path === '/billing-sheets');
                  const customersItem = nonCenterItems.find(item => item.path === '/customers');
                  const partsListItem = nonCenterItems.find(item => item.path === '/parts-list');

                  if (workOrdersItem) slots[0] = workOrdersItem;
                  if (billingItem) slots[1] = billingItem;
                  if (customersItem) slots[3] = customersItem;
                  if (partsListItem) slots[4] = partsListItem;
                } else {
                  // Fill remaining slots with other navigation items
                  let slotIndex = 0;
                  for (const item of nonCenterItems.slice(0, 4)) { // Max 4 items plus center
                    if (slotIndex === centerIndex) slotIndex++; // Skip center slot
                    if (slotIndex < 5) {
                      slots[slotIndex] = item;
                      slotIndex++;
                    }
                  }
                }

                return slots.map((item, index) => {
                  if (!item) {
                    return <div key={index} />; // Empty slot
                  }

                  const Icon = item.icon;
                  const isItemActive = isActive(item.path);
                  const isCenter = item.isCenter;

                  return (
                    <Link key={item.path} href={item.path}>
                      <div className="flex flex-col items-center space-y-1">
                        <div
                          className={`relative p-3 rounded-full transition-all duration-200 ${
                            isCenter
                              ? isItemActive
                                ? "bg-primary text-white shadow-lg scale-110"
                                : "bg-primary/10 text-primary border-2 border-primary/20"
                              : isItemActive
                              ? "bg-primary/10 text-primary"
                              : "text-gray-500"
                          }`}
                        >
                          <Icon 
                            className={`${
                              isCenter ? "h-6 w-6" : "h-5 w-5"
                            }`} 
                          />
                          {isCenter && (
                            <div className="absolute -top-1 -right-1 h-3 w-3 bg-blue-400 rounded-full shadow-sm" />
                          )}
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            isItemActive ? "text-primary" : "text-gray-500"
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                    </Link>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}