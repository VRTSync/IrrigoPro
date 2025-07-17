import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Lock, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";

interface LoginCredentials {
  username: string;
  password: string;
  role: "admin" | "field_tech";
}

export default function Login() {
  const [credentials, setCredentials] = useState<LoginCredentials>({
    username: "",
    password: "",
    role: "admin",
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Mock authentication - in real app, would validate against backend
      if (credentials.role === "field_tech") {
        if (credentials.username === "tech" && credentials.password === "tech123") {
          localStorage.setItem("user", JSON.stringify({
            id: "tech1",
            name: "John Field Tech",
            role: "field_tech",
            isActive: true,
          }));
          window.location.href = "/field-portal";
        } else {
          throw new Error("Invalid field tech credentials");
        }
      } else {
        if (credentials.username === "admin" && credentials.password === "admin123") {
          localStorage.setItem("user", JSON.stringify({
            id: "admin1",
            name: "Admin User",
            role: "admin",
            isActive: true,
          }));
          window.location.href = "/";
        } else {
          throw new Error("Invalid admin credentials");
        }
      }
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img 
              src={companyLogo} 
              alt="Company Logo" 
              className="h-16 w-auto"
            />
          </div>
          <CardTitle className="text-2xl font-bold">Irrigation Management System</CardTitle>
          <p className="text-gray-600">Please sign in to continue</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={credentials.role === "admin" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setCredentials({ ...credentials, role: "admin" })}
                >
                  <User className="w-4 h-4 mr-2" />
                  Admin
                </Button>
                <Button
                  type="button"
                  variant={credentials.role === "field_tech" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setCredentials({ ...credentials, role: "field_tech" })}
                >
                  <User className="w-4 h-4 mr-2" />
                  Field Tech
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder={credentials.role === "field_tech" ? "Field tech username" : "Admin username"}
                value={credentials.username}
                onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={credentials.password}
                onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Lock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              Sign In
            </Button>
          </form>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <div className="text-sm text-blue-800">
              <div className="font-medium mb-2">Demo Credentials:</div>
              <div><strong>Admin:</strong> admin / admin123</div>
              <div><strong>Field Tech:</strong> tech / tech123</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}