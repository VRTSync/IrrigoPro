import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Home, Wrench, Droplets, ClipboardList, Users, User, LogOut, type LucideIcon } from "lucide-react";
import { safeGet } from "@/utils/safeStorage";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationSystem } from "@/components/notifications/notification-system";
import { apiRequest, clearSessionAndLogout } from "@/lib/queryClient";
import irrigoProLogo from "@assets/IrrigoPro_2026-03_1780427958317.png";

type NavItem = { path: string; label: string; icon: LucideIcon; isCenter?: boolean };

export function navItemsForRole(role: string | undefined): NavItem[] {
  switch (role) {
    case "field_tech":
      return [
        { path: "/work-orders", label: "Work Orders", icon: Wrench },
        { path: "/wet-checks", label: "Wet Checks", icon: Droplets },
        { path: "/", label: "Home", icon: Home, isCenter: true },
        { path: "/billing-sheets", label: "Onsite", icon: ClipboardList },
        { path: "/customers", label: "Customers", icon: Users },
      ];
    default:
      return [{ path: "/", label: "Dashboard", icon: Home, isCenter: true }];
  }
}

export default function Navigation() {
  const [location] = useLocation();
  const isActive = (path: string) => path === "/" ? location === "/" : location.startsWith(path);
  const user = JSON.parse(safeGet("user") || "{}");
  const companyId = user.companyId;

  // The company logo banner is also part of the field-tech shell.
  const { data: company } = useQuery({
    queryKey: [`/api/company/${companyId}/profile`],
    queryFn: () => apiRequest(`/api/company/${companyId}/profile`, "GET"),
    enabled: !!companyId,
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Route both stored logo formats through the public logo endpoint.
  const logoApiUrl = useMemo(() => {
    const logo = company?.logo;
    if (!logo || logo.trim() === "" || logo === "null") return null;
    const match = logo.match(/company-logos\/([^?]+)/) ?? logo.match(/\/api\/company-logo\/([^?/]+)/);
    return match ? `/api/company-logo/${match[1]}` : null;
  }, [company?.logo]);

  const navItems = navItemsForRole(user.role);
  const center = navItems.find((item) => item.isCenter);
  const quickLinks = navItems.filter((item) => !item.isCenter);
  const desktopItems = center ? [center, ...quickLinks] : quickLinks;
  const mobileSlots = [quickLinks[0], quickLinks[1], center, quickLinks[2], quickLinks[3]];

  return (
    <>
      <nav className="hidden lg:block bg-white shadow-sm border-b border-transparent relative after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-primary/40 after:to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-24">
            <div className="flex-shrink-0">
              <Link href="/">
                <div
                  className="inline-flex items-center justify-center px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 hover:opacity-90"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary-dark)/0.08) 0%, hsl(var(--primary)/0.05) 100%)",
                    boxShadow: "0 0 0 1px hsl(var(--primary)/0.12), 0 2px 8px hsl(var(--primary)/0.10)",
                  }}
                >
                  <img src={irrigoProLogo} alt="IrrigoPro" className="h-20 w-auto" style={{ filter: "drop-shadow(0 2px 6px hsl(var(--primary)/0.22))" }} />
                </div>
              </Link>
            </div>
            <div className="flex items-center divide-x divide-gray-200/70">
              {desktopItems.map((item) => (
                <div key={item.path} className="px-3 first:pl-0 last:pr-0">
                  <Link href={item.path}>
                    <Button
                      variant="ghost"
                      className={`font-medium transition-colors ${
                        isActive(item.path)
                          ? "bg-primary/10 text-primary font-semibold rounded-md shadow-sm ring-1 ring-primary/20 hover:bg-primary/15"
                          : "text-gray-600 hover:text-primary hover:bg-primary/5 rounded-md"
                      }`}
                    >
                      {item.label}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <NotificationSystem userId={user.id} />
              <AccountMenu user={user} />
            </div>
          </div>
        </div>
        {logoApiUrl && (
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-center items-center py-3">
                <img src={logoApiUrl} alt="Company Logo" className="h-20 w-auto object-contain" />
              </div>
            </div>
          </div>
        )}
      </nav>

      <div className="lg:hidden m-0 p-0">
        <div className="bg-white shadow-sm border-b border-gray-200 m-0 p-0">
          <div className="flex justify-between items-center h-14 px-4">
            <div className="flex items-center min-w-0 flex-1 mr-2">
              <div
                className="inline-flex items-center justify-center px-2 py-1 rounded-lg"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--primary-dark)/0.08) 0%, hsl(var(--primary)/0.05) 100%)",
                  boxShadow: "0 0 0 1px hsl(var(--primary)/0.12), 0 1px 4px hsl(var(--primary)/0.10)",
                }}
              >
                <img src={irrigoProLogo} alt="IrrigoPro" className="h-9 w-auto max-w-full object-contain" style={{ filter: "drop-shadow(0 1px 4px hsl(var(--primary)/0.20))" }} />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <NotificationSystem userId={user.id} />
              <AccountMenu user={user} mobile />
            </div>
          </div>
        </div>
        {logoApiUrl && (
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="flex justify-center items-center py-3 px-4">
              <img src={logoApiUrl} alt="Company Logo" className="h-16 w-auto object-contain" />
            </div>
          </div>
        )}
        <div className="fixed bottom-0 left-0 right-0 mobile-nav-gradient border-t border-gray-100/50 shadow-xl z-50 pb-safe">
          <div className="relative py-3 px-4 pb-4">
            <div className="grid grid-cols-5 gap-2 items-center max-w-sm mx-auto">
              {mobileSlots.map((item, index) => {
                if (!item) return <div key={`empty-${index}`} className="flex justify-center h-14" />;
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <div key={item.path} className="flex justify-center">
                    <Link href={item.path}>
                      {item.isCenter ? (
                        <div className="relative">
                          <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl -mt-6
                            bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 text-white shadow-2xl border-3 border-white
                            transform transition-all duration-200 ease-out hover:scale-110 active:scale-95 hover:shadow-2xl
                            ${active ? "shadow-2xl scale-105 ring-4 ring-blue-100" : "shadow-lg hover:shadow-blue-500/30"}`}>
                            <Icon className="h-6 w-6 mb-0.5" />
                            <span className="text-xs font-bold leading-none tracking-wide">{item.label}</span>
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-transparent rounded-2xl pointer-events-none" />
                          </div>
                        </div>
                      ) : (
                        <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl
                          transition-all duration-200 ease-out transform hover:scale-105
                          ${active ? "text-blue-600 bg-gradient-to-br from-blue-50 to-blue-100 shadow-md scale-105 ring-2 ring-blue-200"
                            : "text-gray-600 hover:text-blue-600 hover:bg-gradient-to-br hover:from-gray-50 hover:to-gray-100 hover:shadow-md"}`}>
                          <Icon className={`h-4 w-4 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                          {item.label === "Work Orders" ? (
                            <div className="text-xs font-semibold text-center leading-none mt-1">
                              <div>Work</div>
                              <div>Orders</div>
                            </div>
                          ) : (
                            <span className="text-xs font-semibold text-center mt-1">{item.label}</span>
                          )}
                        </div>
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AccountMenu({ user, mobile = false }: { user: { name?: string; email?: string }; mobile?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={mobile ? "sm" : "default"} className={mobile ? "p-2" : "flex items-center space-x-2 p-2"}>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-white">{user.name?.charAt(0) || "U"}</AvatarFallback>
          </Avatar>
          {!mobile && <span className="hidden sm:block text-sm font-medium">{user.name}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <Link href="/user-profile">
          <DropdownMenuItem><User className="mr-2 h-4 w-4" /> My Account</DropdownMenuItem>
        </Link>
        <DropdownMenuItem onClick={clearSessionAndLogout} className="text-red-600">
          <LogOut className="mr-2 h-4 w-4" /> Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
