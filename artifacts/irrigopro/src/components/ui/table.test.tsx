import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableRow } from "./table";

describe("Table stacked mode", () => {
  it.each([true, undefined])("only opts into stacked styling with stack=%s", (stack) => {
    render(<Table stack={stack} />);
    const table = screen.getByRole("table");

    if (stack) {
      expect(table).toHaveClass("table-stack");
      expect(table.parentElement).toHaveClass("table-stack-container");
    } else {
      expect(table).not.toHaveClass("table-stack");
      expect(table.parentElement).not.toHaveClass("table-stack-container");
    }
    expect(table).not.toHaveAttribute("stack");
  });

  it("only adds data-label to cells with a label", () => {
    render(
      <Table stack>
        <TableBody>
          <TableRow>
            <TableCell label="Customer">Acme</TableCell>
            <TableCell>Edit</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("cell", { name: "Acme" })).toHaveAttribute("data-label", "Customer");
    expect(screen.getByRole("cell", { name: "Edit" })).not.toHaveAttribute("data-label");
  });
});
