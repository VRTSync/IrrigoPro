import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const formSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  contactName: z.string().trim().min(1, "Your name is required").max(200),
  email: z.string().trim().email("Please enter a valid email").max(200),
  phone: z.string().trim().min(1, "Phone is required").max(50),
  numTechnicians: z
    .string()
    .optional()
    .refine(
      (v) => !v || (/^\d+$/.test(v) && parseInt(v, 10) >= 0),
      "Enter a whole number",
    ),
  message: z.string().max(5000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function DemoForm() {
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      numTechnicians: "",
      message: "",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const payload = {
        companyName: values.companyName,
        contactName: values.contactName,
        email: values.email,
        phone: values.phone,
        numTechnicians: values.numTechnicians
          ? parseInt(values.numTechnicians, 10)
          : undefined,
        message: values.message || undefined,
      };
      const res = await fetch("/api/marketing-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      setSubmitted(true);
      reset();
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  if (submitted) {
    return (
      <div
        className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm"
        data-testid="demo-success"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-2xl font-bold text-foreground">
          Thanks — we'll be in touch.
        </h3>
        <p className="mt-2 text-muted-foreground">
          A member of the IrrigoPro team will reach out within one business day
          to schedule your walkthrough.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => setSubmitted(false)}
          data-testid="button-submit-another"
        >
          Submit another request
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
      noValidate
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          id="companyName"
          label="Company name"
          error={errors.companyName?.message}
        >
          <Input
            id="companyName"
            placeholder="Sunset Irrigation Co."
            data-testid="input-company-name"
            {...register("companyName")}
          />
        </Field>
        <Field
          id="contactName"
          label="Your name"
          error={errors.contactName?.message}
        >
          <Input
            id="contactName"
            placeholder="Pat Rivera"
            data-testid="input-contact-name"
            {...register("contactName")}
          />
        </Field>
        <Field id="email" label="Work email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            placeholder="pat@sunsetirrigation.com"
            data-testid="input-email"
            {...register("email")}
          />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            placeholder="(555) 555-0123"
            data-testid="input-phone"
            {...register("phone")}
          />
        </Field>
        <Field
          id="numTechnicians"
          label="Field technicians"
          hint="Optional"
          error={errors.numTechnicians?.message}
        >
          <Input
            id="numTechnicians"
            type="number"
            min={0}
            placeholder="6"
            data-testid="input-num-techs"
            {...register("numTechnicians")}
          />
        </Field>
        <Field id="message" label="Anything we should know?" hint="Optional" className="sm:col-span-2" error={errors.message?.message}>
          <Textarea
            id="message"
            rows={4}
            placeholder="Tell us about your current workflow, pain points, or what you'd like to see in the demo."
            data-testid="input-message"
            {...register("message")}
          />
        </Field>
      </div>

      {serverError ? (
        <p className="mt-4 text-sm text-destructive" data-testid="text-server-error">
          {serverError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          We'll only use your info to contact you about IrrigoPro. No spam, ever.
        </p>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="brand-gradient h-11 w-full text-white shadow-md sm:w-auto"
          data-testid="button-submit-demo"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Request a demo"
          )}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-destructive" data-testid={`error-${id}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
