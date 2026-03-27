//! Initialize project, database, git service, and task for a play run.

use std::sync::{Arc, Mutex};

use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    ensure_orkestra_project, find_project_root,
    workflow::{
        adapters::GhPrService, domain::TaskCreationMode, load_workflow_for_project, Git2GitService,
        GitService, OrchestratorLoop, SqliteWorkflowStore, WorkflowApi, WorkflowStore,
    },
};

pub fn execute(
    description: &str,
    title: Option<String>,
    base_branch: Option<String>,
    flow: Option<String>,
    no_integrate: bool,
) -> Result<super::PlayContext, String> {
    let project_root =
        find_project_root().map_err(|e| format!("Failed to find project root: {e}"))?;

    let orkestra_dir = project_root.join(".orkestra");
    let db_path = orkestra_dir.join(".database/orkestra.db");

    ensure_orkestra_project(&orkestra_dir)
        .map_err(|e| format!("Failed to create .orkestra structure: {e}"))?;

    let workflow_config = load_workflow_for_project(&project_root)
        .map_err(|e| format!("Failed to load workflow config: {e}"))?;

    let conn = DatabaseConnection::open(&db_path)
        .map_err(|e| format!("Failed to open workflow database: {e}"))?;

    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

    let git_service: Option<Arc<dyn GitService>> = match Git2GitService::new(&project_root) {
        Ok(git) => Some(Arc::new(git)),
        Err(e) => {
            if !no_integrate {
                return Err(format!(
                    "Git service unavailable but integration is enabled. Use --no-integrate to skip. Error: {e:?}"
                ));
            }
            eprintln!("Warning: Git service unavailable: {e:?}");
            None
        }
    };

    let base_api = if let Some(git) = git_service {
        WorkflowApi::with_git(workflow_config.clone(), Arc::clone(&store), git)
            .with_pr_service(Arc::new(GhPrService::new()))
    } else {
        WorkflowApi::new(workflow_config.clone(), Arc::clone(&store))
    };

    let api = Arc::new(Mutex::new(base_api));

    let mut orchestrator =
        OrchestratorLoop::for_project(Arc::clone(&api), workflow_config, project_root, store);
    orchestrator.set_sync_background(true);

    let title_str = title.unwrap_or_else(|| description.chars().take(60).collect());
    let task = api
        .lock()
        .map_err(|_| "Workflow API lock poisoned".to_string())?
        .create_task_with_options(
            &title_str,
            description,
            base_branch.as_deref(),
            TaskCreationMode::AutoMode,
            flow.as_deref(),
        )
        .map_err(|e| format!("Failed to create task: {e}"))?;
    let task_id = task.id.clone();
    eprintln!("Created task: {task_id}");

    Ok(super::PlayContext {
        api,
        orchestrator,
        task_id,
    })
}
