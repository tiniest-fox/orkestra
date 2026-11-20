// Tier 1: the boot decision is a pure function of the arguments and the environment, and
// the one refusal in it is the thing this trak exists to make true — an engine is never
// bound wider than loopback with nothing in front of it.

import type { NetworkInterfaceInfo } from "node:os"
import { describe, expect, it } from "vitest"
import { EVERY_INTERFACE, LOOPBACK, reachable } from "./access.js"
import { bindPlan, PASSPHRASE_ENV } from "./guard.js"

describe("where the engine binds", () => {
  it("is loopback with nothing said, and open — as it always was", () => {
    expect(bindPlan([], {})).toEqual({ host: LOOPBACK, passphrase: undefined })
  })

  it("is loopback with a passphrase and no --host: a tunnel wants exactly this", () => {
    expect(bindPlan([], { [PASSPHRASE_ENV]: "correct horse" })).toEqual({
      host: LOOPBACK,
      passphrase: "correct horse",
    })
  })

  it("is every interface with --host and a passphrase", () => {
    expect(bindPlan(["--host"], { [PASSPHRASE_ENV]: "correct horse" })).toEqual({
      host: EVERY_INTERFACE,
      passphrase: "correct horse",
    })
  })

  it("refuses --host with no passphrase, and names the variable", () => {
    const plan = bindPlan(["--host"], {})
    expect("refused" in plan).toBe(true)
    expect("refused" in plan && plan.refused).toContain(PASSPHRASE_ENV)
  })

  it("reads an empty passphrase as none, so a slip in a shell cannot open the door", () => {
    expect(bindPlan([], { [PASSPHRASE_ENV]: "" })).toEqual({
      host: LOOPBACK,
      passphrase: undefined,
    })
    expect("refused" in bindPlan(["--host"], { [PASSPHRASE_ENV]: "" })).toBe(true)
  })
})

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
})

const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: "ffff:ffff:ffff:ffff::",
  family: "IPv6",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
})

describe("the addresses a phone could open", () => {
  it("keeps the IPv4 addresses of every interface that is not loopback", () => {
    expect(
      reachable({
        lo0: [v4("127.0.0.1", true)],
        en0: [v4("192.168.1.12"), v6("fe80::1")],
        en5: [v4("10.0.0.4")],
        utun0: undefined,
      }),
    ).toEqual(["192.168.1.12", "10.0.0.4"])
  })

  it("is empty with no network, which is the honest answer rather than 0.0.0.0", () => {
    expect(reachable({ lo0: [v4("127.0.0.1", true)] })).toEqual([])
  })
})
