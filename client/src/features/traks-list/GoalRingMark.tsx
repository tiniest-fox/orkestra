/**
 * The mark inside `GoalRing`, which says what the goal is doing. Each path is drawn on the
 * ring's 20-unit box, in `currentColor`. The eye blinks and the composer's ring turns, both
 * only where motion is welcome. Open traks are a still count, a bare numeral — over nine
 * reads `9+` — and with none open, the center dot alone.
 */

import { Eye } from "lucide-react"
import type { ReactNode } from "react"
import type { RingMark } from "./ringMark"

const GoalRingMark = ({ mark }: { readonly mark: RingMark | "door" }): ReactNode => {
  if (typeof mark === "object") {
    return mark.open === 0 ? (
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
    ) : (
      <text
        x="10"
        y="10"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="8"
        fontWeight="700"
        fill="currentColor"
        className="font-mono"
      >
        {mark.open > 9 ? "9+" : String(mark.open)}
      </text>
    )
  }
  switch (mark) {
    case "spin":
    case "door":
      return (
        <>
          <g className={mark === "spin" ? "origin-center motion-safe:animate-ring" : undefined}>
            <circle
              cx="10"
              cy="10"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={mark === "spin" ? "20 8.3" : undefined}
            />
          </g>
          <circle cx="10" cy="10" r="1.8" fill="currentColor" />
        </>
      )
    case "eye":
      return (
        <g className="motion-safe:animate-breathe">
          <Eye x={6} y={6} width={8} height={8} strokeWidth={2.6} />
        </g>
      )
    case "fail":
      return (
        <path
          d="M8.4 8.4 L11.6 11.6 M11.6 8.4 L8.4 11.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )
    case "pause":
      return (
        <path
          d="M8.9 8.5 V11.5 M11.1 8.5 V11.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )
    case "done":
      return (
        <path
          d="M7.6 10.2 L9.3 11.9 L12.5 8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    case "dropped":
      return (
        <path
          d="M8.6 8.6 L11.4 11.4 M11.4 8.6 L8.6 11.4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      )
  }
}

export default GoalRingMark
