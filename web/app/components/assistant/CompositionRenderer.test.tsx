import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssistantCompositionBlock } from "~/lib/assistant";
import { CompositionRenderer } from "./CompositionRenderer";

afterEach(cleanup);

const composition: AssistantCompositionBlock = {
  type: "composition",
  title: "30-day supply view",
  summary: "Authorized operational data.",
  language: "en",
  sources: [{ sourceId: "source_inventory", tool: "reports.inventory", status: "ok" }],
  sections: [{
    id: "overview",
    title: "Overview",
    layout: "grid",
    blocks: [
      { id: "narrative", type: "narrative", width: "full", sourceIds: ["source_inventory"], content: "O positive requires attention." },
      { id: "metrics", type: "metrics", width: "half", sourceIds: ["source_inventory"], items: [{ label: "Available units", value: 18 }] },
      { id: "groups", type: "table", width: "half", sourceIds: ["source_inventory"], title: "Inventory", columns: [{ key: "bloodGroup", label: "Blood group" }, { key: "units", label: "Units" }], rows: [{ bloodGroup: "O+", units: 12 }], total: 1, truncated: false },
      { id: "ranking", type: "ranked_list", width: "full", sourceIds: ["source_inventory"], title: "Highest stock", items: [{ rank: 1, label: "O+", value: 12 }] },
    ],
  }],
};

describe("CompositionRenderer", () => {
  it("renders an API-resolved composition without interpreting arbitrary markup", () => {
    render(<CompositionRenderer composition={composition} />);

    expect(screen.getByRole("heading", { name: "30-day supply view" })).toBeTruthy();
    expect(screen.getByText("Available units")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Blood group" })).toBeTruthy();
    expect(screen.getByText(/reports\.inventory/)).toBeTruthy();
  });
});
