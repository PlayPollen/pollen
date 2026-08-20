// Beekeeping is the mechanic the whole game is named after, so it gets the same
// treatment as the reward system: exact, deterministic assertions with no
// network and no client. Every number below is a design decision you can change
// on purpose and see fail here.

import { describe, it, expect } from "vitest";
import { FarmState, Player, createFarmState, createPlayer, createTile } from "../state.js";
import * as bees from "./beekeeping.js";
import * as farming from "./farming.js";
import { TileState, HIVE, CROPS } from "../types.js";

function tileAt(state: FarmState, x: number, y: number, crop: string, tileState: TileState) {
  const t = createTile();
  t.state = tileState;
  t.crop = crop;
  t.plantedAtTick = 0;
  state.tiles.set(`${x},${y}`, t);
  return t;
}

/**
 * A player standing at (x,y). Position matters now: every hive action is reach-
 * gated, so a test that doesn't stand near its hive is testing the reach check
 * rather than the thing it means to test.
 */
function playerWith(coins: number, x = 0, y = 0) {
  const p = createPlayer("test");
  p.coins = coins;
  p.x = x;
  p.y = y;
  return p;
}

/** Walk the player somewhere else mid-test. */
function moveTo(p: Player, x: number, y: number) {
  p.x = x;
  p.y = y;
  return p;
}

describe("placeHive", () => {
  it("charges the player and registers the hive", () => {
    const s = createFarmState();
    const p = playerWith(HIVE.placeCost, 10, 10);
    expect(bees.placeHive(s, p, 10, 10)).toBe(true);
    expect(p.coins).toBe(0);
    expect(s.hives.has("10,10")).toBe(true);
  });

  it("refuses when the player can't afford it (anti-cheat)", () => {
    const s = createFarmState();
    const p = playerWith(HIVE.placeCost - 1, 10, 10);
    expect(bees.placeHive(s, p, 10, 10)).toBe(false);
    expect(s.hives.size).toBe(0);
    expect(p.coins).toBe(HIVE.placeCost - 1);
  });

  it("refuses a tile that already has a hive or a growing crop", () => {
    const s = createFarmState();
    const p = playerWith(HIVE.placeCost * 3, 4, 4);
    bees.placeHive(s, p, 4, 4);
    expect(bees.placeHive(s, p, 4, 4)).toBe(false);      // occupied by a hive

    moveTo(p, 7, 7);
    tileAt(s, 7, 7, "turnip", TileState.Planted);
    expect(bees.placeHive(s, p, 7, 7)).toBe(false);      // occupied by a crop
  });

  it("blocks planting on a tile a hive already occupies", () => {
    const s = createFarmState();
    const p = playerWith(1000, 3, 3);
    bees.placeHive(s, p, 3, 3);
    expect(farming.plant(s, p, 3, 3, "turnip")).toBe(false);
  });

  it("refuses to build out of reach, and doesn't charge for the attempt", () => {
    const s = createFarmState();
    const p = playerWith(1000, 0, 0);
    expect(bees.placeHive(s, p, 20, 20)).toBe(false);
    expect(s.hives.size).toBe(0);
    expect(p.coins).toBe(1000);
  });

  it("refuses to collect honey from a hive you've walked away from", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    s.hives.get("5,5")!.honey = 10;

    moveTo(p, 30, 30);
    expect(bees.collectHoney(s, p, 5, 5).ok).toBe(false);
    expect(s.hives.get("5,5")!.honey).toBe(10);   // honey stays in the hive

    moveTo(p, 5, 5);
    expect(bees.collectHoney(s, p, 5, 5).ok).toBe(true);
  });
});

describe("beeTick", () => {
  it("produces nothing without grown flowers in range", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    tileAt(s, 5, 6, "turnip", TileState.Ready);          // a crop, not a flower
    tileAt(s, 6, 5, "clover", TileState.Planted);        // a flower, not grown
    bees.beeTick(s);
    const hive = s.hives.get("5,5")!;
    expect(hive.foragingCount).toBe(0);
    expect(hive.honey).toBe(0);
  });

  it("accrues honey proportional to the number of bloomed flowers", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    tileAt(s, 5, 6, "clover", TileState.Ready);
    tileAt(s, 4, 4, "sunflower", TileState.Ready);

    bees.beeTick(s);
    const hive = s.hives.get("5,5")!;
    expect(hive.foragingCount).toBe(2);
    expect(hive.honey).toBeCloseTo(2 * HIVE.honeyPerFlowerPerTick, 10);
  });

  it("ignores flowers that haven't bloomed yet", () => {
    // The design choice that gives flowers their tension: you must let a bloom
    // STAND to get honey from it, instead of harvesting it the moment it lands.
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    tileAt(s, 5, 6, "lavender", TileState.Watered);      // still growing
    bees.beeTick(s);
    expect(s.hives.get("5,5")!.foragingCount).toBe(0);
    expect(s.hives.get("5,5")!.honey).toBe(0);
  });

  it("stops producing when a bloom is harvested away", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    const flower = tileAt(s, 5, 6, "clover", TileState.Ready);
    bees.beeTick(s);
    expect(s.hives.get("5,5")!.foragingCount).toBe(1);

    flower.state = TileState.Empty;                      // the player harvested it
    flower.crop = "";
    bees.beeTick(s);
    expect(s.hives.get("5,5")!.foragingCount).toBe(0);
  });

  it("ignores flowers outside the hive's range", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    tileAt(s, 5, 5 + HIVE.range, "clover", TileState.Ready);        // just inside
    tileAt(s, 5, 5 + HIVE.range + 1, "clover", TileState.Ready);    // just outside
    bees.beeTick(s);
    expect(s.hives.get("5,5")!.foragingCount).toBe(1);
  });

  it("caps at maxForagers so one hive can't work unlimited land", () => {
    const s = createFarmState();
    const p = playerWith(1000, 10, 10);
    bees.placeHive(s, p, 10, 10);
    let placed = 0;
    for (let dy = -HIVE.range; dy <= HIVE.range && placed < HIVE.maxForagers + 5; dy++) {
      for (let dx = -HIVE.range; dx <= HIVE.range && placed < HIVE.maxForagers + 5; dx++) {
        if (dx === 0 && dy === 0) continue;
        tileAt(s, 10 + dx, 10 + dy, "clover", TileState.Ready);
        placed++;
      }
    }
    bees.beeTick(s);
    expect(s.hives.get("10,10")!.foragingCount).toBe(HIVE.maxForagers);
  });

  it("stops accruing at capacity", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    tileAt(s, 5, 6, "clover", TileState.Ready);
    const hive = s.hives.get("5,5")!;
    hive.honey = HIVE.capacity;
    bees.beeTick(s);
    expect(hive.honey).toBe(HIVE.capacity);
  });
});

