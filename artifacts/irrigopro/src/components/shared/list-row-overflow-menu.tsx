import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export interface ListRowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  hidden?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  separator?: boolean;
}

interface ListRowOverflowMenuProps {
  actions: ListRowAction[];
  triggerTestId?: string;
}

export function ListRowOverflowMenu({ actions, triggerTestId }: ListRowOverflowMenuProps) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-60 hover:opacity-100"
          data-testid={triggerTestId ?? "row-overflow-menu"}
          onClick={(e) => e.stopPropagation()}
          aria-label="Row actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {visible.map((action, idx) => (
          <React.Fragment key={idx}>
            {action.separator && idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              disabled={action.disabled}
              className={action.destructive ? "text-red-600 focus:text-red-600" : undefined}
            >
              {action.icon && (
                <span className="mr-2 flex-shrink-0">{action.icon}</span>
              )}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
