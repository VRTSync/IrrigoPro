import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LaborHoursStepper } from "./labor-hours-stepper";

describe("LaborHoursStepper", () => {
  it('renders "0.25 hrs" for value "0.25"', () => {
    render(<LaborHoursStepper value="0.25" onChange={() => {}} />);
    expect(screen.getByTestId("labor-stepper-display")).toHaveTextContent("0.25 hrs");
  });

  it('renders "1.50 hrs" for value "1.50"', () => {
    render(<LaborHoursStepper value="1.50" onChange={() => {}} />);
    expect(screen.getByTestId("labor-stepper-display")).toHaveTextContent("1.50 hrs");
  });

  it('+ from "0.25" calls onChange with "0.50"', async () => {
    const onChange = vi.fn();
    render(<LaborHoursStepper value="0.25" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("labor-stepper-plus"));
    expect(onChange).toHaveBeenCalledWith("0.50");
  });

  it('− at minimum "0.25" does not call onChange (button is disabled)', async () => {
    const onChange = vi.fn();
    render(<LaborHoursStepper value="0.25" onChange={onChange} />);
    const minusBtn = screen.getByTestId("labor-stepper-minus");
    expect(minusBtn).toBeDisabled();
    await userEvent.click(minusBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('− from "0.50" calls onChange with "0.25"', async () => {
    const onChange = vi.fn();
    render(<LaborHoursStepper value="0.50" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("labor-stepper-minus"));
    expect(onChange).toHaveBeenCalledWith("0.25");
  });

  it("disabled prop locks both buttons and neither fires onChange", async () => {
    const onChange = vi.fn();
    render(<LaborHoursStepper value="0.50" onChange={onChange} disabled />);
    const plusBtn = screen.getByTestId("labor-stepper-plus");
    const minusBtn = screen.getByTestId("labor-stepper-minus");
    expect(plusBtn).toBeDisabled();
    expect(minusBtn).toBeDisabled();
    await userEvent.click(plusBtn);
    await userEvent.click(minusBtn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
