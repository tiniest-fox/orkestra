//! Build the toolbox image (if needed) and populate the shared toolbox volume.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::types::ServiceError;

/// Toolbox version — the single source of truth.
///
/// Bump this string to trigger a full image rebuild and volume repopulation.
/// The image tag (`orkestra-toolbox:v{N}`) and Dockerfile version marker are
/// both derived from this value — never edit them separately.
const TOOLBOX_VERSION: &str = "9";

const TOOLBOX_DOCKERFILE_PATH: &str = "/etc/orkestra/Dockerfile.toolbox";
pub const TOOLBOX_VOLUME_NAME: &str = "orkestra-toolbox";
pub const TOOLBOX_MOUNT_PATH: &str = "/opt/orkestra";

/// Ensure the toolbox volume is present and up to date.
///
/// 1. Checks the version marker inside the volume; returns immediately if current.
/// 2. Builds `orkestra-toolbox:v{TOOLBOX_VERSION}` from the embedded Dockerfile (skips if already present).
/// 3. Creates the volume (if missing) and copies toolbox contents into it.
pub fn execute() -> Result<(), ServiceError> {
    if volume_version_matches()? {
        return Ok(());
    }

    ensure_toolbox_image()?;
    populate_volume()?;

    Ok(())
}

// -- Helpers --

/// Returns the image tag for the current toolbox version, e.g. `orkestra-toolbox:v1`.
///
/// The tag includes the version so that a version bump forces a fresh image build;
/// `docker image inspect` on the old tag will fail and trigger a rebuild.
fn toolbox_image_tag() -> String {
    format!("orkestra-toolbox:v{TOOLBOX_VERSION}")
}

/// Return true if the volume already contains the expected version marker.
///
/// Returns `Ok(false)` when the version is absent or mismatched (volume missing,
/// marker unreadable, etc.) so the caller rebuilds. Returns `Err` only if docker
/// itself cannot be spawned.
fn volume_version_matches() -> Result<bool, ServiceError> {
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
    Ok(version.trim() == TOOLBOX_VERSION)
}

/// Build the toolbox image from the embedded Dockerfile if not already present.
///
/// Uses the stdin-pipe pattern so no host filesystem path is required — this
/// works correctly in a `DooD` (Docker-outside-of-Docker) setup where the service
/// container and the host daemon have different views of the filesystem.
fn ensure_toolbox_image() -> Result<(), ServiceError> {
    let tag = toolbox_image_tag();

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
    // Pass TOOLBOX_VERSION as a build-arg so the Dockerfile can write the version
    // marker without duplicating the value.
    let mut child = Command::new("docker")
        .args([
            "build",
            "-t",
            &tag,
            "--build-arg",
            &format!("TOOLBOX_VERSION={TOOLBOX_VERSION}"),
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
fn populate_volume() -> Result<(), ServiceError> {
    let tag = toolbox_image_tag();

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
