import { useState, useEffect, useRef } from "react";
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
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Track mouse movement for interactive background
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setMousePos({
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        });
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
      return () => container.removeEventListener('mousemove', handleMouseMove);
    }
  }, []);

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
    <div ref={containerRef} className="min-h-screen relative overflow-hidden flex flex-col">
      {/* Animated Topographic Map Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        {/* Animated Terrain Contour Lines */}
        <div className="absolute inset-0">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
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
              
              <filter id="mouseGlow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge> 
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            
            {/* Clean Topographic Contour Lines */}
            <g>
              {/* Simple flowing contour lines */}
              <path d="M0,120 Q100,100 200,110 Q300,120 400,105" 
                    fill="none" stroke="#3b82f6" strokeWidth="1" 
                    opacity="0.3" 
                    className="sm:stroke-0.8"/>
              
              <path d="M0,180 Q120,160 240,170 Q360,180 400,165" 
                    fill="none" stroke="#1d4ed8" strokeWidth="1" 
                    opacity="0.25" 
                    className="sm:stroke-0.8"/>
              
              <path d="M0,240 Q80,220 160,230 Q240,240 320,225 Q360,220 400,235" 
                    fill="none" stroke="#2563eb" strokeWidth="1" 
                    opacity="0.2" 
                    className="sm:stroke-0.8"/>
              
              <path d="M0,300 Q90,280 180,290 Q270,300 360,285 Q380,280 400,295" 
                    fill="none" stroke="#60a5fa" strokeWidth="1" 
                    opacity="0.15" 
                    className="sm:stroke-0.8"/>
              
              <path d="M0,360 Q110,340 220,350 Q330,360 400,345" 
                    fill="none" stroke="#93c5fd" strokeWidth="1" 
                    opacity="0.1" 
                    className="sm:stroke-0.8"/>
            </g>
            
            {/* Subtle mouse glow effect */}
            <circle 
              cx={mousePos.x * 400} 
              cy={mousePos.y * 600} 
              r="80" 
              fill="#3b82f6" 
              opacity="0.03" 
              className="transition-all duration-1000 ease-out"
              style={{
                filter: "blur(20px)",
              }}
            />
            

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