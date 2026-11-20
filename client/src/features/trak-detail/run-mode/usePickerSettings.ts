/**
 * The four settings the run-mode picker presses, read from one place — `useBreakOut`'s
 * shape, for a reason of the same kind: these are the four hooks that take no `running`
 * at all, because each route appends one event and takes no drive, and a caller that
 * held them one at a time could hand custody to one of them by habit. Not another acting
 * hook: it is `useSetMode`, `useSetHold`, `useSkipChecks` and `useSetAutoMerge` read
 * together.
 */

import { type AutoMergeSetting, useSetAutoMerge } from "./useSetAutoMerge"
import { type HoldSetting, useSetHold } from "./useSetHold"
import { type ModeSetting, useSetMode } from "./useSetMode"
import { type SkipChecksSetting, useSkipChecks } from "./useSkipChecks"

export interface PickerSettings {
  readonly setting: ModeSetting
  readonly hold: HoldSetting
  readonly skip: SkipChecksSetting
  readonly autoMerge: AutoMergeSetting
}

export const usePickerSettings = (id: string): PickerSettings => ({
  setting: useSetMode(id),
  hold: useSetHold(id),
  skip: useSkipChecks(id),
  autoMerge: useSetAutoMerge(id),
})
