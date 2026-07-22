//! Build the toolbox image (if needed) and populate the shared toolbox volume.

use sha2::{Digest, Sha256};
use std::io::Write;
use std::process::{Command, Stdio};

use crate::types::ServiceError;

const TOOLBOX_DOCKERFILE_PATH: &str = "/etc/orkestra/Dockerfile.toolbox";
pub const TOOLBOX_VOLUME_NAME: &str = "orkestra-toolbox";
pub const TOOLBOX_MOUNT_PATH: &str = "/opt/orkestra";

/// Ensure the toolbox volume is present and up to date.
///
/// 1. Reads the embedded Dockerfile and computes its SHA-256 hash.
/// 2. Checks the version marker inside the volume; returns immediately if it matches.
/// 3. Builds `orkestra-toolbox:{hash}` from the embedded Dockerfile (skips if already present).
/// 4. Creates the volume (if missing) and copies toolbox contents into it.
///
/// The hash-based version means any change to `Dockerfile.toolbox` automatically
/// triggers a rebuild — no manual version bump required.
pub fn execute() -> Result<(), ServiceError> {
    let hash = dockerfile_hash()?;

    if volume_version_matches(&hash)? {
        return Ok(());
    }

    ensure_toolbox_image(&hash)?;
    populate_volume(&hash)?;

    Ok(())
}

// -- Helpers --

/// Compute a short SHA-256 hex digest of the embedded Dockerfile.
///
/// The first 16 hex characters (8 bytes) are returned — sufficient collision
/// resistance for local Docker image tags and volume version markers.
fn dockerfile_hash() -> Result<String, ServiceError> {
    let content = std::fs::read(TOOLBOX_DOCKERFILE_PATH).map_err(|e| {
        ServiceError::Other(format!(
            "Failed to read toolbox Dockerfile at {TOOLBOX_DOCKERFILE_PATH}: {e}"
        ))
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let result = hasher.finalize();
    Ok(format!("{result:x}")[..16].to_string())
}

/// Returns the Docker image tag for the given content hash.
fn toolbox_image_tag(hash: &str) -> String {
    format!("orkestra-toolbox:{hash}")
}

/// Return true if the volume already contains a version marker matching `hash`.
///
/// Returns `Ok(false)` when the marker is absent or mismatched (volume missing,
/// marker unreadable, etc.) so the caller rebuilds. Returns `Err` only if docker
/// itself cannot be spawned.
fn volume_version_matches(hash: &str) -> Result<bool, ServiceError> {
    let output = Command::new("docker")
        .args([
            "run",
            "--rm",
            "-v",
            &format!("{TOOLBOX_VOLUME_NAME}:/vol:ro"),
            "alpine",
            "cat",
            "/vol/.version",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| {
            ServiceError::Other(format!("Failed to run `docker run` for version check: {e}"))
        })?;

    if !output.status.success() {
        return Ok(false);
    }

    let version = String::from_utf8_lossy(&output.stdout);
    Ok(version.trim() == hash)
}

/// Build the toolbox image from the embedded Dockerfile if not already present.
///
/// Uses the stdin-pipe pattern so no host filesystem path is required — this
/// works correctly in a `DooD` (Docker-outside-of-Docker) setup where the service
/// container and the host daemon have different views of the filesystem.
fn ensure_toolbox_image(hash: &str) -> Result<(), ServiceError> {
    let tag = toolbox_image_tag(hash);

    // Fast path: image already present on the host.
    let inspect = Command::new("docker")
        .args(["image", "inspect", &tag])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker image inspect`: {e}")))?;

    if inspect.success() {
        return Ok(());
    }

    // Read the embedded Dockerfile.
    let dockerfile = std::fs::read(TOOLBOX_DOCKERFILE_PATH).map_err(|e| {
        ServiceError::Other(format!(
            "Failed to read toolbox Dockerfile at {TOOLBOX_DOCKERFILE_PATH}: {e}"
        ))
    })?;

    // Build by piping Dockerfile content via stdin — no build context needed
    // since the Dockerfile embeds setup.sh inline (no COPY instructions).
    // Pass the content hash as TOOLBOX_VERSION so the Dockerfile writes it as
    // the version marker, making volume_version_matches() self-consistent.
    let mut child = Command::new("docker")
        .args([
            "build",
            "-t",
            &tag,
            "--build-arg",
            &format!("TOOLBOX_VERSION={hash}"),
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker build`: {e}")))?;

    // Stdio::piped() guarantees stdin is Some — expect to fail fast on the impossible case.
    let mut stdin = child
        .stdin
        .take()
        .expect("stdin is piped; take() must return Some");
    stdin.write_all(&dockerfile).map_err(|e| {
        ServiceError::Other(format!(
            "Failed to pipe toolbox Dockerfile to `docker build`: {e}"
        ))
    })?;
    // Explicitly drop stdin to close the pipe and signal EOF to docker build.
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `docker build`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`docker build` for toolbox image failed: {stderr}"
        )));
    }

    Ok(())
}

/// Create the toolbox volume (if absent) and copy image contents into it.
fn populate_volume(hash: &str) -> Result<(), ServiceError> {
    let tag = toolbox_image_tag(hash);

    // Ensure the named volume exists (idempotent).
    let create = Command::new("docker")
        .args(["volume", "create", TOOLBOX_VOLUME_NAME])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker volume create`: {e}")))?;

    if !create.status.success() {
        let stderr = String::from_utf8_lossy(&create.stderr);
        return Err(ServiceError::Other(format!(
            "`docker volume create {TOOLBOX_VOLUME_NAME}` failed: {stderr}"
        )));
    }

    // Copy the toolbox contents from the image into the volume.
    let copy = Command::new("docker")
        .args([
            "run",
            "--rm",
            "-v",
            &format!("{TOOLBOX_VOLUME_NAME}:/target"),
            &tag,
            "sh",
            "-c",
            "cp -a /opt/orkestra/. /target/",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            ServiceError::Other(format!(
                "Failed to run `docker run` to populate volume: {e}"
            ))
        })?;

    if !copy.status.success() {
        let stderr = String::from_utf8_lossy(&copy.stderr);
        return Err(ServiceError::Other(format!(
            "`docker run` to populate toolbox volume failed: {stderr}"
        )));
    }

    Ok(())
}
