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
      {/* Animated Topographic Map Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        {/* Animated Terrain Contour Lines */}
        <div className="absolute inset-0">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
            <defs>
              <linearGradient id="irrigationGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3"/>
                <stop offset="50%" stopColor="#1d4ed8" stopOpacity="0.4"/>
                <stop offset="100%" stopColor="#1e40af" stopOpacity="0.5"/>
              </linearGradient>
              
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge> 
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            
            {/* Animated contour lines - like topographic map elevation lines */}
            <g className="animate-pulse" style={{animationDuration: '4s'}}>
              {/* Main terrain contours */}
              <path d="M0,150 Q100,130 200,140 Q300,150 400,135 Q500,120 600,140 Q700,160 800,145 Q900,130 1000,150 Q1100,170 1200,155" 
                    fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.6" filter="url(#glow)"/>
              
              <path d="M0,220 Q120,200 240,210 Q360,220 480,205 Q600,190 720,210 Q840,230 960,215 Q1080,200 1200,220" 
                    fill="none" stroke="#1d4ed8" strokeWidth="1.2" opacity="0.5"/>
              
              <path d="M0,290 Q80,270 160,280 Q240,290 320,275 Q400,260 480,280 Q560,300 640,285 Q720,270 800,290 Q880,310 960,295 Q1040,280 1120,300 Q1160,310 1200,305" 
                    fill="none" stroke="#1e40af" strokeWidth="1.8" opacity="0.7"/>
            </g>
            
            <g className="animate-pulse" style={{animationDuration: '6s', animationDelay: '1s'}}>
              {/* Secondary elevation lines */}
              <path d="M0,180 Q150,160 300,170 Q450,180 600,165 Q750,150 900,170 Q1050,190 1200,175" 
                    fill="none" stroke="#3b82f6" strokeWidth="1" opacity="0.4"/>
              
              <path d="M0,350 Q100,330 200,340 Q300,350 400,335 Q500,320 600,340 Q700,360 800,345 Q900,330 1000,350 Q1100,370 1200,355" 
                    fill="none" stroke="#2563eb" strokeWidth="1.3" opacity="0.6"/>
              
              <path d="M0,420 Q180,400 360,410 Q540,420 720,405 Q900,390 1080,410 Q1140,420 1200,415" 
                    fill="none" stroke="#1d4ed8" strokeWidth="1.1" opacity="0.5"/>
            </g>
            
            <g className="animate-pulse" style={{animationDuration: '8s', animationDelay: '2s'}}>
              {/* Fine detail contours */}
              <path d="M0,120 Q200,100 400,110 Q600,120 800,105 Q1000,90 1200,120" 
                    fill="none" stroke="#60a5fa" strokeWidth="0.8" opacity="0.3"/>
              
              <path d="M0,480 Q150,460 300,470 Q450,480 600,465 Q750,450 900,470 Q1050,490 1200,475" 
                    fill="none" stroke="#3b82f6" strokeWidth="0.9" opacity="0.4"/>
              
              <path d="M0,550 Q120,530 240,540 Q360,550 480,535 Q600,520 720,540 Q840,560 960,545 Q1080,530 1200,550" 
                    fill="none" stroke="#1e40af" strokeWidth="1.1" opacity="0.5"/>
            </g>
            
            {/* Irrigation zone markers - small circles representing sprinkler zones */}
            <g className="animate-bounce" style={{animationDelay: '0s', animationDuration: '3s'}}>
              <circle cx="200" cy="200" r="2" fill="#3b82f6" opacity="0.7"/>
              <circle cx="400" cy="280" r="1.5" fill="#1d4ed8" opacity="0.6"/>
              <circle cx="600" cy="240" r="2.5" fill="#1e40af" opacity="0.8"/>
              <circle cx="800" cy="320" r="2" fill="#2563eb" opacity="0.7"/>
              <circle cx="1000" cy="260" r="1.8" fill="#3b82f6" opacity="0.6"/>
            </g>
            
            <g className="animate-bounce" style={{animationDelay: '1.5s', animationDuration: '4s'}}>
              <circle cx="150" cy="350" r="1.5" fill="#60a5fa" opacity="0.5"/>
              <circle cx="350" cy="180" r="2.2" fill="#1d4ed8" opacity="0.7"/>
              <circle cx="550" cy="380" r="1.8" fill="#1e40af" opacity="0.6"/>
              <circle cx="750" cy="220" r="2" fill="#3b82f6" opacity="0.8"/>
              <circle cx="950" cy="400" r="1.6" fill="#2563eb" opacity="0.5"/>
            </g>
            
            {/* Property boundary lines */}
            <g opacity="0.2">
              <path d="M100,100 L100,500 M300,80 L300,520 M500,120 L500,480 M700,90 L700,510 M900,110 L900,490" 
                    stroke="#1e40af" strokeWidth="0.5" strokeDasharray="5,5"/>
            </g>
          </svg>
        </div>
        
        {/* Subtle overlay for depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-50/30 to-blue-100/50"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-white/90 backdrop-blur-sm border-blue-200/30 shadow-2xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src={irrigoProLogo} 
                alt="IrrigoPro Logo" 
                className="h-16 w-auto drop-shadow-lg"
              />
            </div>
            <CardTitle className="text-2xl font-bold text-blue-900">IrrigoPro</CardTitle>
            <p className="text-blue-700">Professional irrigation management platform</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-blue-800">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  required
                  className="bg-white/80 border-blue-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-blue-800">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  required
                  className="bg-white/80 border-blue-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg transition-all duration-200" 
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
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
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