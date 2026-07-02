//! CRUD interactions for the `service_projects` table.

pub mod add;
pub(crate) mod add_subfolder;
pub mod get;
pub mod list;
pub(crate) mod list_directories;
pub mod provision;
pub mod remove;
pub mod tail_log;
pub mod update_container_id;
pub mod update_status;
