import * as React from "react";
import { Button } from "@/components/ui/button";

interface ListPageEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  testId?: string;
}

export function ListPageEmptyState({
  icon: Icon,
  title,
  description,
  cta,
  testId,
}: ListPageEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid={testId ?? "list-empty-state"}
    >
      <Icon className="w-14 h-14 text-gray-300 mb-4" />
      <h3 className="text-lg font-semibold text-gray-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6">{description}</p>
      {cta && (
        <Button onClick={cta.onClick} variant="outline" size="sm">
          {cta.label}
        </Button>
      )}
    </div>
  );
}
