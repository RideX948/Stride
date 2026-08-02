import { describe, expect, it, vi } from "vitest";
import { realtimeBus, type BusMessage } from "../server/realtime/bus";

describe("realtimeBus", () => {
  it("delivers a topic-addressed event to subscribers", () => {
    const received: BusMessage[] = [];
    const unsub = realtimeBus.subscribe((msg) => received.push(msg));

    realtimeBus.publish(
      { kind: "topic", topic: "drivers:online" },
      { type: "ride:new", rideId: 42, rideType: "economy" },
    );

    expect(received).toHaveLength(1);
    expect(received[0].address).toEqual({ kind: "topic", topic: "drivers:online" });
    expect(received[0].event).toEqual({ type: "ride:new", rideId: 42, rideType: "economy" });
    unsub();
  });

  it("fans one event out to multiple addresses", () => {
    const received: BusMessage[] = [];
    const unsub = realtimeBus.subscribe((msg) => received.push(msg));

    realtimeBus.publish(
      [
        { kind: "user", userId: 1 },
        { kind: "topic", topic: "ride:7" },
      ],
      { type: "ride:update", rideId: 7, status: "accepted" },
    );

    expect(received).toHaveLength(2);
    expect(received[0].address).toEqual({ kind: "user", userId: 1 });
    expect(received[1].address).toEqual({ kind: "topic", topic: "ride:7" });
    unsub();
  });

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn();
    const unsub = realtimeBus.subscribe(handler);
    unsub();

    realtimeBus.publish({ kind: "user", userId: 5 }, { type: "notification:new" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("never throws even if a subscriber throws", () => {
    const bad = realtimeBus.subscribe(() => {
      throw new Error("subscriber exploded");
    });

    expect(() =>
      realtimeBus.publish({ kind: "user", userId: 1 }, { type: "notification:new" }),
    ).not.toThrow();
    bad();
  });
});
