import { useState, useRef, useEffect, createContext, useContext } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── One-at-a-time coordinator ───────────────────────────────────────────────
// Wrap any editable surface (modal, card, page) with <InlineEditProvider> so
// opening one field auto-cancels any other open field on that surface.

interface InlineEditCtx {
  activeField: string | null;
  setActiveField: (id: string | null) => void;
}

const InlineEditContext = createContext<InlineEditCtx>({
  activeField: null,
  setActiveField: () => {},
});

export function InlineEditProvider({ children }: { children: React.ReactNode }) {
  const [activeField, setActiveField] = useState<string | null>(null);
  return (
    <InlineEditContext.Provider value={{ activeField, setActiveField }}>
      {children}
    </InlineEditContext.Provider>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────
type FieldType = "text" | "textarea" | "date" | "number" | "select";

export interface SelectOption { label: string; value: string; }

interface EditableFieldProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  canEdit: boolean;
  type?: FieldType;
  options?: SelectOption[];
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  children?: React.ReactNode;
  validate?: (v: string) => string | null;
  min?: number;
  max?: number;
  step?: number;
  inputClassName?: string;
  /** Unique id within the nearest InlineEditProvider — ensures only one field is open at a time. */
  fieldId?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function EditableField({
  value,
  onSave,
  canEdit,
  type = "text",
  options,
  placeholder,
  className,
  displayClassName,
  children,
  validate,
  min,
  max,
  step,
  inputClassName,
  fieldId,
}: EditableFieldProps) {
  const { activeField, setActiveField } = useContext(InlineEditContext);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  // Auto-cancel when another field becomes active on the same surface.
  // Blocked while a save is in-flight so the PATCH can land before the field closes.
  useEffect(() => {
    if (fieldId && activeField !== null && activeField !== fieldId && isEditing && !isSaving) {
      setIsEditing(false);
      setDraft(value);
      setError(null);
    }
  }, [activeField, fieldId, isEditing, isSaving, value]);

  // Sync draft when value changes while not editing
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (!isEditing) return;
    setDraft(value);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing]);

  const startEditing = () => {
    if (fieldId) setActiveField(fieldId);
    setIsEditing(true);
  };

  const finishEditing = () => {
    setIsEditing(false);
    if (fieldId) setActiveField(null);
  };

  const handleSave = async () => {
    if (validate) {
      const err = validate(draft);
      if (err) { setError(err); return; }
    }
    if (draft === value) { finishEditing(); return; }
    setIsSaving(true);
    try {
      await onSave(draft);
      finishEditing();
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(value);
    setError(null);
    finishEditing();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); handleCancel(); return; }
    if (e.key === "Enter") {
      if (type === "textarea") {
        // Plain Enter inserts a newline; Cmd/Ctrl+Enter saves.
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); handleSave(); }
      } else {
        e.preventDefault(); handleSave();
      }
    }
  };

  // ─── Display mode ──────────────────────────────────────────────────────────
  if (!isEditing) {
    return (
      <div className={cn("group flex items-start gap-1", className)}>
        <div className={cn("flex-1 min-w-0", displayClassName)}>
          {children ?? <span className="text-sm text-gray-900 leading-snug">{value || "—"}</span>}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={startEditing}
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

  // ─── Edit mode ─────────────────────────────────────────────────────────────
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
        ) : type === "select" ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex-1 h-8 text-sm rounded-md border border-input bg-background px-3 py-1",
              "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              inputClassName,
            )}
            data-testid="editable-field-select"
          >
            {options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
            title={type === "textarea" ? "Save (⌘Enter / Ctrl+Enter)" : "Save (Enter)"}
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
