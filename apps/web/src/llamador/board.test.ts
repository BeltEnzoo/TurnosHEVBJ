import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asScreenCall, pushRecent, speechLines } from "./board.ts";

describe("tv board", () => {
  it("keeps only the code and the office", () => {
    const call = asScreenCall({
      callId: "c1",
      publicCode: "M9-4K2",
      officeLabel: "Consultorio 1",
      spokenText: "Turno M9-4K2. Dirigirse al Consultorio 1.",
      patient: { givenName: "Juan", familyName: "Perez", dni: "30000001" },
    });
    assert.deepEqual(call, {
      callId: "c1",
      publicCode: "M9-4K2",
      officeLabel: "Consultorio 1",
      spokenText: "Turno M9-4K2. Dirigirse al Consultorio 1.",
    });
    assert.equal(JSON.stringify(call).includes("Perez"), false);
    assert.equal(JSON.stringify(call).includes("30000001"), false);
  });

  it("does not repeat a call and pauses speech when voice is off", () => {
    assert.deepEqual(speechLines("Turno M9-4K2", true, 2), ["Turno M9-4K2", "Turno M9-4K2"]);
    assert.deepEqual(speechLines("Turno M9-4K2", false, 2), []);
    assert.equal(speechLines("Turno M9-4K2", true, 9).length, 3);
    const first = asScreenCall({ callId: "a", publicCode: "AA-111", officeLabel: "C1", spokenText: "uno" });
    const second = asScreenCall({ callId: "b", publicCode: "BB-222", officeLabel: "C2", spokenText: "dos" });
    assert.ok(first && second);
    assert.deepEqual(pushRecent([first], second).map((item) => item.callId), ["b", "a"]);
  });
});
