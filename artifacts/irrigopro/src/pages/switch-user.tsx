import { safeGet } from "@/utils/safeStorage";
import { UserSelector } from "@/components/user-selector";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { clearSessionAndLogout } from "@/lib/queryClient";

interface UserProfile {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "company_admin" | "irrigation_manager" | "field_tech" | "billing_manager";
  companyId?: number | null;
  isActive: boolean;
}

export default function SwitchUser() {
  const { user } = useAuth();
  // Restricted accounts must authenticate as the next user, never enumerate
  // users or merely change the locally stored role. Branch before mounting
  // UserSelector so even the first render makes no forbidden /api/users read.
  if (user?.role === "system_documenter") return <DocumenterAccountSwitch />;
  return <StaffSwitchUser />;
}

function DocumenterAccountSwitch() {
  useEffect(() => { clearSessionAndLogout(); }, []);
  return <p role="status" className="mx-auto max-w-[480px] p-4 text-sm">Signing out to switch accounts…</p>;
}

function StaffSwitchUser() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    // Get current user from localStorage
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Error parsing saved user:", error);
      }
    }
  }, []);

  const handleUserSelect = (user: UserProfile) => {
    setCurrentUser(user);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Switch User</h1>
          <p className="text-gray-600 mt-2">
            Select a user account to switch to for testing different roles and permissions.
          </p>
        </div>
        
        <UserSelector 
          onUserSelect={handleUserSelect}
          currentUser={currentUser}
        />
      </div>
    </div>
  );
}