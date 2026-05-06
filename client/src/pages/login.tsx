import { useState, useRef, useEffect } from "react";
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

function WaterDropletField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const COUNT = isMobile ? 500 : 1100;
    const REPEL_RADIUS = isMobile ? 120 : 160;
    const REPEL_STR = 0.18;
    const RETURN_SPD = 0.014;
    const DAMPING = 0.92;

    const COLORS: Array<[number, number, number]> = [
      [199, 78, 52], [199, 78, 62], [199, 78, 40],
      [196, 88, 62], [196, 88, 72], [196, 88, 48],
      [190, 72, 55], [199, 65, 75], [205, 68, 55],
      [78, 65, 58], [78, 65, 68], [78, 58, 48],
    ];

    // Deterministic jitter so SSR/CSR match (pure trig, no Math.random).
    const jitter = (i: number, salt: number) => {
      const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };

    type Drop = {
      ox: number; oy: number; x: number; y: number;
      vx: number; vy: number;
      h: number; s: number; l: number;
      hShift: number;
      size: number;
      phase: number;
      speed: number;
      wobbleR: number;
      wobblePhase: number;
      fadeOffset: number;
      fadeAmt: number;
    };

    let particles: Drop[] = [];

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < COUNT; i++) {
        const j1 = jitter(i, 1);
        const j2 = jitter(i, 2);
        const j3 = jitter(i, 3);
        const j4 = jitter(i, 4);
        const j5 = jitter(i, 5);
        const j6 = jitter(i, 6);
        const j7 = jitter(i, 7);
        const j8 = jitter(i, 8);
        const j9 = jitter(i, 9);
        const ox = j1 * width;
        const oy = j2 * height;
        const col =
          j3 < 0.78
            ? COLORS[Math.floor(j4 * 9)]
            : COLORS[9 + Math.floor(j4 * 3)];
        particles.push({
          ox, oy, x: ox, y: oy,
          vx: 0, vy: 0,
          h: col[0], s: col[1], l: col[2],
          hShift: (j5 - 0.5) * 14,
          size: 1.2 + j6 * 2.2,
          phase: j7 * Math.PI * 2,
          speed: 0.28 + j8 * 0.52,
          wobbleR: 8 + j9 * 24,
          wobblePhase: jitter(i, 10) * Math.PI * 2,
          fadeOffset: jitter(i, 11) * Math.PI * 2,
          fadeAmt: 0.3 + jitter(i, 12) * 0.5,
        });
      }
    };
    initParticles();

    // Reposition origins on resize so drops fill the new viewport.
    const onResize = () => {
      resize();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const j1 = jitter(i, 1);
        const j2 = jitter(i, 2);
        p.ox = j1 * width;
        p.oy = j2 * height;
      }
    };
    window.removeEventListener("resize", resize);
    window.addEventListener("resize", onResize);

    const mouse = { x: -9999, y: -9999 };
    let manualBoost = 0;
    let time = 0;

    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onPointerLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
      }
    };
    const pulseAt = (x: number, y: number) => {
      manualBoost = 1.0;
      mouse.x = x;
      mouse.y = y;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx += (dx / dist) * (180 / dist);
        p.vy += (dy / dist) * (180 / dist);
      }
    };
    const onClick = (e: MouseEvent) => pulseAt(e.clientX, e.clientY);
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) pulseAt(t.clientX, t.clientY);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("click", onClick);
    window.addEventListener("touchend", onTouchEnd);

    const drawDrop = (p: Drop, excitement: number, alpha: number) => {
      if (alpha < 0.005) return;
      const size = p.size + excitement * 1.8;
      const hue = p.h + p.hShift + Math.sin(time * 0.2 + p.phase) * 8;
      const lit = p.l + excitement * 16;
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const angle =
        spd > 0.3 ? Math.atan2(p.vy, p.vx) + Math.PI / 2 : Math.PI * 0.1;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.scale(1, 1 + Math.min(spd * 0.04, 0.35));

      const r = size;
      const gr = ctx.createRadialGradient(-r * 0.28, -r * 0.28, r * 0.02, 0, 0, r);
      gr.addColorStop(0, `hsla(${hue + 10}, ${p.s - 8}%, 95%, ${alpha * 0.82})`);
      gr.addColorStop(0.45, `hsla(${hue}, ${p.s}%, ${lit}%, ${alpha})`);
      gr.addColorStop(1, `hsla(${hue - 6}, ${p.s + 5}%, ${lit - 20}%, ${alpha * 0.48})`);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = gr;
      ctx.fill();

      ctx.strokeStyle = `hsla(${hue + 6}, ${p.s - 12}%, 80%, ${alpha * 0.35})`;
      ctx.lineWidth = 0.4;
      ctx.stroke();

      const sp = ctx.createRadialGradient(
        -r * 0.3, -r * 0.3, 0,
        -r * 0.3, -r * 0.3, r * 0.22,
      );
      sp.addColorStop(0, `rgba(255,255,255,${alpha * (0.75 + excitement * 0.22)})`);
      sp.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.1})`);
      sp.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = sp;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(r * 0.22, -r * 0.18, r * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha * (0.22 + excitement * 0.2)})`;
      ctx.fill();

      ctx.restore();
    };

    let raf = 0;
    const tick = () => {
      time += 0.006;
      manualBoost *= 0.97;

      ctx.fillStyle = "rgba(232,244,251,0.22)";
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        const wobX = p.ox + Math.sin(time * p.speed + p.wobblePhase) * p.wobbleR;
        const wobY =
          p.oy + Math.cos(time * p.speed * 0.7 + p.wobblePhase) * p.wobbleR * 0.6;

        const cdx = p.x - mouse.x;
        const cdy = p.y - mouse.y;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (cdist < REPEL_RADIUS) {
          const f = (REPEL_RADIUS - cdist) / REPEL_RADIUS;
          const ang = Math.atan2(cdy, cdx);
          p.vx += Math.cos(ang) * f * REPEL_STR * (1 + f * 0.5);
          p.vy += Math.sin(ang) * f * REPEL_STR * (1 + f * 0.5);
        }

        p.vx += (wobX - p.x) * RETURN_SPD;
        p.vy += (wobY - p.y) * RETURN_SPD;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x += p.vx;
        p.y += p.vy;

        const pulse = (Math.sin(time * 0.84 + p.fadeOffset) + 1) / 2;
        const eased =
          pulse < 0.5
            ? 2 * pulse * pulse
            : 1 - Math.pow(-2 * pulse + 2, 2) / 2;

        const dist2 = Math.sqrt((p.x - wobX) ** 2 + (p.y - wobY) ** 2);
        const excite = Math.min(dist2 / 60, 1);
        const alpha = Math.min(
          1,
          eased * p.fadeAmt + excite * 0.7 + manualBoost * 0.5,
        );

        drawDrop(p, excite, alpha);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("click", onClick);
      window.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1]"
    />
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
      const user = await apiRequest("/api/auth/login", "POST", credentials);
      safeSet("user", JSON.stringify(user));

      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.name}!`,
        variant: "default",
      });

      window.location.href = "/";
    } catch (error: any) {
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
        email: emailVerificationNeeded,
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
    <div className="relative min-h-screen w-full overflow-hidden bg-[#e8f4fb] text-slate-900 flex flex-col">
      <WaterDropletField />

      <div className="pointer-events-auto relative z-10 flex-1 flex items-center justify-center p-5 md:p-8">
        <Card className="w-full max-w-md bg-white/80 backdrop-blur-xl border border-sky-100 shadow-[0_20px_60px_-15px_rgba(59,130,246,0.25)] text-slate-900 rounded-3xl">
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
                onClick={() => (window.location.href = "/forgot-password")}
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
