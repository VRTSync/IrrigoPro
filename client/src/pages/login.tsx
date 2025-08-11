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
            
            {/* Animated contour lines - like topographic map elevation lines */}
            <g className="animate-pulse" style={{animationDuration: '4s'}}>
              {/* Main terrain contours */}
              <path d="M0,80 Q50,60 100,70 Q150,80 200,65 Q250,50 300,70 Q350,90 400,75" 
                    fill="none" stroke="#3b82f6" strokeWidth="3" 
                    opacity={0.8 + mousePos.y * 0.2} 
                    filter={mousePos.x > 0.3 && mousePos.x < 0.7 && mousePos.y > 0.1 && mousePos.y < 0.3 ? "url(#mouseGlow)" : "url(#glow)"} 
                    className="sm:stroke-2 transition-all duration-300"/>
              
              <path d="M0,140 Q60,120 120,130 Q180,140 240,125 Q300,110 360,130 Q390,140 400,135" 
                    fill="none" stroke="#1d4ed8" strokeWidth="2.5" 
                    opacity={0.7 + mousePos.x * 0.2} 
                    className="sm:stroke-2 transition-all duration-300"/>
              
              <path d="M0,200 Q40,180 80,190 Q120,200 160,185 Q200,170 240,190 Q280,210 320,195 Q360,180 400,200" 
                    fill="none" stroke="#1e40af" strokeWidth="3.5" 
                    opacity={0.9 + mousePos.y * 0.1} 
                    className="sm:stroke-2 transition-all duration-300"/>
            </g>
            
            <g className="animate-pulse" style={{animationDuration: '6s', animationDelay: '1s'}}>
              {/* Secondary elevation lines */}
              <path d="M0,110 Q75,90 150,100 Q225,110 300,95 Q350,80 400,100" 
                    fill="none" stroke="#3b82f6" strokeWidth="2" 
                    opacity={0.6 + mousePos.x * 0.3} 
                    className="sm:stroke-1 transition-all duration-500"/>
              
              <path d="M0,260 Q50,240 100,250 Q150,260 200,245 Q250,230 300,250 Q350,270 400,255" 
                    fill="none" stroke="#2563eb" strokeWidth="2.5" 
                    opacity={0.8 + mousePos.y * 0.2} 
                    filter={mousePos.x > 0.2 && mousePos.x < 0.8 && mousePos.y > 0.4 && mousePos.y < 0.6 ? "url(#mouseGlow)" : "none"} 
                    className="sm:stroke-1 transition-all duration-500"/>
              
              <path d="M0,320 Q90,300 180,310 Q270,320 360,305 Q380,300 400,310" 
                    fill="none" stroke="#1d4ed8" strokeWidth="2.2" 
                    opacity={0.7 + (mousePos.x + mousePos.y) * 0.15} 
                    className="sm:stroke-1 transition-all duration-500"/>
            </g>
            
            <g className="animate-pulse" style={{animationDuration: '8s', animationDelay: '2s'}}>
              {/* Fine detail contours */}
              <path d="M0,50 Q100,30 200,40 Q300,50 400,35" 
                    fill="none" stroke="#60a5fa" strokeWidth="1.8" opacity="0.5" className="sm:stroke-1"/>
              
              <path d="M0,380 Q75,360 150,370 Q225,380 300,365 Q350,350 400,370" 
                    fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.6" className="sm:stroke-1"/>
              
              <path d="M0,450 Q60,430 120,440 Q180,450 240,435 Q300,420 360,440 Q380,450 400,445" 
                    fill="none" stroke="#1e40af" strokeWidth="2.2" opacity="0.7" className="sm:stroke-1"/>
            </g>
            
            {/* Interactive Mouse Follower Effect */}
            <circle 
              cx={mousePos.x * 400} 
              cy={mousePos.y * 600} 
              r="30" 
              fill="url(#irrigationGradient)" 
              opacity="0.1" 
              className="transition-all duration-700 ease-out"
              style={{
                filter: "blur(8px)",
                transform: `scale(${1 + mousePos.y * 0.5})`,
              }}
            />
            
            {/* Irrigation zone markers - small circles representing sprinkler zones */}
            <g className="animate-bounce" style={{animationDelay: '0s', animationDuration: '3s'}}>
              <circle cx="80" cy="120" r="4" fill="#3b82f6" 
                     opacity={0.8 + (Math.abs(mousePos.x * 400 - 80) < 50 ? 0.2 : 0)} 
                     className="sm:r-2 transition-all duration-300"/>
              <circle cx="200" cy="180" r="3" fill="#1d4ed8" 
                     opacity={0.7 + (Math.abs(mousePos.x * 400 - 200) < 50 ? 0.3 : 0)} 
                     className="sm:r-1.5 transition-all duration-300"/>
              <circle cx="320" cy="140" r="5" fill="#1e40af" 
                     opacity={0.9 + (Math.abs(mousePos.x * 400 - 320) < 50 ? 0.1 : 0)} 
                     className="sm:r-2.5 transition-all duration-300"/>
              <circle cx="160" cy="240" r="4" fill="#2563eb" 
                     opacity={0.8 + (Math.abs(mousePos.y * 600 - 240) < 50 ? 0.2 : 0)} 
                     className="sm:r-2 transition-all duration-300"/>
              <circle cx="280" cy="200" r="3.5" fill="#3b82f6" 
                     opacity={0.7 + (Math.abs(mousePos.x * 400 - 280) < 50 ? 0.3 : 0)} 
                     className="sm:r-1.8 transition-all duration-300"/>
            </g>
            
            <g className="animate-bounce" style={{animationDelay: '1.5s', animationDuration: '4s'}}>
              <circle cx="60" cy="280" r="3" fill="#60a5fa" 
                     opacity={0.6 + (Math.abs(mousePos.y * 600 - 280) < 50 ? 0.4 : 0)} 
                     className="sm:r-1.5 transition-all duration-300"/>
              <circle cx="140" cy="160" r="4.5" fill="#1d4ed8" 
                     opacity={0.8 + (Math.abs(mousePos.x * 400 - 140) < 50 ? 0.2 : 0)} 
                     className="sm:r-2.2 transition-all duration-300"/>
              <circle cx="220" cy="320" r="3.5" fill="#1e40af" 
                     opacity={0.7 + (Math.abs(mousePos.y * 600 - 320) < 50 ? 0.3 : 0)} 
                     className="sm:r-1.8 transition-all duration-300"/>
              <circle cx="300" cy="180" r="4" fill="#3b82f6" 
                     opacity={0.9 + (Math.abs(mousePos.x * 400 - 300) < 50 ? 0.1 : 0)} 
                     className="sm:r-2 transition-all duration-300"/>
              <circle cx="380" cy="300" r="3.2" fill="#2563eb" 
                     opacity={0.6 + (Math.abs(mousePos.x * 400 - 380) < 50 ? 0.4 : 0)} 
                     className="sm:r-1.6 transition-all duration-300"/>
            </g>
            
            {/* Property boundary lines */}
            <g opacity="0.4">
              <path d="M100,50 L100,400 M200,40 L200,420 M300,60 L300,380" 
                    stroke="#1e40af" strokeWidth="1.5" strokeDasharray="8,4" className="sm:stroke-0.5"/>
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