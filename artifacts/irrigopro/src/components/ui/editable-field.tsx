import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FieldType = "text" | "textarea" | "date" | "number";

interface EditableFieldProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  canEdit: boolean;
  type?: FieldType;
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  children?: React.ReactNode;
  validate?: (v: string) => string | null;
  min?: number;
  max?: number;
  step?: number;
  inputClassName?: string;
}

export function EditableField({
  value,
  onSave,
  canEdit,
  type = "text",
  placeholder,
  className,
  displayClassName,
  children,
  validate,
  min,
  max,
  step,
  inputClassName,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(value);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  const handleSave = async () => {
    if (validate) {
      const err = validate(draft);
      if (err) { setError(err); return; }
    }
    if (draft === value) { setIsEditing(false); return; }
    setIsSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setDraft(value);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); handleCancel(); return; }
    if (e.key === "Enter" && type !== "textarea") { e.preventDefault(); handleSave(); }
  };

  if (!isEditing) {
    return (
      <div className={cn("group flex items-start gap-1", className)}>
        <div className={cn("flex-1 min-w-0", displayClassName)}>
          {children ?? <span className="text-sm text-gray-900 leading-snug">{value || "—"}</span>}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded text-gray-400 hover:text-blue-600 mt-0.5"
            title="Edit"
            data-testid="editable-field-pencil"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-start gap-1">
        {type === "textarea" ? (
          <Textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            className={cn("flex-1 text-sm min-h-[72px]", inputClassName)}
            data-testid="editable-field-textarea"
          />
        ) : (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            className={cn("flex-1 h-8 text-sm", inputClassName)}
            data-testid="editable-field-input"
          />
        )}
        <div className="flex gap-0.5 flex-shrink-0 mt-0.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="p-1 rounded text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
            title="Save (Enter)"
            data-testid="editable-field-save"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
            title="Cancel (Esc)"
            data-testid="editable-field-cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 leading-snug">{error}</p>}
    </div>
  );
}
