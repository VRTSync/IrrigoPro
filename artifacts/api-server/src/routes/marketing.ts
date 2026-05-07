import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, marketingLeads } from "@workspace/db";
import { EmailService } from "../email-service";

const router: IRouter = Router();

const leadSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  numTechnicians: z
    .union([z.number().int().nonnegative(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return undefined;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }),
  message: z.string().trim().max(5000).optional().or(z.literal("")),
});

router.post("/marketing-leads", async (req, res) => {
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
