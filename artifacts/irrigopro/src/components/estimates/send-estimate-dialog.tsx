import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Paperclip } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ChipList } from "./chip-list";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTE = 2000;
const ATTACH_PDF_KEY = "irrigopro:estimateSendAttachPdf";

const isValidEmail = (v: string): boolean => EMAIL_RE.test(v.trim());

export interface SendEstimatePayload {
  to: string;
  cc: string[];
  bcc: string[];
  note?: string;
  // Task #1791 — opt-in PDF attachment.
  attachPdf?: boolean;
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


function readAttachPdfPref(): boolean {
  try {
    return localStorage.getItem(ATTACH_PDF_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAttachPdfPref(value: boolean): void {
  try {
    localStorage.setItem(ATTACH_PDF_KEY, value ? "true" : "false");
  } catch {
    // Ignore — localStorage may be unavailable in some environments.
  }
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
  // Task #1791 — persist the checkbox state across dialog opens via localStorage.
  const [attachPdf, setAttachPdf] = useState<boolean>(false);

  // Load the persisted preference once on mount.
  useEffect(() => {
    setAttachPdf(readAttachPdfPref());
  }, []);

  // Reset per-send fields every time the dialog reopens for a (possibly) new estimate.
  // The attachPdf preference is NOT reset — it persists across opens.
  useEffect(() => {
    if (open) {
      setTo((customerEmail ?? "").trim());
      setCc([]);
      setBcc([]);
      setNote("");
      setToError(null);
    }
  }, [open, customerEmail]);

  const handleAttachPdfChange = (checked: boolean) => {
    setAttachPdf(checked);
    writeAttachPdfPref(checked);
  };

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
      attachPdf,
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

          {/* Task #1791 — Attach PDF opt-in. Preference is persisted to
              localStorage so managers who always attach don't re-tick every time. */}
          <div className="flex items-center gap-2.5 pt-1">
            <Checkbox
              id="send-estimate-attach-pdf"
              checked={attachPdf}
              onCheckedChange={(checked) => handleAttachPdfChange(Boolean(checked))}
              data-testid="send-estimate-attach-pdf"
            />
            <label
              htmlFor="send-estimate-attach-pdf"
              className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
            >
              <Paperclip className="w-3.5 h-3.5 text-gray-500" />
              Attach PDF
            </label>
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
