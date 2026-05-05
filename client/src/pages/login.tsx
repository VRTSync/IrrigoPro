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

function StaticBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Near-white base with a faint blue tint */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(140% 100% at 50% 0%, #ffffff 0%, #f5fbff 40%, #eaf6ff 75%, #dceffd 100%)",
        }}
      />
      {/* Faint blue aurora blobs (static) */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(520px 420px at 18% 22%, rgba(186,230,253,0.45), transparent 65%)",
            "radial-gradient(620px 500px at 82% 30%, rgba(147,197,253,0.38), transparent 65%)",
            "radial-gradient(680px 540px at 30% 82%, rgba(165,243,252,0.32), transparent 65%)",
            "radial-gradient(560px 460px at 78% 78%, rgba(224,242,254,0.55), transparent 65%)",
          ].join(","),
          filter: "blur(40px)",
        }}
      />
      {/* Soft sky vignette at the edges */}
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_50%,rgba(255,255,255,0)_55%,rgba(186,230,253,0.18)_100%)]" />
    </div>
  );
}

function RingParticleField() {
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

    // Pre-render a soft radial-gradient particle stamp for performance.
    const stampSize = 32;
    const stamp = document.createElement("canvas");
    stamp.width = stampSize;
    stamp.height = stampSize;
    const sctx = stamp.getContext("2d")!;
    const grad = sctx.createRadialGradient(
      stampSize / 2,
      stampSize / 2,
      0,
      stampSize / 2,
      stampSize / 2,
      stampSize / 2,
    );
    grad.addColorStop(0, "rgba(96,165,250,1)");
    grad.addColorStop(0.45, "rgba(59,130,246,0.65)");
    grad.addColorStop(1, "rgba(59,130,246,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, stampSize, stampSize);

    // Two perpendicular bands forming a gyroscope.
    const ringRadius = isMobile ? 78 : 130;
    const bandWidth = isMobile ? 6 : 10;
    const rowsPerBand = isMobile ? 3 : 5;
    const perRow = isMobile ? 56 : 110;

    type Particle = {
      band: 0 | 1;
      angle: number;
      radius: number;
      size: number;
      alpha: number;
      morphSeed: number;
    };
    const particles: Particle[] = [];

    // Deterministic jitter so SSR/CSR match (pure trig, no Math.random).
    const jitter = (i: number, salt: number) => {
      const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };

    const buildBand = (band: 0 | 1, angleOffset: number) => {
      let idx = 0;
      for (let r = 0; r < rowsPerBand; r++) {
        const rowOffset = (r - (rowsPerBand - 1) / 2) * bandWidth;
        const radius = ringRadius + rowOffset;
        for (let i = 0; i < perRow; i++) {
          const a = (i / perRow) * Math.PI * 2 + angleOffset;
          const j1 = jitter(idx + band * 1000, 1);
          const j2 = jitter(idx + band * 1000, 2);
          const j3 = jitter(idx + band * 1000, 3);
          particles.push({
            band,
            angle: a + (j1 - 0.5) * 0.04,
            radius: radius + (j2 - 0.5) * 1.6,
            size: 1.0 + j3 * 1.6,
            alpha: 0.55 + j2 * 0.4,
            morphSeed: j1 * Math.PI * 2,
          });
          idx++;
        }
      }
    };
    buildBand(0, 0);
    // Slight angular offset on band 1 so they don't perfectly overlap.
    buildBand(1, 0.137);

    const target = { x: width / 2, y: height / 2, active: false };
    const pos = { x: width / 2, y: height / 2 };
    const vel = { x: 0, y: 0 }; // low-pass-filtered velocity for stretch
    let displayOpacity = 0;
    let targetOpacity = 0;

    let rotA = 0; // band 0 spin
    let rotB = 0; // band 1 spin (counter-rotating)
    let gyroPhase = 0; // shared parent precession phase

    let lastTs = performance.now();
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      if (!target.active) {
        pos.x = e.clientX;
        pos.y = e.clientY;
      }
      target.active = true;
      targetOpacity = 1;
    };
    const onLeave = () => {
      target.active = false;
      targetOpacity = 0;
    };
    const onEnter = () => {
      targetOpacity = 1;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerenter", onEnter);

    // 3D projection constants
    const PERSPECTIVE = 420;
    const SCALE_MIN = 0.25;
    const SCALE_MAX = 1.7;

    const tick = (ts: number) => {
      const dt = Math.min(50, ts - lastTs);
      lastTs = ts;

      // Smooth follow (inertia)
      const k = 1 - Math.pow(1 - 0.18, dt / 16.67);
      const dx = (target.x - pos.x) * k;
      const dy = (target.y - pos.y) * k;
      pos.x += dx;
      pos.y += dy;

      // Low-pass filter the per-frame velocity for the stretch warp.
      const vk = 1 - Math.pow(1 - 0.18, dt / 16.67);
      vel.x += (dx - vel.x) * vk;
      vel.y += (dy - vel.y) * vk;

      // Spins & precession
      rotA += 0.00026 * dt;
      rotB -= 0.00021 * dt;
      gyroPhase += 0.00045 * dt;

      // Opacity ease
      displayOpacity += (targetOpacity - displayOpacity) * Math.min(1, dt / 220);

      ctx.clearRect(0, 0, width, height);

      if (displayOpacity <= 0.01) {
        raf = requestAnimationFrame(tick);
        return;
      }

      // Soft cursor halo behind the bands.
      ctx.save();
      const halo = ctx.createRadialGradient(
        pos.x,
        pos.y,
        0,
        pos.x,
        pos.y,
        ringRadius * 1.25,
      );
      halo.addColorStop(0, `rgba(186,230,253,${0.32 * displayOpacity})`);
      halo.addColorStop(0.55, `rgba(147,197,253,${0.14 * displayOpacity})`);
      halo.addColorStop(1, "rgba(147,197,253,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(
        pos.x - ringRadius * 1.5,
        pos.y - ringRadius * 1.5,
        ringRadius * 3,
        ringRadius * 3,
      );
      ctx.restore();

      // Velocity stretch (warp) — squashes along motion direction.
      const speed = Math.hypot(vel.x, vel.y);
      const stretch = Math.min(0.35, speed * 0.012);
      const motionAngle = Math.atan2(vel.y, vel.x);

      // Shared gyroscope tilt (parent rotation on X & Y).
      const tiltX =
        Math.sin(gyroPhase) * 0.95 + Math.sin(gyroPhase * 2.13) * 0.18;
      const tiltY =
        Math.cos(gyroPhase * 0.87) * 0.95 + Math.cos(gyroPhase * 1.97) * 0.18;
      const cosTX = Math.cos(tiltX);
      const sinTX = Math.sin(tiltX);
      const cosTY = Math.cos(tiltY);
      const sinTY = Math.sin(tiltY);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      // Apply velocity stretch via a rotated non-uniform scale.
      if (stretch > 0.001) {
        ctx.rotate(motionAngle);
        ctx.scale(1 + stretch, 1 - stretch * 0.6);
        ctx.rotate(-motionAngle);
      }

      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const spin = p.band === 0 ? rotA : rotB;
        const a = p.angle + spin;

        // Edge-morph wave: subtle radial breathing per-particle.
        const morph =
          1 +
          Math.sin(gyroPhase * 2 + p.morphSeed + a * 3) * 0.025;
        const r = p.radius * morph;

        // Local-plane coords (band 0 = XY; band 1 = XZ).
        let lx = Math.cos(a) * r;
        let ly: number;
        let lz: number;
        if (p.band === 0) {
          ly = Math.sin(a) * r;
          lz = 0;
        } else {
          ly = 0;
          lz = Math.sin(a) * r;
        }

        // Parent gyroscope tilt: rotate around X then Y.
        // Rotate around X axis (affects y, z)
        const y1 = ly * cosTX - lz * sinTX;
        const z1 = ly * sinTX + lz * cosTX;
        // Rotate around Y axis (affects x, z)
        const x2 = lx * cosTY + z1 * sinTY;
        const z2 = -lx * sinTY + z1 * cosTY;
        const y2 = y1;

        // Perspective projection
        const depth = PERSPECTIVE / (PERSPECTIVE + z2);
        const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, depth));
        const sx = x2 * depth;
        const sy = y2 * depth;

        // Front particles brighter; back dimmer.
        // With perspective P/(P+z2), negative z2 is closer to the camera,
        // so "front" must be derived from -z2.
        const front = (-z2 + ringRadius) / (ringRadius * 2); // ~0..1
        const depthAlpha = 0.35 + Math.max(0, Math.min(1, front)) * 0.65;
        const a01 = p.alpha * depthAlpha * displayOpacity;
        if (a01 < 0.01) continue;

        const drawSize = p.size * scale * 4.5; // stamp is soft, so scale up
        ctx.globalAlpha = a01;
        ctx.drawImage(
          stamp,
          sx - drawSize / 2,
          sy - drawSize / 2,
          drawSize,
          drawSize,
        );
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerenter", onEnter);
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
    <div className="relative min-h-screen w-full overflow-hidden bg-[#f5fbff] text-slate-900 flex flex-col">
      <StaticBackdrop />
      <RingParticleField />

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
