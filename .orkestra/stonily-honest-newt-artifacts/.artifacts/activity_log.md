[plan]
- Incorporated user feedback: no stage names in the promotion-guidance template at all, just instructions plus a dynamically-injected explicit list of options
- Updated success criteria to explicitly require no hardcoded stage names in the template
- Kept the open technical question about frontend utility placement for the breakdown agent

[task]
- `extractErrorMessage` already exists at `src/utils/errors.ts` with full test coverage — no new utility needed
- 12 `String(err)` call sites across 6 files need updating (AssistantDrawer, FeedView, SkipStageModal, SendToStageModal, SubtasksSection, FileViewerDrawer)
- Prompt template hardcodes `"stage": "planning"` in the example JSON block — the model copies it verbatim
- Single-subtask (inline) approach: both fixes are mechanical, independent, and under 30 minutes of work

