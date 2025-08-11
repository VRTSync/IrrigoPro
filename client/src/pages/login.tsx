import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Lock, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import irrigoProLogo from "@assets/irrigopro - logo-01_1754798633907.png";
import PoweredByFooter from "@/components/layout/powered-by-footer";

interface LoginCredentials {
  username: string;
  password: string;
}

export default function Login() {
  const [credentials, setCredentials] = useState<LoginCredentials>({
    username: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      console.log("Attempting login with credentials:", credentials);
      const user = await apiRequest("/api/auth/login", "POST", credentials);
      console.log("Login successful, user:", user);
      
      // Store user in localStorage
      localStorage.setItem("user", JSON.stringify(user));
      
      // Show success toast
      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.name}!`,
        variant: "default",
      });
      
      // Redirect based on role
      if (user.role === "field_tech") {
        window.location.href = "/";
      } else if (user.role === "irrigation_manager") {
        window.location.href = "/work-orders";
      } else if (user.role === "billing_manager") {
        window.location.href = "/customers";
      } else {
        window.location.href = "/";
      }
    } catch (error: any) {
      console.error("Login error:", error);
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
    <div className="min-h-screen relative overflow-hidden flex flex-col">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-teal-800">
        {/* Animated Grid Lines */}
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="currentColor" strokeWidth="1" className="text-teal-400"/>
              </pattern>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.8"/>
                <stop offset="50%" stopColor="#0891b2" stopOpacity="0.6"/>
                <stop offset="100%" stopColor="#0f766e" stopOpacity="0.4"/>
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            
            {/* Animated flowing lines */}
            <g className="animate-pulse">
              <path d="M0,100 Q200,50 400,100 T800,100" fill="none" stroke="url(#lineGradient)" strokeWidth="2" opacity="0.7"/>
              <path d="M0,200 Q300,150 600,200 T1200,200" fill="none" stroke="url(#lineGradient)" strokeWidth="2" opacity="0.5"/>
              <path d="M0,300 Q150,250 300,300 T600,300" fill="none" stroke="url(#lineGradient)" strokeWidth="2" opacity="0.6"/>
            </g>
            
            {/* Floating geometric shapes */}
            <g className="animate-bounce" style={{animationDelay: '0s', animationDuration: '3s'}}>
              <circle cx="100" cy="150" r="3" fill="#14b8a6" opacity="0.6"/>
              <circle cx="300" cy="250" r="2" fill="#0891b2" opacity="0.7"/>
              <circle cx="500" cy="180" r="4" fill="#0f766e" opacity="0.5"/>
            </g>
            
            <g className="animate-bounce" style={{animationDelay: '1s', animationDuration: '4s'}}>
              <rect x="200" y="100" width="6" height="6" fill="#14b8a6" opacity="0.4" transform="rotate(45 203 103)"/>
              <rect x="400" y="300" width="4" height="4" fill="#0891b2" opacity="0.6" transform="rotate(45 402 302)"/>
              <rect x="600" y="150" width="5" height="5" fill="#0f766e" opacity="0.5" transform="rotate(45 602.5 152.5)"/>
            </g>
          </svg>
        </div>
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm border-white/20 shadow-2xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src={irrigoProLogo} 
                alt="IrrigoPro Logo" 
                className="h-16 w-auto drop-shadow-lg"
              />
            </div>
            <CardTitle className="text-2xl font-bold text-slate-800">IrrigoPro</CardTitle>
            <p className="text-slate-600">Professional irrigation management platform</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-700">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  required
                  className="bg-white/80 border-slate-300 focus:border-teal-500 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  required
                  className="bg-white/80 border-slate-300 focus:border-teal-500 focus:ring-teal-500"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white font-semibold shadow-lg transition-all duration-200" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <Lock className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4 mr-2" />
                )}
                Sign In
              </Button>
            </form>

            <div className="mt-4 text-center">
              <Button 
                variant="link" 
                onClick={() => window.location.href = '/forgot-password'}
                className="text-sm text-slate-600 hover:text-teal-600 transition-colors"
              >
                Forgot your password?
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="relative z-10">
        <PoweredByFooter />
      </div>
    </div>
  );
}