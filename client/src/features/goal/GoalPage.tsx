/**
 * The goal route's page: the goal, the list's rows for the traks it opened, and its
 * acting hooks, handed to `GoalScreen`. The four states a polled screen has are branched
 * on `data === undefined` first, as every page here does.
 *
 * **Keyed on the id**, so a press pending on one goal, its refusal sentence and a draft in
 * its chat bar never carry over to the next one the route opens.
 */

import { getRouteApi } from "@tanstack/react-router"
import { Unplug } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../../components/Button"
import Drawer from "../../components/Drawer"
import EmptyState from "../../components/EmptyState"
import { useAgents } from "../../hooks/useAgents"
import { useClearNotifications } from "../../hooks/useClearNotifications"
import { usePhone } from "../../hooks/usePhone"
import { useTraks } from "../traks-list/useTraks"
import GoalScreen from "./GoalScreen"
import { useGoal } from "./useGoal"
import { useDropGoal } from "./useDropGoal"
import { useGoalAct } from "./useGoalAct"
import { useGoalSettings } from "./useGoalSettings"
import { usePauseGoal } from "./usePauseGoal"
import { useStopGoal } from "./useStopGoal"
import { ownersView } from "./ownership"

const route = getRouteApi("/shell/goals/$id")

const Goal = ({ id }: { readonly id: string }): ReactNode => {
  const { data, isError, error, refetch } = useGoal(id)
  useClearNotifications(`goal:${id}`)
  const traks = useTraks()
  const agents = useAgents()
  const phone = usePhone()
  const act = useGoalAct(id, data?.goal.running ?? true)
  const pause = usePauseGoal(id)
  const drop = useDropGoal(id)
  const settings = useGoalSettings(id)
  const stopping = useStopGoal(id)

  if (data === undefined)
    return (
      <Drawer label="Goal">
        {isError ? (
          <EmptyState
            tone="bad"
            icon={Unplug}
            title="Could not read this goal"
            action={<Button onClick={() => void refetch()}>Try again</Button>}
          >
            {error.message}
          </EmptyState>
        ) : (
          <EmptyState loading />
        )}
      </Drawer>
    )

  // The list's rows win, being polled with it; the goal's own rows stand in for the
  // traks the list no longer sends because they were put away.
  const summaries = new Map(
    [...data.settled, ...(traks.data?.traks ?? [])].map((t) => [t.id, t] as const),
  )
  return (
    <GoalScreen
      detail={ownersView(data)}
      rows={{ summaries, agents: agents.data ?? [], phone }}
      act={act}
      pause={pause}
      drop={drop}
      settings={settings}
      stopping={stopping}
      now={Date.now()}
    />
  )
}

const GoalPage = (): ReactNode => {
  const { id } = route.useParams()
  return <Goal key={id} id={id} />
}

export default GoalPage
