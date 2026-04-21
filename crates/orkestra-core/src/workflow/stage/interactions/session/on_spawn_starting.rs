//! Create session and iteration before spawn attempt, returning spawn context.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, SessionState, StageSession};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::stage::session::SessionSpawnContext;

/// Create session and iteration before spawn attempt, returning spawn context.
///
/// This is called BEFORE attempting to spawn the agent process.
/// Creates or updates a session in `Spawning` state.
/// Creates a new iteration only if there's no active one for this stage.
///
/// # Arguments
///
/// * `initial_session_id` — Pre-generated session ID for providers that accept caller-supplied
///   IDs (Claude Code). Pass `None` for providers that generate their own (`OpenCode`).
///   Used when creating a NEW session. Also replaces stale IDs on existing sessions when not resuming.
pub(crate) fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    stage: &str,
    initial_session_id: Option<String>,
    trigger: Option<IterationTrigger>,
) -> WorkflowResult<SessionSpawnContext> {
    let now = chrono::Utc::now().to_rfc3339();

    // Get or create session in Spawning state
    let mut session = if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        // Existing session — claude_session_id kept here, but may be replaced below (non-resume case)
        session.session_state = SessionState::Spawning;
        session.updated_at.clone_from(&now);
        session
    } else {
        // New session with UUID-based ID
        let session_id = uuid::Uuid::new_v4().to_string();
        let mut session = StageSession::new(&session_id, task_id, stage, &now);
        session.claude_session_id.clone_from(&initial_session_id);
        session.session_state = SessionState::Spawning;
        session
    };

    let stage_session_id = session.id.clone();

    // Fetch the active iteration BEFORE computing is_resume so we can inspect its trigger.
    // This is read-only — no session state is affected by this fetch.
    let iteration = if let Some(active_iter) = store.get_active_iteration(task_id, stage)? {
        active_iter
    } else {
        orkestra_debug!(
            "session",
            "on_spawn_starting {}/{}: creating iteration via IterationService",
            task_id,
            stage
        );
        iteration_service.create_iteration(task_id, stage, trigger)?
    };

    // Compute is_resume BEFORE saving the session or linking the iteration.
    // is_resume: true if we have a session ID AND either:
    //   - the agent produced output (has_activity), OR
    //   - the user explicitly chose to resume (UserMessage trigger).
    //
    // UserMessage handles agents interrupted before producing structured output:
    // has_activity stays false (only set on successful completion), but we still
    // want to resume the existing session since the user is explicitly continuing work.
    //
    // Crash-recovery note: when an agent crashes before producing any output,
    // has_activity=false and trigger may be a non-superseding type.
    // In that case is_resume=false, so we spawn fresh. This is correct — resuming
    // a dead provider session (no output) would fail; fresh spawn with the full
    // initial prompt is the right recovery path.
    //
    // UserMessage is the exception: it is set when a user explicitly resumes an
    // interrupted task via send_message(). Even if has_activity=false (interrupted
    // before output), we want to continue the existing session.
    let is_human_resume = matches!(
        iteration.incoming_context,
        Some(IterationTrigger::UserMessage { .. })
    );
    let is_resume =
        session.claude_session_id.is_some() && (session.has_activity || is_human_resume);

    // When not resuming, replace stale session ID with fresh one (or clear it for
    // own-ID providers). This prevents "Session ID already in use" errors when
    // retrying after failure. For providers like OpenCode that generate their own
    // IDs, initial_session_id is None, which correctly clears the stale ID.
    if !is_resume && session.claude_session_id.is_some() {
        session.claude_session_id = initial_session_id;
    }

    orkestra_debug!(
        "session",
        "on_spawn_starting {}/{}: claude_session_id={:?}, state={:?}, spawn_count={}, has_activity={}, is_human_resume={}, is_resume={}",
        task_id,
        stage,
        session.claude_session_id,
        session.session_state,
        session.spawn_count,
        session.has_activity,
        is_human_resume,
        is_resume
    );

    store.save_stage_session(&session)?;

    // Link the session to the iteration for log recovery
    let iteration = iteration.with_stage_session_id(&stage_session_id);
    store.save_iteration(&iteration)?;

    Ok(SessionSpawnContext {
        session_id: session.claude_session_id,
        is_resume,
        stage_session_id,
        iteration_id: iteration.id.clone(),
    })
}
