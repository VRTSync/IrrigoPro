import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, EyeOff, Settings, RefreshCw, Users, AlertTriangle, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import irrigoProLogo from "@assets/irrigopro - logo-01_1754798633907.png";
import PoweredByFooter from "@/components/layout/powered-by-footer";

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  emailVerified: boolean;
}

interface ServerStatus {
  message: string;
  environment: string;
  userCount: number;
  users: User[];
}

export default function SimpleLogin() {
  const [username, setUsername] = useState("randy@highplainsprop.com");
  const [password, setPassword] = useState("password123");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [resetResult, setResetResult] = useState("");
  const { toast } = useToast();

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/test-auth');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const userData = await response.json();
        localStorage.setItem("user", JSON.stringify(userData));
        toast({ title: "Login successful!", description: "Welcome to IrrigoPro" });
        window.location.reload();
      } else {
        const errorData = await response.text();
        setError(errorData || "Login failed");
        toast({ 
          title: "Login failed", 
          description: errorData || "Invalid credentials",
          variant: "destructive" 
        });
      }
    } catch (error) {
      setError("Connection error");
      toast({ 
        title: "Connection error", 
        description: "Unable to connect to server",
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const resetAllPasswords = async () => {
    if (!confirm('This will reset ALL user passwords to "password123". Continue?')) {
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reset-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const result = await response.json();
        setResetResult(`✅ Success! ${result.usersUpdated} users updated. All passwords are now: password123`);
        loadUsers();
        toast({ 
          title: "Password reset successful", 
          description: "All users now have password: password123" 
        });
      } else {
        const error = await response.text();
        setResetResult(`❌ Failed: ${error}`);
        toast({ 
          title: "Reset failed", 
          description: error,
          variant: "destructive" 
        });
      }
    } catch (error) {
      setResetResult(`❌ Error: ${error}`);
      toast({ 
        title: "Connection error", 
        description: "Failed to reset passwords",
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <img 
            src={irrigoProLogo} 
            alt="IrrigoPro" 
            className="h-16 mx-auto mb-4"
          />
          <h1 className="text-3xl font-bold text-gray-900">IrrigoPro</h1>
          <p className="text-gray-600">Professional Irrigation Management</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" className="flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              Login
            </TabsTrigger>
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Admin Tools
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Sign In</CardTitle>
                <CardDescription>Enter your credentials to access IrrigoPro</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="username" className="text-sm font-medium">Username</label>
                    <Input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium">Password</label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={loading}
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>

                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Quick Login Options:</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <strong>Randy:</strong> randy@highplainsprop.com / password123
                    </div>
                    <div>
                      <strong>Super Admin:</strong> superadmin / password123
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-blue-200">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open('http://localhost:3000', '_blank')}
                      className="w-full text-xs text-blue-700 border-blue-200 hover:bg-blue-50 flex items-center gap-2 justify-center"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Access Standalone Rails KML Uploader
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admin">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Current Users */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Current Users
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={loadUsers}
                      disabled={loading}
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    {status && `Environment: ${status.environment} | Users: ${status.userCount}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {status?.users ? (
                    <div className="space-y-3">
                      {status.users.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="font-medium">{user.username}</div>
                            <div className="text-sm text-muted-foreground">{user.name}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{user.role}</Badge>
                            <Badge variant={user.emailVerified ? "default" : "destructive"}>
                              {user.emailVerified ? "Verified" : "Unverified"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">
                      {loading ? "Loading users..." : "No user data available"}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Admin Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    Database Reset
                  </CardTitle>
                  <CardDescription>
                    Reset all user passwords to known values
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      This will reset ALL user passwords to "password123" and enable email verification for all accounts.
                    </AlertDescription>
                  </Alert>
                  
                  <Button 
                    onClick={resetAllPasswords}
                    disabled={loading}
                    variant="destructive"
                    className="w-full"
                  >
                    {loading ? "Resetting..." : "Reset All User Passwords"}
                  </Button>

                  {resetResult && (
                    <Alert className={resetResult.includes('✅') ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                      <AlertDescription>{resetResult}</AlertDescription>
                    </Alert>
                  )}

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-2">Manual SQL (if needed):</h4>
                    <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`UPDATE users SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email_verified = true
WHERE username = 'randymangel';`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <PoweredByFooter />
      </div>
    </div>
  );
}