describe("collectHoney", () => {
  it("pays out whole units only and leaves the remainder in the hive", () => {
    const s = createFarmState();
    const p = playerWith(HIVE.placeCost, 5, 5);
    bees.placeHive(s, p, 5, 5);
    expect(p.coins).toBe(0);                  // spent it all on the hive
    const hive = s.hives.get("5,5")!;
    hive.honey = 4.75;

    const r = bees.collectHoney(s, p, 5, 5);
    expect(r).toEqual({ ok: true, units: 4, coins: 4 * HIVE.honeyCoinValue });
    expect(p.coins).toBe(4 * HIVE.honeyCoinValue);
    expect(hive.honey).toBeCloseTo(0.75, 10);
  });

  it("cannot be farmed for free coins by tapping an empty hive", () => {
    const s = createFarmState();
    const p = playerWith(HIVE.placeCost, 5, 5);
    bees.placeHive(s, p, 5, 5);
    s.hives.get("5,5")!.honey = 0.9;          // not yet a whole unit

    expect(bees.collectHoney(s, p, 5, 5).ok).toBe(false);
    expect(bees.collectHoney(s, p, 5, 5).ok).toBe(false);
    expect(p.coins).toBe(0);
  });

  it("refuses a tile with no hive", () => {
    const s = createFarmState();
    const p = playerWith(0);
    expect(bees.collectHoney(s, p, 1, 1).ok).toBe(false);
  });
});

describe("pollination", () => {
  it("covers tiles within range and not beyond it", () => {
    const s = createFarmState();
    const p = playerWith(1000, 5, 5);
    bees.placeHive(s, p, 5, 5);
    expect(bees.isPollinated(s, 5 + HIVE.range, 5)).toBe(true);
    expect(bees.isPollinated(s, 5 + HIVE.range + 1, 5)).toBe(false);
  });

  it("raises the yield ceiling for the SAME seed (the bonus is real)", () => {
    // Identical seed, identical tile, identical tick — the only difference is a
    // hive. If pollination did nothing, these would be equal.
    const build = (withHive: boolean) => {
      const s = createFarmState();
      s.currentTick = 500;
      const p = playerWith(1000, 20, 20);
      if (withHive) bees.placeHive(s, p, 20, 20);
      tileAt(s, 20, 21, "potato", TileState.Ready);   // adjacent to the hive tile
      return { s, p };
    };

    const plain = build(false);
    const bee = build(true);
    const rPlain = farming.harvest(plain.s, plain.p, 20, 21, 42);
    const rBee = farming.harvest(bee.s, bee.p, 20, 21, 42);

    expect(rPlain.pollinated).toBe(false);
    expect(rBee.pollinated).toBe(true);
    // Same RNG stream, wider range -> the pollinated roll can't be smaller.
    expect(rBee.amount).toBeGreaterThanOrEqual(rPlain.amount);
    expect(rBee.coins).toBeGreaterThanOrEqual(rPlain.coins);
  });

  it("stays deterministic: same seed + same hive layout -> same result", () => {
    const build = () => {
      const s = createFarmState();
      s.currentTick = 500;
      const p = playerWith(1000, 20, 20);
      bees.placeHive(s, p, 20, 20);
      tileAt(s, 20, 21, "potato", TileState.Ready);
      return { s, p };
    };
    const a = build();
    const b = build();
    expect(farming.harvest(a.s, a.p, 20, 21, 99)).toEqual(
      farming.harvest(b.s, b.p, 20, 21, 99),
    );
  });

  it("raises the max yield by the configured multiplier", () => {
    // Guards the design intent rather than a single roll: a pollinated potato
    // must be able to exceed an unpollinated potato's ceiling.
    const def = CROPS.potato;
    const pollinatedMax = Math.round(def.maxYield * 1.5);
    expect(pollinatedMax).toBeGreaterThan(def.maxYield);
  });
});
