import { UserSelector } from "@/components/user-selector";
import { useState, useEffect } from "react";

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
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    // Get current user from localStorage
    const savedUser = localStorage.getItem("user");
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