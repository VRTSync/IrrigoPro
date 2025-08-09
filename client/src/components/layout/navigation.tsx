import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";
import { useState } from "react";
import { Home, FileText, Package, Users, Wrench, ClipboardList, Calculator, UserCheck, Settings, LogOut, User, ChevronDown, MapIcon } from "lucide-react";
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
      case "super_admin":
        return [
          { path: "/super-admin", label: "Companies", icon: Settings },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/system-users", label: "All Users", icon: Users },
        ];
      case "company_admin":
        return [
          { path: "/operations", label: "Operations", icon: FileText },
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/site-maps", label: "Site Maps", icon: MapIcon },
          { path: "/users", label: "Users", icon: Users },
          { path: "/company-profile", label: "Company", icon: Settings },
        ];
      case "irrigation_manager":
        return [
          { 
            path: "/billing", 
            label: "Billing", 
            icon: Calculator, 
            isDropdown: true,
            dropdownItems: [
              { path: "/estimates", label: "Estimates", icon: FileText },
              { path: "/work-orders", label: "Work Orders", icon: Wrench },
              { path: "/billing-sheets", label: "Billing Sheets", icon: ClipboardList },
            ]
          },
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/site-maps", label: "Site Maps", icon: MapIcon },
          { path: "/parts-list", label: "Parts", icon: Package },
        ];
      case "field_tech":
        return [
          { path: "/work-orders", label: "Work Orders", icon: Wrench },
          { path: "/billing-sheets", label: "Onsite", icon: ClipboardList },
          { path: "/", label: "Home", icon: Home, isCenter: true },
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/site-maps", label: "Maps", icon: MapIcon },
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
              {(() => {
                // Reorder items for desktop - Dashboard first, then others
                const desktopNavItems = [...navItems];
                const dashboardIndex = desktopNavItems.findIndex(item => item.isCenter);
                
                if (dashboardIndex > -1) {
                  const dashboardItem = desktopNavItems.splice(dashboardIndex, 1)[0];
                  desktopNavItems.unshift(dashboardItem);
                }
                
                return desktopNavItems.map((item) => {
                  if (item.isDropdown && item.dropdownItems) {
                    // Check if any dropdown item is active
                    const isDropdownActive = item.dropdownItems.some(dropdownItem => isActive(dropdownItem.path));
                    
                    return (
                      <DropdownMenu key={item.path}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className={`font-medium flex items-center space-x-1 ${
                              isDropdownActive
                                ? "text-primary border-b-2 border-primary rounded-none hover:bg-transparent"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            <span>{item.label}</span>
                            <ChevronDown className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {item.dropdownItems.map((dropdownItem) => (
                            <Link key={dropdownItem.path} href={dropdownItem.path}>
                              <DropdownMenuItem className={`flex items-center space-x-2 ${
                                isActive(dropdownItem.path) ? "bg-primary/10" : ""
                              }`}>
                                <dropdownItem.icon className="w-4 h-4" />
                                <span>{dropdownItem.label}</span>
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
          <div className="relative py-2 px-2">
            {/* 5-Column Grid Layout with Dashboard in center */}
            <div className="grid grid-cols-5 gap-1 items-center">
              {(() => {
                // Create 5 slots with dashboard always in position 3 (center)
                const slots = Array(5).fill(null);
                const centerIndex = 2; // Position 3 (0-indexed)
                
                // Find center item and place it in slot 3
                const centerItem = navItems.find(item => item.isCenter);
                if (centerItem) {
                  slots[centerIndex] = centerItem;
                }
                
                // Get non-center items and expand dropdown items for mobile
                let otherItems = navItems.filter(item => !item.isCenter);
                
                // For mobile, expand dropdown items into individual items
                const expandedItems: any[] = [];
                otherItems.forEach(item => {
                  if (item.isDropdown && item.dropdownItems) {
                    expandedItems.push(...item.dropdownItems);
                  } else {
                    expandedItems.push(item);
                  }
                });
                otherItems = expandedItems;
                
                // For field techs, fill all 5 slots exactly
                if (userRole === 'field_tech') {
                  // Field techs have exactly 5 items, place them in order
                  const allItems = navItems;
                  allItems.forEach((item, index) => {
                    if (item.isCenter) {
                      slots[centerIndex] = item;
                    } else {
                      // Place other items in remaining slots
                      const otherSlots = [0, 1, 3, 4];
                      const otherItemIndex = allItems.filter(i => !i.isCenter).indexOf(item);
                      if (otherItemIndex < otherSlots.length) {
                        slots[otherSlots[otherItemIndex]] = item;
                      }
                    }
                  });
                } else {
                  // Fill slots around center (positions 0, 1, 3, 4) for other roles
                  let itemIndex = 0;
                  for (let i = 0; i < 5; i++) {
                    if (i !== centerIndex && itemIndex < otherItems.length) {
                      slots[i] = otherItems[itemIndex];
                      itemIndex++;
                    }
                  }
                }
                
                return slots.map((item, slotIndex) => {
                  if (!item) {
                    // Empty slot
                    return <div key={`empty-${slotIndex}`} className="flex justify-center"></div>;
                  }
                  
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  const isCenter = item.isCenter;
                  
                  if (isCenter) {
                    return (
                      <div key={item.path} className="flex justify-center">
                        <Link href={item.path}>
                          <div className="relative">
                            {/* Enhanced Dashboard Button with Gradient and Glow */}
                            <div className={`
                              flex flex-col items-center justify-center w-16 h-16 rounded-full -mt-8
                              bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 
                              text-white shadow-lg border-4 border-white
                              transform transition-transform duration-150 ease-out
                              hover:scale-105 active:scale-95
                              ${active ? 'shadow-xl scale-105' : 'shadow-lg'}
                            `}>
                              <Icon className="h-6 w-6" />
                              <span className="text-xs font-bold mt-0.5 leading-none">Home</span>
                            </div>
                          </div>
                        </Link>
                      </div>
                    );
                  }
                  
                  return (
                    <div key={item.path} className="flex justify-center">
                      <Link href={item.path}>
                        <div className={`
                          flex flex-col items-center justify-center w-14 h-14 rounded-xl 
                          transition-all duration-150 ease-out transform
                          ${active
                            ? "text-blue-600 bg-blue-50 shadow-sm scale-105"
                            : "text-gray-600 hover:text-blue-600 hover:bg-gray-50 hover:scale-105"
                          }
                        `}>
                          <Icon className="h-5 w-5 mb-1" />
                          {item.label === "Work Orders" ? (
                            <div className="text-xs font-medium text-center leading-none">
                              <div>Work</div>
                              <div>Orders</div>
                            </div>
                          ) : item.label === "Onsite" ? (
                            <span className="text-xs font-medium">Onsite</span>
                          ) : item.label === "Maps" ? (
                            <span className="text-xs font-medium">Maps</span>
                          ) : (
                            <span className="text-xs font-medium">{item.label}</span>
                          )}
                        </div>
                      </Link>
                    </div>
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