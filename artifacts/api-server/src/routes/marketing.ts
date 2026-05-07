import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, marketingLeads } from "@workspace/db";
import { Client as PostmarkClient } from "postmark";

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

    const token = process.env.POSTMARK_API_TOKEN;
    const toAddr =
      process.env.MARKETING_LEAD_TO_EMAIL || process.env.LEADS_NOTIFY_EMAIL;
    const fromAddr =
      process.env.MARKETING_LEAD_FROM_EMAIL || process.env.POSTMARK_FROM_EMAIL;
    if (token && toAddr && fromAddr) {
      try {
        const client = new PostmarkClient(token);
        const lines = [
          `Company: ${data.companyName}`,
          `Contact: ${data.contactName}`,
          `Email: ${data.email}`,
          `Phone: ${data.phone || "(not provided)"}`,
          `Technicians: ${data.numTechnicians ?? "(not provided)"}`,
          ``,
          `Message:`,
          data.message || "(none)",
        ];
        await client.sendEmail({
          From: fromAddr,
          To: toAddr,
          Subject: `New IrrigoPro demo request — ${data.companyName}`,
          TextBody: lines.join("\n"),
          ReplyTo: data.email,
          MessageStream: "outbound",
        });
      } catch (mailErr) {
        req.log.warn(
          { err: mailErr },
          "Failed to send marketing lead notification email",
        );
      }
    } else {
      req.log.info(
        { hasToken: !!token, hasTo: !!toAddr, hasFrom: !!fromAddr },
        "Marketing lead saved but email not sent (Postmark not fully configured)",
      );
    }

    return res.status(201).json({ id: lead.id, ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save marketing lead");
    return res.status(500).json({ error: "Failed to save lead" });
  }
});

export default router;
