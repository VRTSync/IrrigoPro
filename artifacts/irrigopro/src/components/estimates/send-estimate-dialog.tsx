import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;
const MAX_NOTE = 2000;

const isValidEmail = (v: string): boolean => EMAIL_RE.test(v.trim());

export interface SendEstimatePayload {
  to: string;
  cc: string[];
  bcc: string[];
  note?: string;
}

interface SendEstimateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  isSending: boolean;
  onSend: (payload: SendEstimatePayload) => void | Promise<void>;
}

function ChipList({
  label,
  values,
  onChange,
  testIdPrefix,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  testIdPrefix: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!isValidEmail(v)) {
      setError(`"${v}" is not a valid email address`);
      return;
    }
    if (values.includes(v)) {
      setError(`${v} is already in the list`);
      return;
    }
    if (values.length >= MAX_RECIPIENTS) {
      setError(`At most ${MAX_RECIPIENTS} addresses`);
      return;
    }
    onChange([...values, v]);
    setDraft("");
    setError(null);
  };

  const remove = (v: string) => onChange(values.filter((x) => x !== v));

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-gray-700">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge
            key={v}
            variant="secondary"
            className="gap-1 pl-2 pr-1 py-0.5"
            data-testid={`${testIdPrefix}-chip-${v}`}
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="ml-0.5 text-gray-500 hover:text-gray-900"
              aria-label={`Remove ${v}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        type="email"
        placeholder="name@example.com — press Enter to add"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit();
        }}
        disabled={values.length >= MAX_RECIPIENTS}
        data-testid={`${testIdPrefix}-input`}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function SendEstimateDialog({
  open,
  onOpenChange,
  estimateNumber,
  customerName,
  customerEmail,
  isSending,
  onSend,
}: SendEstimateDialogProps) {
  const initialTo = (customerEmail ?? "").trim();
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [toError, setToError] = useState<string | null>(null);

  // Reset state every time the dialog reopens for a (possibly) new estimate.
  useEffect(() => {
    if (open) {
      setTo((customerEmail ?? "").trim());
      setCc([]);
      setBcc([]);
      setNote("");
      setToError(null);
    }
  }, [open, customerEmail]);

  const toValid = useMemo(() => isValidEmail(to), [to]);
  const noteOver = note.length > MAX_NOTE;
  const canSend = toValid && !noteOver && !isSending;

  const submit = () => {
    if (!toValid) {
      setToError("Please enter a valid email address");
      return;
    }
    void onSend({
      to: to.trim(),
      cc,
      bcc,
      note: note.trim() ? note.trim() : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="send-estimate-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Send estimate
            {estimateNumber && (
              <span className="text-sm font-normal text-gray-500">
                · {estimateNumber}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {customerName
              ? `Send the approval email for ${customerName}. You can change the recipient or add Cc/Bcc.`
              : "Send the estimate approval email. You can change the recipient or add Cc/Bcc."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="send-estimate-to" className="text-sm font-medium text-gray-700">
              To
            </Label>
            <Input
              id="send-estimate-to"
              type="email"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (toError) setToError(null);
              }}
              placeholder="customer@example.com"
              data-testid="send-estimate-to"
            />
            {toError && <p className="text-xs text-red-600">{toError}</p>}
            {!toError && !toValid && to.length > 0 && (
              <p className="text-xs text-red-600">Please enter a valid email address</p>
            )}
          </div>

          <ChipList label="Cc (optional)" values={cc} onChange={setCc} testIdPrefix="send-estimate-cc" />
          <ChipList label="Bcc (optional)" values={bcc} onChange={setBcc} testIdPrefix="send-estimate-bcc" />

          <div className="space-y-1.5">
            <Label htmlFor="send-estimate-note" className="text-sm font-medium text-gray-700">
              Note (optional)
            </Label>
            <Textarea
              id="send-estimate-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a short message that will appear above the estimate summary in the email."
              data-testid="send-estimate-note"
            />
            <div className={`text-xs ${noteOver ? "text-red-600" : "text-gray-500"}`}>
              {note.length}/{MAX_NOTE}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
            data-testid="send-estimate-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSend}
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="send-estimate-send"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Send email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
