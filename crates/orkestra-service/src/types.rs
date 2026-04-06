//! Domain types for the service layer.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A GitHub repository returned by `gh repo list`.
#[derive(Debug, Deserialize, Serialize)]
pub struct GithubRepo {
    pub name: String,
    #[serde(rename = "nameWithOwner")]
    pub name_with_owner: String,
    pub url: String,
    pub description: Option<String>,
}

/// Status of a managed project's daemon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Stopped,
    Starting,
    Cloning,
    Running,
    Error,
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Starting => "starting",
            Self::Cloning => "cloning",
            Self::Running => "running",
            Self::Error => "error",
        }
    }
}

impl std::str::FromStr for ProjectStatus {
    type Err = ServiceError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "stopped" => Ok(Self::Stopped),
            "starting" => Ok(Self::Starting),
            "cloning" => Ok(Self::Cloning),
            "running" => Ok(Self::Running),
            "error" => Ok(Self::Error),
            other => Err(ServiceError::Other(format!(
                "Unknown project status: {other}"
            ))),
        }
    }
}

/// Devcontainer configuration detected from `.devcontainer/devcontainer.json`,
/// or the Orkestra default when no config is present.
#[derive(Debug, Clone)]
pub enum DevcontainerConfig {
    /// No devcontainer config found — use the default Orkestra base image.
    Default,
    /// A pre-built image declared via `"image"` in devcontainer.json.
    Image {
        image: String,
        post_create_command: Option<String>,
    },
    /// A custom Dockerfile declared via `"build.dockerfile"`.
    Build {
        dockerfile: String,
        context: String,
        post_create_command: Option<String>,
    },
    /// Docker Compose declared via `"dockerComposeFile"` + `"service"`.
    Compose {
        compose_file: String,
        service: String,
        post_create_command: Option<String>,
    },
}

/// A project managed by the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub daemon_port: u16,
    #[serde(skip_serializing)]
    pub shared_secret: String,
    pub status: ProjectStatus,
    pub error_message: Option<String>,
    pub pid: Option<u32>,
    pub created_at: String,
    pub container_id: Option<String>,
}

/// Parameters for starting a Docker container for a project.
///
/// Groups the arguments to `devcontainer_start_container` into a single value.
pub struct ContainerStartParams {
    pub project_id: String,
    pub config: DevcontainerConfig,
    pub image: String,
    pub repo_path: std::path::PathBuf,
    pub port: u16,
    pub override_dir: std::path::PathBuf,
    pub force_build: bool,
}

/// Configuration for the service.
pub struct ServiceConfig {
    pub data_dir: PathBuf,
    pub port: u16,
    /// Port range for assigning daemon ports (inclusive).
    pub port_range: (u16, u16),
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            data_dir: PathBuf::from("."),
            port: 3849,
            port_range: (3850, 3899),
        }
    }
}

/// A secret key entry (without the decrypted value).
#[derive(Debug, Serialize)]
pub struct SecretEntry {
    pub key: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A secret with its decrypted value.
#[derive(Debug, Serialize)]
pub struct SecretValue {
    pub key: String,
    pub value: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Service-level errors.
#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    #[error("Duplicate project path: {0}")]
    DuplicatePath(String),
    #[error("No available ports in range {0}-{1}")]
    NoAvailablePorts(u16, u16),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Secret not found: {0}")]
    SecretNotFound(String),
    #[error("Invalid secret key name: {0}")]
    SecretKeyInvalid(String),
    #[error("Secret management is not configured")]
    SecretsKeyNotConfigured,
    #[error("{0}")]
    Other(String),
}
