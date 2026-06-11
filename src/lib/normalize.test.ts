import { describe, expect, it } from "vitest";
import { normalizeName, slugify } from "./normalize";

describe("normalizeName", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeName("Séance")).toBe("seance");
    expect(normalizeName("Lim-Dûl's Vault")).toBe("lim duls vault");
  });
  it("maps ligatures", () => {
    expect(normalizeName("Æther Vial")).toBe("aether vial");
  });
  it("keeps double-faced separators searchable", () => {
    expect(normalizeName("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki")).toBe(
      "fable of the mirror breaker // reflection of kiki jiki",
    );
  });
});

describe("slugify", () => {
  it("builds url-safe slugs", () => {
    expect(slugify("Lumra, Bellow of the Woods")).toBe("lumra-bellow-of-the-woods");
    expect(slugify("Fable // Reflection")).toBe("fable-reflection");
  });
});
