import { useState, useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
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

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function TopoLayers({ x, y, active }: { x: import("framer-motion").MotionValue<number>, y: import("framer-motion").MotionValue<number>, active: boolean }) {
  // Mask size grows when active, shrinks when idle
  const radius = useSpring(active ? 28 : 12, { stiffness: 90, damping: 18 });
  const feather = useSpring(active ? 60 : 90, { stiffness: 90, damping: 18 });

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        // Expose x/y as CSS vars for mask positioning
        ["--x" as any]: x,
        ["--y" as any]: y,
        ["--r" as any]: radius,
        ["--f" as any]: feather,
      } as any}
    >
      {/* Map base (hidden by default, revealed by mask) */}
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          backgroundImage: `var(--topo-image), radial-gradient(1200px 800px at 30% 20%, #1e3a8a, #1e40af)`,
          backgroundSize: "auto, cover",
          backgroundRepeat: "repeat, no-repeat",
          backgroundPosition: "center, center",
          maskImage:
            // Radial mask centered at cursor; inner hard circle + soft feather
            `radial-gradient(
              circle at ${x.get()}% ${y.get()}%,
              rgba(0,0,0,1) ${radius.get()}vw,
              rgba(0,0,0,0) ${radius.get() + (feather.get()/10)}vw
            )`,
          WebkitMaskImage:
            `radial-gradient(
              circle at ${x.get()}% ${y.get()}%,
              rgba(0,0,0,1) ${radius.get()}vw,
              rgba(0,0,0,0) ${radius.get() + (feather.get()/10)}vw
            )`,
        }}
      />

      {/* Parallax glow behind the reveal to add depth */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(800px 600px at ${x.get()}% ${y.get()}%, rgba(59,130,246,0.12), transparent 60%)`,
        }}
      />

      {/* Animated contour overlay (very subtle) */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-30"
        style={{
          backgroundImage:
            `repeating-linear-gradient(
              45deg,
              rgba(255,255,255,0.03) 0px,
              rgba(255,255,255,0.03) 2px,
              transparent 2px,
              transparent 16px
            ), repeating-linear-gradient(
              -45deg,
              rgba(255,255,255,0.02) 0px,
              rgba(255,255,255,0.02) 2px,
              transparent 2px,
              transparent 18px
            )`,
          backgroundSize: "200px 200px, 180px 180px",
          animation: "contours 18s linear infinite",
        }}
      />

      {/* Dark overlay for contrast so the login card is legible */}
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_40%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.35)_80%)]" />

      {/* Keyframes for contour drift */}
      <style>{`
        @keyframes contours {
          0% { background-position: 0px 0px, 0px 0px; }
          100% { background-position: 600px 400px, -500px -350px; }
        }

        /* Respect reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .absolute.inset-0 { animation: none !important; }
        }
      `}</style>
    </motion.div>
  );
}

export default function Login() {
  const [credentials, setCredentials] = useState<LoginCredentials>({
    username: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  
  const rootRef = useRef<HTMLDivElement>(null);

  // Motion values for cursor position (as % of viewport)
  const mvX = useMotionValue(50);
  const mvY = useMotionValue(50);

  // Smoothed values
  const x = useSpring(mvX, { stiffness: 120, damping: 20, mass: 0.4 });
  const y = useSpring(mvY, { stiffness: 120, damping: 20, mass: 0.4 });

  const [isPointerActive, setIsPointerActive] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent | TouchEvent) => {
      const rect = el.getBoundingClientRect();
      let clientX: number, clientY: number;
      if ('touches' in e && e.touches && e.touches[0]) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }
      const px = ((clientX - rect.left) / rect.width) * 100;
      const py = ((clientY - rect.top) / rect.height) * 100;
      mvX.set(clamp(px, 0, 100));
      mvY.set(clamp(py, 0, 100));
    };

    const onEnter = () => setIsPointerActive(true);
    const onLeave = () => setIsPointerActive(false);

    el.addEventListener("mousemove", onMove);
    el.addEventListener("touchmove", onMove as EventListener, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("touchstart", onEnter, { passive: true });
    el.addEventListener("touchend", onLeave, { passive: true });

    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("touchmove", onMove as EventListener);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("touchstart", onEnter);
      el.removeEventListener("touchend", onLeave);
    };
  }, [mvX, mvY]);

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
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error.stack);
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
    <div
      ref={rootRef}
      className="relative min-h-screen w-full overflow-hidden bg-blue-950 text-white flex flex-col"
      style={{
        ["--topo-image" as any]:
          "url('data:image/svg+xml;utf8," +
          encodeURIComponent(`
          <svg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'>
            <defs>
              <filter id='grain'>
                <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
                <feColorMatrix type='saturate' values='0'/>
                <feComponentTransfer>
                  <feFuncA type='linear' slope='0.06'/>
                </feComponentTransfer>
              </filter>
            </defs>
            <rect width='100%' height='100%' fill='#1e3a8a'/>
            <g fill='none' stroke='#3b82f6' stroke-width='1.5'>
              ${Array.from({length: 32}).map((_,i)=>{
                const r = 30 + i*12;
                const cx = 180 + (i*13 % 140);
                const cy = 200 + (i*17 % 120);
                return `<path d='M ${cx} ${cy}
                  m -${r}, 0 a ${r},${r} 0 1,0 ${r*2},0 a ${r},${r} 0 1,0 -${r*2},0' />`;
              }).join('')}
              ${Array.from({length: 28}).map((_,i)=>{
                const r = 25 + i*10;
                const cx = 480 + (i*11 % 160);
                const cy = 450 + (i*7 % 140);
                return `<path d='M ${cx} ${cy}
                  m -${r}, 0 a ${r},${r} 0 1,0 ${r*2},0 a ${r},${r} 0 1,0 -${r*2},0' />`;
              }).join('')}
            </g>
            <g fill='none' stroke='#1d4ed8' stroke-width='1'>
              ${Array.from({length: 24}).map((_,i)=>{
                const r = 40 + i*8;
                const cx = 320 + (i*19 % 180);
                const cy = 320 + (i*23 % 160);
                return `<path d='M ${cx} ${cy}
                  m -${r}, 0 a ${r},${r} 0 1,0 ${r*2},0 a ${r},${r} 0 1,0 -${r*2},0' />`;
              }).join('')}
            </g>
            <rect width='100%' height='100%' filter='url(#grain)' opacity='0.25'/>
          </svg>
        `) + "')",
      }}
    >
      {/* Interactive Background */}
      <TopoLayers x={x} y={y} active={isPointerActive} />

      {/* Content */}
      <div className="pointer-events-auto relative z-10 flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20 shadow-2xl text-white">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src={irrigoProLogo} 
                alt="IrrigoPro Logo" 
                className="h-24 w-auto drop-shadow-lg"
              />
            </div>
            <CardTitle className="text-2xl font-bold text-white">IrrigoPro</CardTitle>
            <p className="text-blue-100">Professional irrigation management platform</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-blue-100">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  required
                  className="bg-white/10 border-white/20 text-white placeholder-white/50 focus:border-blue-400 focus:ring-blue-400"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-blue-100">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  required
                  className="bg-white/10 border-white/20 text-white placeholder-white/50 focus:border-blue-400 focus:ring-blue-400"
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

            <div className="mt-4 text-center space-y-2">
              <Button 
                variant="link" 
                onClick={() => window.location.href = '/forgot-password'}
                className="text-sm text-blue-200 hover:text-white transition-colors"
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