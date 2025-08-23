import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Shield, Wrench, Crown } from "lucide-react";

interface UserProfile {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "company_admin" | "irrigation_manager" | "field_tech" | "billing_manager";
  companyId?: number | null;
  isActive: boolean;
}

interface UserSelectorProps {
  onUserSelect: (user: UserProfile) => void;
  currentUser?: UserProfile | null;
}

export function UserSelector({ onUserSelect, currentUser }: UserSelectorProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('/api/users');
        if (response.ok) {
          const userData = await response.json();
          setUsers(userData.filter((u: UserProfile) => u.isActive));
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const getRoleIcon = (role: UserProfile['role']) => {
    switch (role) {
      case 'super_admin':
      case 'company_admin':
        return <Crown className="w-5 h-5 text-purple-600" />;
      case 'irrigation_manager':
      case 'billing_manager':
        return <Shield className="w-5 h-5 text-blue-600" />;
      case 'field_tech':
        return <Wrench className="w-5 h-5 text-green-600" />;
      default:
        return <User className="w-5 h-5 text-gray-600" />;
    }
  };

  const getRoleBadge = (role: UserProfile['role']) => {
    switch (role) {
      case 'super_admin':
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Super Admin</Badge>;
      case 'company_admin':
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Company Admin</Badge>;
      case 'irrigation_manager':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Irrigation Manager</Badge>;
      case 'billing_manager':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Billing Manager</Badge>;
      case 'field_tech':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Field Tech</Badge>;
      default:
        return <Badge variant="outline">{String(role).replace('_', ' ')}</Badge>;
    }
  };

  const handleUserSelect = (user: UserProfile) => {
    // Store selected user in localStorage
    localStorage.setItem("user", JSON.stringify(user));
    onUserSelect(user);
    
    // Reload the page to apply the new user context
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading user profiles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Select User Profile</h1>
          <p className="text-gray-600">Choose which user perspective to view the irrigation management system from</p>
          {currentUser && (
            <div className="mt-4 inline-flex items-center space-x-2 bg-white px-4 py-2 rounded-lg border">
              <span className="text-sm text-gray-600">Currently viewing as:</span>
              <span className="font-medium">{currentUser.name}</span>
              {getRoleBadge(currentUser.role)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {users.map((user) => (
            <Card 
              key={user.id} 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105 ${
                currentUser?.id === user.id ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-white'
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {getRoleIcon(user.role)}
                    <div>
                      <CardTitle className="text-lg">{user.name}</CardTitle>
                      <p className="text-sm text-gray-600">{user.email}</p>
                    </div>
                  </div>
                  {getRoleBadge(user.role)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Username:</span> {user.username}
                  </p>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Access Level:</span> {
                      user.role === 'super_admin' || user.role === 'company_admin' ? 'Full System Access' :
                      user.role === 'irrigation_manager' || user.role === 'billing_manager' ? 'Management Dashboard' :
                      'Field Operations'
                    }
                  </p>
                </div>
                <Button 
                  onClick={() => handleUserSelect(user)}
                  className={`w-full ${
                    currentUser?.id === user.id 
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-600 hover:bg-gray-700'
                  }`}
                  disabled={currentUser?.id === user.id}
                >
                  {currentUser?.id === user.id ? 'Current User' : 'Switch to This User'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}