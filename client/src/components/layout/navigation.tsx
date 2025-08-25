import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import irrigoProLogo from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { useState, useEffect } from "react";
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
  const companyId = user.companyId;

  // Fetch company profile to get company logo
  const { data: company } = useQuery({
    queryKey: [`/api/company/${companyId}/profile`],
    queryFn: async () => {
      return await apiRequest(`/api/company/${companyId}/profile`, 'GET');
    },
    enabled: !!companyId,
    retry: false,
    staleTime: 0, // Always refetch for logo changes
    cacheTime: 0, // Don't cache for immediate updates
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // State for signed logo URL
  const [signedLogoUrl, setSignedLogoUrl] = useState<string | null>(null);

  // Company logo for banner (separate from navigation logo)
  const companyLogoUrl = company?.logo && company.logo.trim() !== '' && company.logo !== 'null' 
    ? `${company.logo}${company.logo.includes('?') ? '&' : '?'}v=${Date.now()}` 
    : null;

  // Debug log for company logo
  console.log('Navigation - Company data:', company);
  console.log('Navigation - Company logo URL:', companyLogoUrl);

  // Generate direct API URL for the company logo when company data changes
  useEffect(() => {
    const generateDirectLogoUrl = () => {
      if (company?.logo) {
        // Extract logo ID from the stored logo URL
        const logoIdMatch = company.logo.match(/company-logos\/([^?]+)/);
        if (logoIdMatch) {
          const logoId = logoIdMatch[1];
          // Use the direct API endpoint that serves the image binary
          const directUrl = `/api/company-logo/${logoId}`;
          setSignedLogoUrl(directUrl);
          console.log('Navigation - Direct logo URL generated:', directUrl);
        }
      } else {
        setSignedLogoUrl(null);
      }
    };

    generateDirectLogoUrl();
  }, [company]);

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
          { 
            path: "/customers", 
            label: "Customers", 
            icon: Users, 
            isDropdown: true,
            dropdownItems: [
              { path: "/customers", label: "Customers", icon: Users },
              { path: "/site-maps", label: "Maps", icon: MapIcon },
            ]
          },
          { path: "/parts", label: "Parts", icon: Package },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { 
            path: "/admin", 
            label: "Admin", 
            icon: Settings, 
            isDropdown: true,
            dropdownItems: [
              { path: "/users", label: "Team", icon: Users },
              { path: "/company-profile", label: "Company", icon: Settings },
              { path: "/quickbooks", label: "QuickBooks", icon: Calculator },
            ]
          },
        ];
      case "irrigation_manager":
        return [
          { path: "/work-orders", label: "Work Orders", icon: Wrench },
          { path: "/billing-sheets", label: "Billing", icon: ClipboardList },
          { path: "/customers", label: "Customers", icon: Users },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { 
            path: "/parts", 
            label: "Parts", 
            icon: Package, 
            isDropdown: true,
            dropdownItems: [
              { path: "/parts", label: "Parts Catalog", icon: Package },
              { path: "/parts-list", label: "Parts List", icon: Package },
            ]
          },
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
          { path: "/parts", label: "Parts", icon: Package },
          { path: "/", label: "Dashboard", icon: Home, isCenter: true },
          { path: "/quickbooks", label: "QuickBooks", icon: Calculator },
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
                    src={irrigoProLogo} 
                    alt="IrrigoPro Logo"
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
                  <Link href="/user-profile">
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      My Account
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/switch-user">
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

      {/* Company Logo Banner - Desktop (ALWAYS VISIBLE FOR TESTING) */}
      {companyLogoUrl && (
        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-center items-center py-3">
              <img 
                src={signedLogoUrl || companyLogoUrl} 
                alt="Company Logo"
                className="h-16 w-auto object-contain"
                onLoad={() => console.log('Desktop logo loaded successfully')}
                onError={(e) => console.error('Desktop logo failed to load:', e)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Debug info for logo visibility */}
      {companyLogoUrl && (
        <div className="bg-red-100 border border-red-300 p-2 text-xs">
          <strong>DEBUG - Desktop Logo Banner Active:</strong><br />
          Logo URL: {companyLogoUrl}<br />
          Company: {company?.name}
        </div>
      )}

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
                  <Link href="/switch-user">
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

        {/* Company Logo Banner - Mobile */}
        {companyLogoUrl && (
          <div className="bg-white border-b border-gray-200 shadow-sm">
            <div className="flex justify-center items-center py-2 px-4">
              <img 
                src={signedLogoUrl || companyLogoUrl} 
                alt="Company Logo"
                className="h-12 w-auto object-contain"
                onLoad={() => console.log('Mobile logo loaded successfully')}
                onError={(e) => console.error('Mobile logo failed to load:', e)}
              />
            </div>
          </div>
        )}

        {/* Debug info for mobile logo visibility - ALWAYS VISIBLE */}
        {companyLogoUrl && (
          <div className="bg-yellow-100 border border-yellow-300 p-2 text-xs">
            <strong>DEBUG - Mobile Logo Banner Active:</strong><br />
            Logo URL: {companyLogoUrl}<br />
            Company: {company?.name}
          </div>
        )}

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
                
                // Get non-center items and expand dropdown items for mobile
                let otherItems = navItems.filter(item => !item.isCenter);
                
                // For mobile, expand dropdown items with prioritization
                const expandedItems: any[] = [];
                
                // For company admin, prioritize essential functions for mobile
                if (userRole === 'company_admin') {
                  // First, add non-dropdown items
                  otherItems.filter(item => !item.isDropdown).forEach(item => {
                    expandedItems.push(item);
                  });
                  
                  // Then add Team (most important admin function)
                  const adminItem = otherItems.find(item => item.label === 'Admin');
                  if (adminItem?.dropdownItems) {
                    const teamItem = adminItem.dropdownItems.find((dropdownItem: any) => dropdownItem.label === 'Team');
                    if (teamItem) {
                      expandedItems.push(teamItem);
                    }
                  }
                  
                  // Add direct Customers link
                  const customersItem = otherItems.find(item => item.label === 'Customers' && item.isDropdown);
                  if (customersItem?.dropdownItems) {
                    // Add direct customers link instead of Maps
                    const customersLink = customersItem.dropdownItems.find((dropdownItem: any) => dropdownItem.label === 'Customers');
                    if (customersLink) {
                      expandedItems.push(customersLink);
                    }
                  }
                } else if (userRole === 'irrigation_manager') {
                  // For irrigation managers, prioritize key operational areas for mobile
                  // Add non-dropdown items first (Work Orders, Billing, Customers)
                  otherItems.filter(item => !item.isDropdown).forEach(item => {
                    expandedItems.push(item);
                  });
                  
                  // Add Parts Catalog (primary parts access) but not Parts List to save space
                  const partsItem = otherItems.find(item => item.label === 'Parts' && item.isDropdown);
                  if (partsItem?.dropdownItems) {
                    const partsCatalog = partsItem.dropdownItems.find((dropdownItem: any) => dropdownItem.label === 'Parts Catalog');
                    if (partsCatalog) {
                      expandedItems.push(partsCatalog);
                    }
                  }
                } else {
                  // For other roles, use the standard expansion
                  otherItems.forEach(item => {
                    if (item.isDropdown && item.dropdownItems) {
                      expandedItems.push(...item.dropdownItems);
                    } else {
                      expandedItems.push(item);
                    }
                  });
                }
                
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
                    // Empty slot with minimal spacing
                    return <div key={`empty-${slotIndex}`} className="flex justify-center h-14"></div>;
                  }
                  
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  const isCenter = item.isCenter;
                  
                  if (isCenter) {
                    return (
                      <div key={item.path} className="flex justify-center">
                        <Link href={item.path}>
                          <div className="relative">
                            {/* Enhanced Dashboard Button with Modern Design */}
                            <div className={`
                              flex flex-col items-center justify-center w-16 h-16 rounded-2xl -mt-6
                              bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 
                              text-white shadow-2xl border-3 border-white
                              transform transition-all duration-200 ease-out
                              hover:scale-110 active:scale-95 hover:shadow-2xl
                              ${active 
                                ? 'shadow-2xl scale-105 ring-4 ring-blue-100' 
                                : 'shadow-lg hover:shadow-blue-500/30'
                              }
                            `}>
                              <Icon className="h-6 w-6 mb-0.5" />
                              <span className="text-xs font-bold leading-none tracking-wide">Home</span>
                              {/* Subtle glow effect */}
                              <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-transparent rounded-2xl pointer-events-none"></div>
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
                          transition-all duration-200 ease-out transform hover:scale-105
                          ${active
                            ? "text-blue-600 bg-gradient-to-br from-blue-50 to-blue-100 shadow-md scale-105 ring-2 ring-blue-200"
                            : "text-gray-600 hover:text-blue-600 hover:bg-gradient-to-br hover:from-gray-50 hover:to-gray-100 hover:shadow-md"
                          }
                        `}>
                          <Icon className={`h-4 w-4 transition-transform duration-200 ${active ? 'scale-110' : ''}`} />
                          {item.label === "Work Orders" ? (
                            <div className="text-xs font-semibold text-center leading-none mt-1">
                              <div>Work</div>
                              <div>Orders</div>
                            </div>
                          ) : item.label === "Parts Catalog" ? (
                            <div className="text-xs font-semibold text-center leading-none mt-1">
                              <div>Parts</div>
                            </div>
                          ) : item.label === "Onsite" ? (
                            <span className="text-xs font-semibold text-center mt-1">Onsite</span>
                          ) : item.label === "Maps" ? (
                            <span className="text-xs font-semibold text-center mt-1">Maps</span>
                          ) : item.label === "Billing" ? (
                            <span className="text-xs font-semibold text-center mt-1">Billing</span>
                          ) : (
                            <span className="text-xs font-semibold text-center mt-1">{item.label}</span>
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