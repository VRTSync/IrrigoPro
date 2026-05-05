import { useState, useMemo, useRef, useEffect, type CSSProperties } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, LogIn, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { safeSet } from "@/utils/safeStorage";
import irrigoProLogo from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import PoweredByFooter from "@/components/layout/powered-by-footer";

interface LoginCredentials {
  username: string;
  password: string;
}

type CSSVarStyle = CSSProperties & Record<string, string | number>;

interface BlobSpec {
  id: number;
  topPct: number;
  leftPct: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
  parallax: number;
}

interface DropletSpec {
  id: number;
  leftPct: number;
  topPct: number;
  size: number;
  drift: number;
  bobDuration: number;
  bobDelay: number;
  parallax: number;
}

interface RippleSpec {
  id: number;
  leftPct: number;
  topPct: number;
  size: number;
  duration: number;
  delay: number;
}

function WaterBackground() {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches;
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const containerRef = useRef<HTMLDivElement>(null);
  const dropletRefs = useRef<Array<HTMLDivElement | null>>([]);
  const blobRefs = useRef<Array<HTMLDivElement | null>>([]);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const rafRef = useRef<number | null>(null);

  const blobs: BlobSpec[] = useMemo(() => {
    const palette = [
      "rgba(186,230,253,0.85)", // sky-200
      "rgba(125,211,252,0.75)", // sky-300
      "rgba(147,197,253,0.75)", // blue-300
      "rgba(165,243,252,0.7)",  // cyan-200
      "rgba(255,255,255,0.6)",
    ];
    const count = isMobile ? 3 : 5;
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      topPct: 10 + ((i * 37) % 70),
      leftPct: 5 + ((i * 53) % 80),
      size: 460 + ((i * 137) % 360),
      color: palette[i % palette.length],
      duration: 18 + i * 3,
      delay: -i * 4,
      parallax: 18 + (i % 3) * 8,
    }));
  }, [isMobile]);

  const ripples: RippleSpec[] = useMemo(() => {
    const count = isMobile ? 4 : 7;
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      leftPct: (i * 73 + 11) % 100,
      topPct: (i * 41 + 23) % 100,
      size: 80 + ((i * 37) % 120),
      duration: 6 + ((i * 1.3) % 4),
      delay: -((i * 1.9) % 8),
    }));
  }, [isMobile]);

  const droplets: DropletSpec[] = useMemo(() => {
    const count = isMobile ? 12 : 22;
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      leftPct: (i * 47 + 7) % 100,
      topPct: (i * 31 + 13) % 100,
      size: 10 + ((i * 7) % 18),
      drift: (i % 2 === 0 ? 1 : -1) * (6 + ((i * 5) % 14)),
      bobDuration: 6 + ((i * 1.7) % 6),
      bobDelay: -((i * 0.9) % 8),
      parallax: 35 + ((i * 11) % 50),
    }));
  }, [isMobile]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const el = containerRef.current;
    if (!el) return;

    const apply = () => {
      rafRef.current = null;
      const rect = el.getBoundingClientRect();
      const { x: mx, y: my, active } = mouseRef.current;

      // Blobs: gentle parallax toward cursor
      blobRefs.current.forEach((node, i) => {
        if (!node) return;
        const spec = blobs[i];
        if (!spec) return;
        const dx = active ? ((mx - rect.width / 2) / rect.width) * spec.parallax : 0;
        const dy = active ? ((my - rect.height / 2) / rect.height) * spec.parallax : 0;
        node.style.setProperty("--mx", `${dx}px`);
        node.style.setProperty("--my", `${dy}px`);
      });

      // Droplets: repulsion (antigravity) — push away from cursor with falloff
      const radius = 220;
      const strength = 90;
      dropletRefs.current.forEach((node, i) => {
        if (!node) return;
        const spec = droplets[i];
        if (!spec) return;
        const cx = (spec.leftPct / 100) * rect.width;
        const cy = (spec.topPct / 100) * rect.height;
        let tx = 0;
        let ty = 0;
        let scale = 1;
        if (active) {
          const dx = cx - mx;
          const dy = cy - my;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < radius) {
            const force = (1 - dist / radius) * strength;
            const inv = dist === 0 ? 1 : 1 / dist;
            tx = dx * inv * force;
            ty = dy * inv * force;
            scale = 1 + (1 - dist / radius) * 0.6;
          }
        }
        node.style.setProperty("--tx", `${tx}px`);
        node.style.setProperty("--ty", `${ty}px`);
        node.style.setProperty("--ds", `${scale}`);
      });
    };

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(apply);
    };

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      mouseRef.current.active = true;
      schedule();
    };
    const onLeave = () => {
      mouseRef.current.active = false;
      schedule();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [blobs, droplets, prefersReducedMotion]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* Light base gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #e0f2fe 0%, #bae6fd 35%, #7dd3fc 70%, #60a5fa 100%)",
        }}
      />

      {/* Aurora blobs */}
      <div className="absolute inset-0">
        {blobs.map((b, i) => {
          const style: CSSVarStyle = {
            top: `${b.topPct}%`,
            left: `${b.leftPct}%`,
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle at 30% 30%, ${b.color}, transparent 65%)`,
            filter: "blur(70px)",
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
            willChange: "transform, opacity",
            "--mx": "0px",
            "--my": "0px",
          };
          return (
            <div
              key={b.id}
              ref={(node) => {
                blobRefs.current[i] = node;
              }}
              className="absolute rounded-full wb-blob"
              style={style}
            />
          );
        })}
      </div>

      {/* Ripples */}
      <div className="absolute inset-0">
        {ripples.map((r) => (
          <div
            key={r.id}
            className="absolute wb-ripple"
            style={{
              left: `${r.leftPct}%`,
              top: `${r.topPct}%`,
              width: r.size,
              height: r.size,
              marginLeft: -r.size / 2,
              marginTop: -r.size / 2,
              animationDuration: `${r.duration}s`,
              animationDelay: `${r.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Droplets */}
      <div className="absolute inset-0">
        {droplets.map((d, i) => {
          const wrapStyle: CSSVarStyle = {
            left: `${d.leftPct}%`,
            top: `${d.topPct}%`,
            animationDuration: `${d.bobDuration}s`,
            animationDelay: `${d.bobDelay}s`,
            "--drift": `${d.drift}px`,
            "--tx": "0px",
            "--ty": "0px",
            "--ds": "1",
          };
          return (
            <div
              key={d.id}
              ref={(node) => {
                dropletRefs.current[i] = node;
              }}
              className="absolute wb-droplet-wrap"
              style={wrapStyle}
            >
              <div
                className="wb-droplet"
                style={{ width: d.size, height: d.size * 1.15 }}
              >
                <span className="wb-droplet-shine" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Soft vignette behind card for legibility */}
      <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_50%,rgba(15,23,42,0.18)_0%,rgba(15,23,42,0)_70%)]" />

      <style>{`
        @keyframes wb-blob-float {
          0%   { transform: translate3d(var(--mx,0px), var(--my,0px), 0) scale(1); opacity: 0.85; }
          50%  { transform: translate3d(calc(var(--mx,0px) + 40px), calc(var(--my,0px) - 30px), 0) scale(1.12); opacity: 1; }
          100% { transform: translate3d(var(--mx,0px), var(--my,0px), 0) scale(1); opacity: 0.85; }
        }
        .wb-blob {
          animation-name: wb-blob-float;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
          transition: transform 0.4s ease-out;
        }

        @keyframes wb-bob {
          0%   { transform: translate3d(calc(var(--tx,0px) + 0px), calc(var(--ty,0px) + 0px), 0) scale(var(--ds,1)); }
          50%  { transform: translate3d(calc(var(--tx,0px) + var(--drift,0px)), calc(var(--ty,0px) - 10px), 0) scale(var(--ds,1)); }
          100% { transform: translate3d(calc(var(--tx,0px) + 0px), calc(var(--ty,0px) + 0px), 0) scale(var(--ds,1)); }
        }
        .wb-droplet-wrap {
          animation-name: wb-bob;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
          transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform;
        }
        .wb-droplet {
          position: relative;
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          background: radial-gradient(circle at 35% 30%,
            rgba(255,255,255,0.95) 0%,
            rgba(224,242,254,0.75) 25%,
            rgba(56,189,248,0.55) 55%,
            rgba(37,99,235,0.45) 100%);
          box-shadow:
            inset 0 -2px 6px rgba(255,255,255,0.55),
            inset 0 2px 4px rgba(255,255,255,0.4),
            0 4px 14px rgba(37,99,235,0.25);
        }
        .wb-droplet-shine {
          position: absolute;
          top: 18%;
          left: 28%;
          width: 24%;
          height: 20%;
          border-radius: 50%;
          background: rgba(255,255,255,0.95);
          filter: blur(0.6px);
        }

        @keyframes wb-ripple-pulse {
          0%   { transform: scale(0.05); opacity: 0; }
          15%  { opacity: 0.85; }
          100% { transform: scale(1); opacity: 0; }
        }
        .wb-ripple {
          border-radius: 50%;
          border: 1.5px solid rgba(255,255,255,0.7);
          box-shadow:
            inset 0 0 14px rgba(186,230,253,0.55),
            0 0 22px rgba(125,211,252,0.35);
          transform: scale(0.05);
          opacity: 0;
          animation-name: wb-ripple-pulse;
          animation-iteration-count: infinite;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform, opacity;
        }

        @media (prefers-reduced-motion: reduce) {
          .wb-blob {
            animation: none !important;
            transition: none !important;
          }
          .wb-droplet-wrap,
          .wb-ripple {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function Login() {
  const [credentials, setCredentials] = useState<LoginCredentials>({
    username: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [emailVerificationNeeded, setEmailVerificationNeeded] = useState<string | null>(null);
  const [sendingVerification, setSendingVerification] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      console.log("Attempting login with credentials:", credentials);
      const user = await apiRequest("/api/auth/login", "POST", credentials);
      console.log("Login successful, user:", user);

      safeSet("user", JSON.stringify(user));

      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.name}!`,
        variant: "default",
      });

      if (user.role === "field_tech") {
        window.location.href = "/";
      } else if (user.role === "irrigation_manager") {
        window.location.href = "/";
      } else if (user.role === "billing_manager") {
        window.location.href = "/";
      } else {
        window.location.href = "/";
      }
    } catch (error: any) {
      console.error("Login error:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error.stack);

      if (error.message && error.message.includes("email verification") || error.message.includes("verify your email")) {
        setEmailVerificationNeeded(credentials.username);
        toast({
          title: "Email Verification Required",
          description: "Please verify your email address before logging in.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Login Failed",
          description: error.message || "Invalid credentials",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!emailVerificationNeeded) return;

    setSendingVerification(true);
    try {
      await apiRequest("/api/auth/resend-verification", "POST", {
        email: emailVerificationNeeded
      });

      toast({
        title: "Verification Email Sent",
        description: "Please check your email for the verification link.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send verification email",
        variant: "destructive",
      });
    } finally {
      setSendingVerification(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-sky-100 text-slate-900 flex flex-col">
      <WaterBackground />

      <div className="pointer-events-auto relative z-10 flex-1 flex items-center justify-center p-5 md:p-8">
        <Card className="w-full max-w-md bg-white/65 backdrop-blur-xl border-white/60 shadow-2xl text-slate-900 rounded-3xl">
          <CardHeader className="text-center pt-8 pb-4">
            <div className="flex justify-center mb-6">
              <img
                src={irrigoProLogo}
                alt="IrrigoPro Logo"
                className="h-28 w-auto drop-shadow-2xl"
              />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 tracking-tight">IrrigoPro</CardTitle>
            <p className="text-blue-700 mt-2 text-base">Professional irrigation management</p>
          </CardHeader>
          <CardContent className="px-6 pb-8">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-700 text-sm font-medium">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  required
                  data-testid="input-username"
                  className="h-14 bg-white/80 border-2 border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl text-base focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700 text-sm font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  required
                  data-testid="input-password"
                  className="h-14 bg-white/80 border-2 border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl text-base focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
              </div>

              <Button
                type="submit"
                size="lg"
                data-testid="button-login"
                className="w-full h-14 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold text-lg rounded-xl shadow-lg shadow-sky-500/30 transition-all duration-200 mt-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Lock className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <LogIn className="w-5 h-5 mr-2" />
                )}
                Sign In
              </Button>
            </form>

            {emailVerificationNeeded && (
              <div className="mt-5 p-5 bg-amber-50 border border-amber-300 rounded-2xl">
                <div className="flex items-center mb-3">
                  <Mail className="w-5 h-5 mr-2 text-amber-600" />
                  <span className="text-base text-amber-800 font-semibold">Email Verification Required</span>
                </div>
                <p className="text-sm text-amber-700 mb-4">
                  Please verify your email address to access your account.
                </p>
                <Button
                  onClick={handleResendVerification}
                  disabled={sendingVerification}
                  data-testid="button-resend-verification"
                  className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
                >
                  {sendingVerification ? (
                    <Lock className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4 mr-2" />
                  )}
                  Resend Verification Email
                </Button>
              </div>
            )}

            <div className="mt-6 text-center">
              <Button
                variant="link"
                onClick={() => window.location.href = '/forgot-password'}
                data-testid="link-forgot-password"
                className="text-base text-blue-700 hover:text-blue-900 transition-colors"
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
