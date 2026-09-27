import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { parseDelverCsv } from "./delver-import";

describe("stock CSV export", () => {
  it("escapes quotes, commas and newlines", () => {
    const out = toCsv(["a", "b"], [['He said "hi"', "x,y"], ["line\nbreak", null]]);
    expect(out).toBe('﻿a,b\r\n"He said ""hi""","x,y"\r\n"line\nbreak",\r\n');
  });

  it("reads back through the Delver importer", () => {
    // Same header order as /api/admin/stock/export.
    const csv = toCsv(
      ["Name", "Game", "Set Code", "Set Name", "Collector Number", "Foil", "Condition",
        "Language", "Quantity", "Reserved", "Available", "Sale Price USD",
        "Manual Price USD", "Reference Price USD", "Scryfall ID"],
      [
        ["Serra Angel", "mtg", "4ED", "Fourth Edition", "40", "", "LP", "es", 3, 1, 2, "1.00", "", "0.50", "abc-123"],
        ["Shivan Dragon", "mtg", "LEB", "Beta", "175", "foil", "NM", "en", 1, 0, 1, "", "", "", "def-456"],
      ],
    );
    expect(parseDelverCsv(csv)).toEqual([
      { scryfallId: "abc-123", quantity: 3, foil: false, condition: "LP", language: "es", name: "Serra Angel" },
      { scryfallId: "def-456", quantity: 1, foil: true, condition: "NM", language: "en", name: "Shivan Dragon" },
    ]);
  });
});
