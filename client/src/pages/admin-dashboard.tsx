import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users, UserPlus, Edit, Trash2, Shield, Database, Settings, Activity, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User, InsertUser } from "@shared/schema";

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalEstimates: number;
  totalWorkOrders: number;
  totalInvoices: number;
  systemHealth: "good" | "warning" | "error";
}

export default function AdminDashboard() {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [userFormData, setUserFormData] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    role: "field_tech",
    isActive: true
  });
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch admin statistics
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: true
  });

  // Fetch all users
  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: true
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (userData: InsertUser) => {
      return await apiRequest("/api/users", "POST", userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setIsUserDialogOpen(false);
      resetUserForm();
      toast({
        title: "User Created",
        description: "New user has been successfully created.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    }
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, userData }: { id: number; userData: Partial<InsertUser> }) => {
      return await apiRequest(`/api/users/${id}`, "PATCH", userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsUserDialogOpen(false);
      setSelectedUser(null);
      resetUserForm();
      toast({
        title: "User Updated",
        description: "User has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    }
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/users/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "User Deleted",
        description: "User has been successfully deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    }
  });

  const resetUserForm = () => {
    setUserFormData({
      username: "",
      password: "",
      name: "",
      email: "",
      role: "field_tech",
      isActive: true
    });
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setUserFormData({
      username: user.username,
      password: "", // Don't prefill password for security
      name: user.name,
      email: user.email || "",
      role: user.role,
      isActive: user.isActive
    });
    setIsUserDialogOpen(true);
  };

  const handleSubmitUser = () => {
    if (selectedUser) {
      // Update existing user
      const updateData: Partial<InsertUser> = {
        username: userFormData.username,
        name: userFormData.name,
        email: userFormData.email,
        role: userFormData.role,
        isActive: userFormData.isActive
      };
      // Only include password if it's provided
      if (userFormData.password) {
        updateData.password = userFormData.password;
      }
      updateUserMutation.mutate({ id: selectedUser.id, userData: updateData });
    } else {
      // Create new user
      createUserMutation.mutate(userFormData as InsertUser);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "irrigation_manager": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "billing_manager": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "field_tech": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case "admin": return "Administrator";
      case "irrigation_manager": return "Irrigation Manager";
      case "billing_manager": return "Billing Manager";
      case "field_tech": return "Field Technician";
      default: return role;
    }
  };

  if (statsLoading || usersLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-20 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <Badge variant="outline" className="text-sm">
          <Shield className="w-4 h-4 mr-1" />
          Administrator Access
        </Badge>
      </div>

      {/* System Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-2xl font-bold">{stats?.totalUsers || users.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Activity className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active Users</p>
                <p className="text-2xl font-bold">{stats?.activeUsers || users.filter(u => u.isActive).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Database className="h-8 w-8 text-purple-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Estimates</p>
                <p className="text-2xl font-bold">{stats?.totalEstimates || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Settings className="h-8 w-8 text-orange-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">System Health</p>
                <Badge 
                  className={
                    stats?.systemHealth === "good" ? "bg-green-100 text-green-800" :
                    stats?.systemHealth === "warning" ? "bg-yellow-100 text-yellow-800" :
                    "bg-red-100 text-red-800"
                  }
                >
                  {stats?.systemHealth || "Good"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center">
              <Users className="w-5 h-5 mr-2" />
              User Management
            </CardTitle>
            <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => {
                  setSelectedUser(null);
                  resetUserForm();
                }}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md" aria-describedby="user-dialog-description">
                <DialogHeader>
                  <DialogTitle>
                    {selectedUser ? "Edit User" : "Add New User"}
                  </DialogTitle>
                  <DialogDescription id="user-dialog-description">
                    {selectedUser ? "Update user information and permissions." : "Create a new user account with role-based access."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        value={userFormData.username}
                        onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                        placeholder="Enter username"
                      />
                    </div>
                    <div>
                      <Label htmlFor="name">Full Name</Label>
                      <Input
                        id="name"
                        value={userFormData.name}
                        onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                        placeholder="Enter full name"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={userFormData.email}
                      onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                      placeholder="Enter email address"
                    />
                  </div>

                  <div>
                    <Label htmlFor="password">
                      Password {selectedUser && "(Leave blank to keep current)"}
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={userFormData.password}
                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                        placeholder={selectedUser ? "Enter new password" : "Enter password"}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="role">Role</Label>
                      <Select
                        value={userFormData.role}
                        onValueChange={(value) => setUserFormData({ ...userFormData, role: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrator</SelectItem>
                          <SelectItem value="irrigation_manager">Irrigation Manager</SelectItem>
                          <SelectItem value="billing_manager">Billing Manager</SelectItem>
                          <SelectItem value="field_tech">Field Technician</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={userFormData.isActive ? "active" : "inactive"}
                        onValueChange={(value) => setUserFormData({ ...userFormData, isActive: value === "active" })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-2 pt-4">
                    <Button variant="outline" onClick={() => setIsUserDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSubmitUser}
                      disabled={createUserMutation.isPending || updateUserMutation.isPending}
                    >
                      {selectedUser ? "Update User" : "Create User"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <p className="font-semibold">{user.name}</p>
                      <Badge className={getRoleBadgeColor(user.role)}>
                        {getRoleDisplayName(user.role)}
                      </Badge>
                      {!user.isActive && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">@{user.username} • {user.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditUser(user)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete User</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete {user.name}? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteUserMutation.mutate(user.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Delete User
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}