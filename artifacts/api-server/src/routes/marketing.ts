import { Router, type IRouter } from "express";
import cors, { type CorsOptions } from "cors";
import { z } from "zod";
import { db, marketingLeads } from "@workspace/db";
import { EmailService } from "../email-service";

const router: IRouter = Router();

// The marketing site lives on a different origin (irrigopro.com / www
// .irrigopro.com) from the IrrigoPro app's API (app.irrigopro.com), so the
// /marketing-leads endpoint needs explicit CORS. Other API routes stay
// behind the global CORS middleware in app.ts.
const MARKETING_LEADS_ALLOWED_ORIGINS = new Set<string>([
  "https://irrigopro.com",
  "https://www.irrigopro.com",
  // Local dev for the standalone marketing site (Vite default port).
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const marketingLeadsCorsOptions: CorsOptions = {
  origin(origin, callback) {
    // Same-origin / non-browser requests (no Origin header) are always allowed.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (MARKETING_LEADS_ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed for /marketing-leads`));
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
  maxAge: 86400,
};

const marketingLeadsCors = cors(marketingLeadsCorsOptions);
router.options("/marketing-leads", marketingLeadsCors);

const leadSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(1, "Phone is required").max(50),
  numTechnicians: z
    .union([z.number().int().nonnegative(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "numTechnicians must be a non-negative integer",
        });
        return z.NEVER;
      }
      return n;
    }),
  message: z.string().trim().max(5000).optional().or(z.literal("")),
});

router.post("/marketing-leads", marketingLeadsCors, async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const [lead] = await db
      .insert(marketingLeads)
      .values({
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone || null,
        numTechnicians: data.numTechnicians ?? null,
        message: data.message || null,
      })
      .returning();

    // Reuse the existing Postmark client/EmailService rather than spinning up
    // a second client inline. Failures here are logged but don't fail the
    // request — we already saved the lead in the database.
    void EmailService.sendMarketingLeadNotification({
      companyName: data.companyName,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone || null,
      numTechnicians: data.numTechnicians ?? null,
      message: data.message || null,
    }).catch((err) => {
      req.log.warn(
        { err },
        "Failed to send marketing lead notification email",
      );
    });

    return res.status(201).json({ id: lead.id, ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save marketing lead");
    return res.status(500).json({ error: "Failed to save lead" });
  }
});

export default router;
