import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageHeader } from "./page-header";

it("lets the actions wrap below the title and each other", () => {
  render(
    <PageHeader
      title="Missing Photos"
      actions={
        <>
          <button>Download CSV</button>
          <button>Notify technicians</button>
        </>
      }
    />,
  );

  const titleBlock = screen.getByRole("heading", { name: "Missing Photos" }).parentElement?.parentElement;
  const actions = screen.getByRole("button", { name: "Download CSV" }).parentElement;

  expect(titleBlock).toHaveClass("basis-56");
  expect(titleBlock?.parentElement).toHaveClass("flex-wrap");
  expect(actions).toContainElement(screen.getByRole("button", { name: "Notify technicians" }));
  expect(actions).toHaveClass("flex-wrap");
  expect(actions).not.toHaveClass("flex-shrink-0");
});
