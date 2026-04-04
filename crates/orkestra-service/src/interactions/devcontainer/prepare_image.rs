//! Pull or build the Docker image for a project's devcontainer.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use crate::types::{DevcontainerConfig, ServiceError};

/// Local tag for the default Orkestra base image built from the embedded Dockerfile.
const DEFAULT_IMAGE_TAG: &str = "orkestra-base:11";

/// Path inside the service container where the base Dockerfile is embedded at build time.
const DEFAULT_DOCKERFILE_PATH: &str = "/etc/orkestra/Dockerfile.base";

/// Ensure the image for this config is available locally and return its name.
///
/// - `Default` → builds `orkestra-base:local` from the embedded Dockerfile (once; skips if already present)
/// - `Image`   → pulls the declared image
/// - `Build`   → builds a local image tagged `orkestra-{project_id}`
/// - `Compose` → no-op; compose manages its own build (returns `""`)
///
/// If `log_path` is provided, docker pull/build output is streamed to that
/// file in real time so users can see image preparation progress.
pub fn execute(
    config: &DevcontainerConfig,
    repo_path: &Path,
    project_id: &str,
    log_path: Option<&Path>,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default => {
            ensure_base_image(log_path)?;
            Ok(DEFAULT_IMAGE_TAG.to_string())
        }
        DevcontainerConfig::Image { image, .. } => {
            docker_pull(image, log_path)?;
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
            docker_build(&dockerfile_path, &context_path, &tag, log_path)?;
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
fn ensure_base_image(log_path: Option<&Path>) -> Result<(), ServiceError> {
    // Fast path: image already exists on the host.
    let inspect = Command::new("docker")
        .args(["image", "inspect", DEFAULT_IMAGE_TAG])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker image inspect`: {e}")))?;

    if inspect.success() {
        if let Some(lp) = log_path {
            append_log(
                lp,
                &format!("Image {DEFAULT_IMAGE_TAG} already present, skipping build."),
            );
        }
        return Ok(());
    }

    if let Some(lp) = log_path {
        append_log(lp, &format!("Building base image {DEFAULT_IMAGE_TAG}..."));
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

    let stderr = child.stderr.take().expect("stderr was piped");
    let log_thread = stream_to_log(stderr, log_path);

    let status = child
        .wait()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `docker build`: {e}")))?;

    let captured = log_thread.join().unwrap_or_default();

    if !status.success() {
        return Err(ServiceError::Other(format!(
            "`docker build` for base image failed: {captured}"
        )));
    }

    Ok(())
}

fn docker_pull(image: &str, log_path: Option<&Path>) -> Result<(), ServiceError> {
    if let Some(lp) = log_path {
        append_log(lp, &format!("Pulling image {image}..."));
    }

    let mut child = Command::new("docker")
        .args(["pull", image])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker pull`: {e}")))?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let log_thread = stream_to_log(stderr, log_path);

    let status = child
        .wait()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `docker pull`: {e}")))?;

    let captured = log_thread.join().unwrap_or_default();

    if status.success() {
        Ok(())
    } else {
        Err(ServiceError::Other(format!(
            "`docker pull {image}` failed: {captured}"
        )))
    }
}

fn docker_build(
    dockerfile: &Path,
    context: &Path,
    tag: &str,
    log_path: Option<&Path>,
) -> Result<(), ServiceError> {
    if let Some(lp) = log_path {
        append_log(lp, &format!("Building image {tag}..."));
    }

    let mut child = Command::new("docker")
        .arg("build")
        .arg("--progress=plain")
        .arg("-f")
        .arg(dockerfile)
        .arg("-t")
        .arg(tag)
        .arg(context)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker build`: {e}")))?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let log_thread = stream_to_log(stderr, log_path);

    let status = child
        .wait()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `docker build`: {e}")))?;

    let captured = log_thread.join().unwrap_or_default();

    if status.success() {
        Ok(())
    } else {
        Err(ServiceError::Other(format!(
            "`docker build -t {tag}` failed: {captured}"
        )))
    }
}

/// Spawn a thread that reads `reader` line by line, writing each line to
/// `log_path` (if provided) and accumulating lines for error reporting.
///
/// Returns a join handle whose value is the full accumulated output.
fn stream_to_log(
    reader: impl std::io::Read + Send + 'static,
    log_path: Option<&Path>,
) -> std::thread::JoinHandle<String> {
    let log_path = log_path.map(Path::to_path_buf);
    std::thread::spawn(move || {
        let mut accumulated = String::new();
        let mut log_file = log_path.as_deref().and_then(|p| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .ok()
        });
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{line}");
            }
            accumulated.push_str(&line);
            accumulated.push('\n');
        }
        accumulated
    })
}

fn append_log(log_path: &Path, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "{line}");
    }
}
