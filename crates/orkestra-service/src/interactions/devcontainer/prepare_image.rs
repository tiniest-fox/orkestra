//! Pull or build the Docker image for a project's devcontainer.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::types::{DevcontainerConfig, ServiceError};

/// Local tag for the default Orkestra base image built from the embedded Dockerfile.
const DEFAULT_IMAGE_TAG: &str = "orkestra-base:7";

/// Path inside the service container where the base Dockerfile is embedded at build time.
const DEFAULT_DOCKERFILE_PATH: &str = "/etc/orkestra/Dockerfile.base";

/// Ensure the image for this config is available locally and return its name.
///
/// - `Default` → builds `orkestra-base:local` from the embedded Dockerfile (once; skips if already present)
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
            ensure_base_image()?;
            Ok(DEFAULT_IMAGE_TAG.to_string())
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

/// Build `orkestra-base:local` from the embedded Dockerfile if it isn't already present.
///
/// The Dockerfile is piped via stdin (`docker build -`) so no host filesystem
/// path is needed — this works correctly in a `DooD` (Docker-outside-of-Docker)
/// setup where the service container and the host daemon have different views
/// of the filesystem.
fn ensure_base_image() -> Result<(), ServiceError> {
    // Fast path: image already exists on the host.
    let inspect = Command::new("docker")
        .args(["image", "inspect", DEFAULT_IMAGE_TAG])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker image inspect`: {e}")))?;

    if inspect.success() {
        return Ok(());
    }

    // Read the embedded Dockerfile.
    let dockerfile = std::fs::read(DEFAULT_DOCKERFILE_PATH).map_err(|e| {
        ServiceError::Other(format!(
            "Failed to read base Dockerfile at {DEFAULT_DOCKERFILE_PATH}: {e}"
        ))
    })?;

    // Build by piping Dockerfile content via stdin — no build context needed
    // since the Dockerfile only uses RUN/ENV (no COPY).
    let mut child = Command::new("docker")
        .args(["build", "-t", DEFAULT_IMAGE_TAG, "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker build`: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&dockerfile).map_err(|e| {
            ServiceError::Other(format!("Failed to pipe Dockerfile to `docker build`: {e}"))
        })?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `docker build`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`docker build` for base image failed: {stderr}"
        )));
    }

    Ok(())
}

fn docker_pull(image: &str) -> Result<(), ServiceError> {
    let output = Command::new("docker")
        .args(["pull", image])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
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
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
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
