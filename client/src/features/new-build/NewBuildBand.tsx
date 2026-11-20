import type { ReactNode } from "react"
import NewBuildView from "./NewBuildView"
import { useNewBuild } from "./useNewBuild"

/** The new-build band, where `useNewBuild` says there is a build to offer. */
const NewBuildBand = (): ReactNode => {
  const offer = useNewBuild()
  if (!offer.open) return null
  return <NewBuildView onReload={offer.reload} onLater={offer.later} />
}

export default NewBuildBand
