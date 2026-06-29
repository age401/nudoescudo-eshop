import { describe, expect, it } from "vitest";
import { computeUnitPriceUsd, formatUsd, formatUyu, round2, usdToUyu } from "./pricing";

describe("computeUnitPriceUsd", () => {
  it("applies the multiplier to the reference price", () => {
    expect(
      computeUnitPriceUsd({ referenceUsd: 10, overrideUsd: null, multiplier: 0.9 }),
    ).toBe(9);
  });

  it("prefers the manual override and ignores the multiplier", () => {
    expect(
      computeUnitPriceUsd({ referenceUsd: 10, overrideUsd: 7.5, multiplier: 0.9 }),
    ).toBe(7.5);
  });

  it("returns null without reference or override", () => {
    expect(
      computeUnitPriceUsd({ referenceUsd: null, overrideUsd: null, multiplier: 1 }),
    ).toBeNull();
  });

  it("uses the override even without a reference price", () => {
    expect(
      computeUnitPriceUsd({ referenceUsd: null, overrideUsd: 3, multiplier: 1 }),
    ).toBe(3);
  });

  it("rounds to cents", () => {
    expect(
      computeUnitPriceUsd({ referenceUsd: 0.99, overrideUsd: null, multiplier: 1.15 }),
    ).toBe(1.14);
  });

  it("lifts an auto-computed price up to the minimum", () => {
    expect(
      computeUnitPriceUsd({
        referenceUsd: 0.05,
        overrideUsd: null,
        multiplier: 1,
        minimumUsd: 0.5,
      }),
    ).toBe(0.5);
  });

  it("leaves an auto-computed price above the minimum untouched", () => {
    expect(
      computeUnitPriceUsd({
        referenceUsd: 10,
        overrideUsd: null,
        multiplier: 0.9,
        minimumUsd: 0.5,
      }),
    ).toBe(9);
  });

  it("never floors a manual override (overrides are deliberate)", () => {
    expect(
      computeUnitPriceUsd({
        referenceUsd: 10,
        overrideUsd: 0.25,
        multiplier: 1,
        minimumUsd: 0.5,
      }),
    ).toBe(0.25);
  });

  it("does not fabricate a price from the minimum when there is no reference", () => {
    expect(
      computeUnitPriceUsd({
        referenceUsd: null,
        overrideUsd: null,
        multiplier: 1,
        minimumUsd: 0.5,
      }),
    ).toBeNull();
  });

  it("treats a zero minimum as no floor", () => {
    expect(
      computeUnitPriceUsd({
        referenceUsd: 0.05,
        overrideUsd: null,
        multiplier: 1,
        minimumUsd: 0,
      }),
    ).toBe(0.05);
  });
});

describe("currency helpers", () => {
  it("rounds UYU to whole pesos", () => {
    expect(usdToUyu(74.99, 40.500979)).toBe(3037);
  });
  it("round2", () => {
    expect(round2(1.006)).toBe(1.01);
    expect(round2(2.674999)).toBe(2.67);
  });
  it("formats es-UY style", () => {
    expect(formatUsd(1234.5)).toMatch(/US\$ 1\.234,50/);
    expect(formatUyu(3037)).toMatch(/\$U 3\.037/);
  });
});
