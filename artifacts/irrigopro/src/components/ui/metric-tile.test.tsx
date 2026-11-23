import { render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import { expect, it } from "vitest";
import { MetricTile } from "./metric-tile";

it("hides the icon and shrinks the value at narrow widths", () => {
  const { container } = render(<MetricTile label="Pending" value={1234} icon={Clock} />);

  expect(container.querySelector("svg")?.parentElement).toHaveClass("hidden", "sm:block");
  expect(screen.getByText("Pending")).toHaveClass("break-words");
  const value = screen.getByText("1234");
  expect(value).toHaveClass("text-2xl", "sm:text-3xl", "break-words");
  expect(value.parentElement).toHaveClass("min-w-0");
});
