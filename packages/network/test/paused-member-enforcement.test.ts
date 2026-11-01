import { describe, expect, it } from "bun:test";
import { Mini } from "./mini.ts";

const person = (id: string, name: string, state: "normal" | "paused" = "normal") => ({
  id,
  name,
  age: 30,
  area: "Greenpoint",
  state,
  interests: ["climbing", "hiking"],
  skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("paused member enforcement across eligibility, recipient policy, plans, and review", () => {
  it("eligible(id) returns false for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    expect(w.net.eligible("a")).toBe(true);
    expect(w.net.eligible("b")).toBe(false);
  });

  it("planSeatOk(m) returns false for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    const mb = (w.net as any).members.get("b")!;
    expect((w.net as any).planSeatOk(mb)).toBe(false);

    const ma = (w.net as any).members.get("a")!;
    expect((w.net as any).planSeatOk(ma)).toBe(true);
  });

  it("recipientPolicy rejects proactive messages to paused member and about them to others", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    // Proactive outreach to paused member must be rejected
    const checkToPaused = w.net.recipientPolicy("b", "probe", { proactive: true });
    expect(checkToPaused.ok).toBe(false);
    expect(!checkToPaused.ok && checkToPaused.reason).toBe("state_paused");

    // Message about paused member to active counterpart must be rejected
    const checkAboutPaused = w.net.recipientPolicy("a", "probe", { about: ["b"] });
    expect(checkAboutPaused.ok).toBe(false);
    expect(!checkAboutPaused.ok && checkAboutPaused.reason).toBe("other_not_matchable");
  });

  it("approvalCheck rejects opportunity containing a participant who is paused", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "normal")], { review: "human" });
    await w.onboard("a", "b");

    const opp = (w.net as any).newOpp({
      id: "test-opp-1",
      origin: "planner",
      kind: "intro",
      category: "hobby",
      objective: "climbing",
      detail: "climbing session",
      participants: ["a", "b"],
      alternates: [],
      primed: [],
      explanations: { a: "intro", b: "intro" },
      score: 0.8,
      generator: "test",
      tags: [],
    });
    (w.net as any).submit(opp);
    expect(opp.stage).toBe("review");

    // Before pause, approval check passes
    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // Now member 'b' pauses their account
    const mb = (w.net as any).members.get("b")!;
    mb.state = "paused";

    // Approval check must now reject with participant_paused
    expect((w.net as any).approvalCheck(opp)).toBe("participant_paused");
  });

  it("relayHost member reports held=true for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    const host = (w.net as any).relayHost();
    const relayMemberB = host.member("b");
    expect(relayMemberB).toBeDefined();
    expect(relayMemberB!.held).toBe(true);

    const relayMemberA = host.member("a");
    expect(relayMemberA).toBeDefined();
    expect(relayMemberA!.held).toBe(false);
  });
});
