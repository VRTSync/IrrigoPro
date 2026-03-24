import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { safeGet, safeSet } from "@/utils/safeStorage";
import { User, Mail, Calendar, Building2, Shield } from "lucide-react";

interface UserProfile {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  companyId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  emailVerified?: boolean;
}

export default function UserProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      const userData = JSON.parse(savedUser);
      setUser(userData);
      setFormData({
        name: userData.name || "",
        email: userData.email || "",
      });
    }
  }, []);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      if (!user) throw new Error("User not found");
      return await apiRequest(`/api/users/${user.id}`, "PATCH", data);
    },
    onSuccess: (updatedUser) => {
      // Update stored user (safe for Safari private browsing)
      safeSet("user", JSON.stringify(updatedUser));
      setUser(updatedUser);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(formData);
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case "super_admin":
        return "Super Administrator";
      case "company_admin":
        return "Company Administrator";
      case "irrigation_manager":
        return "Irrigation Manager";
      case "field_tech":
        return "Field Technician";
      case "billing_manager":
        return "Billing Manager";
      default:
        return role;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "super_admin":
        return "destructive";
      case "company_admin":
        return "default";
      case "irrigation_manager":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Account</h1>
        <p className="text-gray-600 mt-2">Manage your personal information and account settings</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Information Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="h-5 w-5" />
              <span>Profile Information</span>
            </CardTitle>
            <CardDescription>
              Update your personal information and contact details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter your full name"
                />
              </div>
              
              <div>
                <Label htmlFor="email">Email Address</Label>
                <div className="space-y-2">
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="Enter your email address"
                  />
                  {user.email && (
                    <div className="flex items-center space-x-2 text-sm">
                      {user.emailVerified ? (
                        <div className="flex items-center space-x-1 text-green-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Email verified</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1 text-yellow-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-1.964-.833-2.732 0l-5.898 8c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          <span>Email not verified</span>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => {/* TODO: Implement resend verification */}}
                            className="ml-2 text-xs"
                          >
                            Resend verification
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                disabled={updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? "Updating..." : "Update Profile"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="h-5 w-5" />
              <span>Account Details</span>
            </CardTitle>
            <CardDescription>
              Your account information and access level
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* User Avatar and Basic Info */}
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary text-white text-xl">
                  {user.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-semibold">{user.name}</h3>
                <p className="text-gray-600">@{user.username}</p>
              </div>
            </div>

            <Separator />

            {/* Account Information */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Email</span>
                </div>
                <span className="text-sm text-gray-600">{user.email}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Shield className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Role</span>
                </div>
                <Badge variant={getRoleBadgeVariant(user.role)}>
                  {getRoleDisplayName(user.role)}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Building2 className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Company ID</span>
                </div>
                <span className="text-sm text-gray-600">{user.companyId}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Member Since</span>
                </div>
                <span className="text-sm text-gray-600">
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Status</span>
                </div>
                <Badge variant={user.isActive ? "default" : "secondary"}>
                  {user.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Security Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Security</span>
          </CardTitle>
          <CardDescription>
            Account security and access management
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Secure Account</h3>
            <p className="text-gray-600 mb-4">
              Your account is protected with secure authentication. 
              Contact your system administrator for password changes or security updates.
            </p>
            <Badge variant="outline" className="text-green-600 border-green-200">
              <Shield className="h-3 w-3 mr-1" />
              Protected Account
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}