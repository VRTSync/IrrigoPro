import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { safeSet } from "@/utils/safeStorage";
import irrigoProLockup from "@assets/IrrigoPro_2026-01_1778195033342.png";
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
      [210, 67, 36], [210, 67, 46], [212, 77, 28],
      [201, 70, 60], [201, 70, 70], [201, 80, 50],
      [205, 68, 55], [199, 65, 75], [212, 60, 32],
      [89, 50, 50], [89, 50, 60], [94, 57, 40],
    ];

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
      {/* Animated water-drop particle field */}
      <WaterDropletField />

      {/* Spotlight wash behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)",
        }}
      />

      <div className="pointer-events-auto relative z-10 flex-1 flex items-center justify-center p-4 md:p-8">
        {/* ── Outer animated gradient frame ── */}
        <div className="relative w-full max-w-5xl group">
          {/* Rotating conic glow halo */}
          <div
            aria-hidden
            className="absolute -inset-px rounded-[2rem] opacity-80 blur-[2px] [animation:spin_8s_linear_infinite]"
            style={{
              background:
                "conic-gradient(from 0deg, #1E5A99, #7DC4E8, #7DBE3F, #0E3B6B, #1E5A99)",
            }}
          />
          {/* Soft outer glow */}
          <div
            aria-hidden
            className="absolute -inset-6 rounded-[2.5rem] opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(60% 60% at 30% 30%, rgba(30,90,153,0.55), transparent 70%), radial-gradient(60% 60% at 80% 70%, rgba(125,190,63,0.45), transparent 70%)",
            }}
          />

          {/* ── The card itself ── */}
          <div className="relative grid md:grid-cols-[5fr_6fr] overflow-hidden rounded-[1.95rem] bg-white/85 backdrop-blur-2xl shadow-[0_30px_80px_-20px_rgba(14,59,107,0.45)] ring-1 ring-white/40">

            {/* ─── LEFT brand panel ─── */}
            <div className="relative isolate flex flex-col items-center justify-center overflow-hidden p-8 md:p-12 text-white"
              style={{
                background:
                  "radial-gradient(120% 100% at 50% 0%, #1E5A99 0%, #0E3B6B 55%, #08254A 100%)",
              }}
            >
              {/* Subtle dot grid overlay */}
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.18] mix-blend-screen"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(255,255,255,0.7) 1.2px, transparent 1.2px)",
                  backgroundSize: "22px 22px",
                  maskImage:
                    "radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%)",
                }}
              />
              {/* Diagonal sheen */}
              <div
                aria-hidden
                className="absolute inset-0 opacity-30 mix-blend-soft-light"
                style={{
                  background:
                    "linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                }}
              />
              {/* Green accent corner glow */}
              <div
                aria-hidden
                className="absolute -bottom-20 -right-16 h-72 w-72 rounded-full opacity-60 blur-3xl"
                style={{ background: "radial-gradient(circle, #7DBE3F 0%, transparent 65%)" }}
              />

              <div className="relative z-10 flex flex-col items-center text-center">
                <img
                  src={irrigoProLockup}
                  alt="IrrigoPro — Smart Irrigation"
                  className="w-56 md:w-72 h-auto drop-shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
                />
                <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-200/90">
                  Smart Irrigation Operations
                </p>
                <h2 className="mt-3 text-2xl md:text-[1.65rem] font-bold leading-tight text-white max-w-xs">
                  Run your whole crew from one badass app.
                </h2>
                <p className="mt-3 text-sm text-sky-100/75 max-w-xs leading-relaxed">
                  Estimates, work orders, wet checks, billing — built for the field, dialed in for the office.
                </p>

                <div className="mt-7 flex items-center gap-2 text-[11px] font-medium text-sky-100/80">
                  <ShieldCheck className="h-4 w-4 text-[#7DBE3F]" />
                  <span>Encrypted in transit · SOC-grade hosting</span>
                </div>
              </div>
            </div>

            {/* ─── RIGHT form panel ─── */}
            <div className="relative bg-white/70 backdrop-blur-xl px-6 py-9 md:px-12 md:py-14">
              {/* Brand bar accent */}
              <div
                aria-hidden
                className="absolute left-0 top-0 h-full w-[3px] hidden md:block"
                style={{
                  background:
                    "linear-gradient(180deg, transparent 0%, #1E5A99 30%, #7DBE3F 70%, transparent 100%)",
                }}
              />

              <div className="mb-7 md:mb-9">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#1E5A99]/80">
                  Welcome back
                </p>
                <h1 className="mt-2 text-3xl md:text-[2rem] font-bold tracking-tight text-slate-900">
                  Sign in to <span className="text-[#1E5A99]">IrrigoPro</span>
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  Pick up exactly where you left off in the field.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {/* Username */}
                <div className="group/field">
                  <Label
                    htmlFor="username"
                    className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                  >
                    Username
                  </Label>
                  <div className="relative mt-1.5">
                    <User className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within/field:text-[#1E5A99] transition-colors" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="your.username"
                      autoComplete="username"
                      value={credentials.username}
                      onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                      required
                      data-testid="input-username"
                      className="h-14 pl-12 pr-4 bg-white/95 border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl text-base shadow-sm transition-all focus:border-[#1E5A99] focus:ring-4 focus:ring-[#1E5A99]/15 focus:shadow-[0_8px_24px_-8px_rgba(30,90,153,0.4)]"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="group/field">
                  <div className="flex items-baseline justify-between">
                    <Label
                      htmlFor="password"
                      className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                    >
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={() => (window.location.href = "/forgot-password")}
                      data-testid="link-forgot-password"
                      className="text-xs font-medium text-[#1E5A99] hover:text-[#0E3B6B] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within/field:text-[#1E5A99] transition-colors" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={credentials.password}
                      onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                      required
                      data-testid="input-password"
                      className="h-14 pl-12 pr-4 bg-white/95 border border-slate-200 text-slate-900 placeholder-slate-400 rounded-xl text-base shadow-sm transition-all focus:border-[#1E5A99] focus:ring-4 focus:ring-[#1E5A99]/15 focus:shadow-[0_8px_24px_-8px_rgba(30,90,153,0.4)]"
                    />
                  </div>
                </div>

                {/* Sign In button — gradient with arrow that slides on hover */}
                <Button
                  type="submit"
                  size="lg"
                  data-testid="button-login"
                  disabled={isLoading}
                  className="relative w-full h-14 overflow-hidden rounded-xl text-white font-semibold text-base tracking-wide shadow-[0_10px_30px_-8px_rgba(30,90,153,0.6)] transition-all duration-200 hover:shadow-[0_16px_36px_-10px_rgba(30,90,153,0.7)] hover:-translate-y-[1px] active:translate-y-0 disabled:opacity-80 disabled:cursor-not-allowed border-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #1E5A99 0%, #2A6EB8 50%, #0E3B6B 100%)",
                  }}
                >
                  {/* Shine sweep */}
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                  />
                  <span className="relative flex items-center justify-center gap-2">
                    {isLoading ? (
                      <>
                        <span className="h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
                      </>
                    )}
                  </span>
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

              <div className="mt-8 flex items-center gap-3 text-[11px] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="uppercase tracking-[0.22em]">Secure access</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10">
        <PoweredByFooter />
      </div>
    </div>
  );
}
