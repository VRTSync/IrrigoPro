import { LayoutGrid, List as ListIcon } from "lucide-react";

export type EstimatesView = "board" | "list";

interface Props {
  value: EstimatesView;
  onChange: (next: EstimatesView) => void;
}

export function BoardListToggle({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex rounded-md border border-gray-200 bg-white p-0.5"
    >
      <button
        role="tab"
        type="button"
        aria-selected={value === "board"}
        onClick={() => onChange("board")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded ${
          value === "board"
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
        data-testid="view-toggle-board"
      >
        <LayoutGrid className="w-4 h-4" />
        Board
      </button>
      <button
        role="tab"
        type="button"
        aria-selected={value === "list"}
        onClick={() => onChange("list")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded ${
          value === "list"
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
        data-testid="view-toggle-list"
      >
        <ListIcon className="w-4 h-4" />
        List
      </button>
    </div>
  );
}
