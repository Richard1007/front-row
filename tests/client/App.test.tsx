// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../src/client/App";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ providers: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("simple preference form", () => {
  it("shows four preference sections without editable coordinates", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Artists you most want to see" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Music styles you enjoy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Performance language" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Location" })).toBeTruthy();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
  });

  it("limits categorical language selection to three", () => {
    render(<App />);

    const languageSection = screen.getByRole("heading", { name: "Performance language" })
      .closest("section")!;
    const languageControls = within(languageSection);
    fireEvent.click(languageControls.getByRole("button", { name: "Chinese / Mandarin" }));
    fireEvent.click(languageControls.getByRole("button", { name: "English" }));
    fireEvent.click(languageControls.getByRole("button", { name: "French" }));

    expect((languageControls.getByRole("button", { name: "Cantonese" }) as HTMLButtonElement).disabled).toBe(true);
    expect(languageControls.getByText("3 / 3")).toBeTruthy();
  });

  it("loads a confirmed Oakland example without exposing its coordinates", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Try the Wang Leehom example" }));

    expect((screen.getByLabelText("artist 1 name") as HTMLInputElement).value).toBe("王力宏");
    expect((screen.getByRole("combobox", { name: "City" }) as HTMLInputElement).value)
      .toBe("Oakland, California, United States");
    expect(screen.queryByDisplayValue("37.8044")).toBeNull();
  });
});
