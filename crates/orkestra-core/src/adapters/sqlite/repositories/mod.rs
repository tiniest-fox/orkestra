//! Repository implementations for each entity type.
//!
//! Each repository handles CRUD operations for a specific entity,
//! sharing the database connection via `Arc<Mutex<Connection>>`.

mod iteration;
mod stage_session;
mod task;
mod work_loop;

pub use iteration::IterationRepository;
pub use stage_session::StageSessionRepository;
pub use task::TaskRepository;
pub use work_loop::WorkLoopRepository;
