import { deriveTerminalShortName, shortenAirportName, uniqueShortName } from "./names";

describe("shortenAirportName", () => {
  it.each([
    ["Frankfurt Airport", "Frankfurt"],
    ["Warsaw Chopin Airport", "Warsaw Chopin"],
    ["Venice Marco Polo International Airport", "Venice Marco Polo Intl"],
    ["Vienna International Airport", "Vienna Intl"],
  ])("shortens %s to %s", (name, expected) => {
    expect(shortenAirportName(name)).toBe(expected);
  });

  it.each([["Venice Marco Polo"], ["Frankfurt Airport Terminal"], ["Aeroporto di Venezia"], ["Dublin International"]])(
    "leaves %s alone",
    (name) => {
      expect(shortenAirportName(name)).toBe(name);
    },
  );

  it.each([["Airport"], ["International Airport"]])("keeps %s whole rather than shortening it to nothing", (name) => {
    expect(shortenAirportName(name)).toBe(name);
  });

  it("matches the suffix however it is cased", () => {
    expect(shortenAirportName("Frankfurt AIRPORT")).toBe("Frankfurt");
  });

  it("has nothing to shorten in an empty name", () => {
    expect(shortenAirportName("")).toBe("");
  });
});

describe("deriveTerminalShortName", () => {
  it.each([
    ["Terminal 1", "T1"],
    ["Terminal 2", "T2"],
    ["Terminal 10", "T10"],
  ])("shortens the numbered %s to %s", (name, expected) => {
    expect(deriveTerminalShortName("", name)).toBe(expected);
  });

  it.each([
    ["Terminal A", "A"],
    ["Terminal E", "E"],
    ["terminal b", "B"],
  ])("shortens the lettered %s to %s", (name, expected) => {
    expect(deriveTerminalShortName("", name)).toBe(expected);
  });

  it("prefers the designator in the name over a ref saying the same thing", () => {
    expect(deriveTerminalShortName("1", "Terminal 1")).toBe("T1");
  });

  it.each([
    ["Terminal 1A", "T1A"],
    ["Terminal North", "TN"],
    ["Terminal 1 Departures", "T1D"],
    ["North Satellite Building", "NSB"],
  ])("falls back to initials for %s", (name, expected) => {
    expect(deriveTerminalShortName("", name)).toBe(expected);
  });

  it("still prefers the ref for a name it does not recognise", () => {
    expect(deriveTerminalShortName("T1", "Passenger Terminal")).toBe("T1");
  });

  it("takes the first ref of several", () => {
    expect(deriveTerminalShortName("T1;T2", "Passenger Terminal")).toBe("T1");
  });

  it("truncates a long ref to eight characters", () => {
    expect(deriveTerminalShortName("ABCDEFGHIJ", "")).toBe("ABCDEFGH");
  });

  it("hands a designator too long for the cap back to the general rules", () => {
    expect(deriveTerminalShortName("", "Terminal 123456789")).toBe("T1234567");
  });

  it("falls back to a placeholder when there is nothing to shorten", () => {
    expect(deriveTerminalShortName("", "")).toBe("T");
  });
});

describe("uniqueShortName", () => {
  it("keeps a short name nobody else took", () => {
    expect(uniqueShortName("T1", new Set())).toBe("T1");
  });

  it("appends a counter to a taken one", () => {
    expect(uniqueShortName("T1", new Set(["T1"]))).toBe("T12");
  });

  it("truncates before appending so the cap holds", () => {
    expect(uniqueShortName("ABCDEFGH", new Set(["ABCDEFGH"]))).toBe("ABCDEFG2");
  });
});
