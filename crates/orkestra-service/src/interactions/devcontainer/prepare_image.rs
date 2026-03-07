//! Pull or build the Docker image for a project's devcontainer.

use std::path::Path;
use std::process::Command;

use crate::types::{DevcontainerConfig, ServiceError};

const DEFAULT_IMAGE: &str = "ghcr.io/orkestra/base:latest";

/// Ensure the image for this config is available locally and return its name.
///
/// - `Default` → pulls `ghcr.io/orkestra/base:latest`
/// - `Image`   → pulls the declared image
/// - `Build`   → builds a local image tagged `orkestra-{project_id}`
/// - `Compose` → no-op; compose manages its own build (returns `""`)
pub fn execute(
    config: &DevcontainerConfig,
    repo_path: &Path,
    project_id: &str,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default => {
            docker_pull(DEFAULT_IMAGE)?;
            Ok(DEFAULT_IMAGE.to_string())
        }
        DevcontainerConfig::Image { image, .. } => {
            docker_pull(image)?;
            Ok(image.clone())
        }
        DevcontainerConfig::Build {
            dockerfile,
            context,
            ..
        } => {
            let tag = format!("orkestra-{project_id}");
            let dockerfile_path = repo_path.join(dockerfile);
            let context_path = repo_path.join(context);
            docker_build(&dockerfile_path, &context_path, &tag)?;
            Ok(tag)
        }
        DevcontainerConfig::Compose { .. } => Ok(String::new()),
    }
}

// -- Helpers --

fn docker_pull(image: &str) -> Result<(), ServiceError> {
    let output = Command::new("docker")
        .args(["pull", image])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker pull`: {e}")))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ServiceError::Other(format!(
            "`docker pull {image}` failed: {stderr}"
        )))
    }
}

fn docker_build(dockerfile: &Path, context: &Path, tag: &str) -> Result<(), ServiceError> {
    let output = Command::new("docker")
        .arg("build")
        .arg("-f")
        .arg(dockerfile)
        .arg("-t")
        .arg(tag)
        .arg(context)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker build`: {e}")))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ServiceError::Other(format!(
            "`docker build -t {tag}` failed: {stderr}"
        )))
    }
}
