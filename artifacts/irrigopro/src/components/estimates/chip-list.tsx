import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;

const isValidEmail = (v: string): boolean => EMAIL_RE.test(v.trim());

export function ChipList({
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
