import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, UserPlus, AlertTriangle, Check, X } from "lucide-react";

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

export default function UserManager() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const [testUsername, setTestUsername] = useState("randy@highplainsprop.com");
  const [testPassword, setTestPassword] = useState("password123");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/test-auth');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const testLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword })
      });
      
      if (response.ok) {
        setTestResult("LOGIN SUCCESSFUL! ✅");
      } else {
        const error = await response.text();
        setTestResult(`Login failed: ${error}`);
      }
    } catch (error) {
      setTestResult(`Connection error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const resetDatabase = async () => {
    if (!confirm('This will reset all user passwords to "password123". Continue?')) {
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reset-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        setTestResult("Database reset successful! All users now have password: password123");
        loadUsers();
      } else {
        const error = await response.text();
        setTestResult(`Reset failed: ${error}`);
      }
    } catch (error) {
      setTestResult(`Reset error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Production User Manager</h1>
        <p className="text-muted-foreground">Manage users and test authentication</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
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
                      {user.emailVerified ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <X className="h-4 w-4 text-red-500" />
                      )}
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

        {/* Test Login */}
        <Card>
          <CardHeader>
            <CardTitle>Test Login</CardTitle>
            <CardDescription>Test authentication with any credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="Username"
                value={testUsername}
                onChange={(e) => setTestUsername(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Password"
                value={testPassword}
                onChange={(e) => setTestPassword(e.target.value)}
              />
              <Button 
                onClick={testLogin} 
                disabled={loading}
                className="w-full"
              >
                Test Login
              </Button>
            </div>
            
            {testResult && (
              <Alert className={testResult.includes('SUCCESSFUL') ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <AlertDescription>{testResult}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Database Reset Actions
            </CardTitle>
            <CardDescription>
              Reset all user passwords to known values
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  This will reset ALL user passwords to "password123" and enable email verification for all accounts.
                </AlertDescription>
              </Alert>
              
              <Button 
                onClick={resetDatabase}
                disabled={loading}
                variant="destructive"
                className="w-full"
              >
                Reset All User Passwords
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* SQL Commands */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Manual SQL Commands</CardTitle>
            <CardDescription>Run these directly in your database if needed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Reset Randy's Password:</h4>
                <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
{`UPDATE users SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email_verified = true
WHERE username = 'randymangel';`}
                </pre>
              </div>
              
              <Separator />
              
              <div>
                <h4 className="font-medium mb-2">Create Fresh Randy Account:</h4>
                <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
{`INSERT INTO users (username, password, name, email, role, is_active, email_verified)
VALUES ('randy@highplainsprop.com', 
        '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'Randy Mangel', 'randy@highplainsprop.com', 'company_admin', true, true)
ON CONFLICT (username) DO UPDATE SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';`}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}