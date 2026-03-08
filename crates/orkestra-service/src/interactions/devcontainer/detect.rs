//! Detect the devcontainer configuration from a project's repository root.

use std::path::Path;

use crate::types::DevcontainerConfig;

/// Read `.devcontainer/devcontainer.json` and return the parsed config.
///
/// Falls back to `DevcontainerConfig::Default` (the Orkestra base image) when
/// the file is absent or cannot be parsed.
pub fn execute(repo_path: &Path) -> DevcontainerConfig {
    let config_path = repo_path.join(".devcontainer").join("devcontainer.json");

    let Ok(file_content) = std::fs::read_to_string(&config_path) else {
        return DevcontainerConfig::Default;
    };

    let json: serde_json::Value = match serde_json::from_str(&file_content) {
        Ok(v) => v,
        Err(_) => return DevcontainerConfig::Default,
    };

    let post_create_command = json
        .get("postCreateCommand")
        .and_then(parse_post_create_command);

    // Compose: dockerComposeFile + service.
    if let (Some(compose_file), Some(service)) = (
        json.get("dockerComposeFile").and_then(|v| v.as_str()),
        json.get("service").and_then(|v| v.as_str()),
    ) {
        return DevcontainerConfig::Compose {
            compose_file: compose_file.to_string(),
            service: service.to_string(),
            post_create_command,
        };
    }

    // Build: build.dockerfile.
    //
    // devcontainer.json paths are relative to the .devcontainer/ directory
    // (VS Code spec). Prefix them so they resolve correctly when joined with
    // the repo root in prepare_image.
    if let Some(build) = json.get("build") {
        if let Some(dockerfile) = build.get("dockerfile").and_then(|v| v.as_str()) {
            let dockerfile = format!(".devcontainer/{dockerfile}");
            let context = build.get("context").and_then(|v| v.as_str()).map_or_else(
                || ".devcontainer".to_string(),
                |c| format!(".devcontainer/{c}"),
            );
            return DevcontainerConfig::Build {
                dockerfile,
                context,
                post_create_command,
            };
        }
    }

    // Image: image field.
    if let Some(image) = json.get("image").and_then(|v| v.as_str()) {
        return DevcontainerConfig::Image {
            image: image.to_string(),
            post_create_command,
        };
    }

    DevcontainerConfig::Default
}

// -- Helpers --

fn parse_post_create_command(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(ToString::to_string))
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(
                    parts
                        .iter()
                        .map(|p| shell_quote(p))
                        .collect::<Vec<_>>()
                        .join(" "),
                )
            }
        }
        _ => None,
    }
}

/// Wrap a shell argument in single quotes, escaping any embedded single quotes.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::execute;
    use crate::types::DevcontainerConfig;

    fn write_config(dir: &TempDir, json: &str) {
        let dc_dir = dir.path().join(".devcontainer");
        fs::create_dir_all(&dc_dir).unwrap();
        fs::write(dc_dir.join("devcontainer.json"), json).unwrap();
    }

    #[test]
    fn returns_default_when_no_file() {
        let dir = TempDir::new().unwrap();
        let config = execute(dir.path());
        assert!(matches!(config, DevcontainerConfig::Default));
    }

    #[test]
    fn parses_image() {
        let dir = TempDir::new().unwrap();
        write_config(&dir, r#"{"image": "node:20"}"#);
        let config = execute(dir.path());
        assert!(matches!(config, DevcontainerConfig::Image { image, .. } if image == "node:20"));
    }

    #[test]
    fn parses_compose() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"dockerComposeFile": "docker-compose.yml", "service": "app"}"#,
        );
        let config = execute(dir.path());
        assert!(matches!(config, DevcontainerConfig::Compose { service, .. } if service == "app"));
    }

    #[test]
    fn parses_build() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"build": {"dockerfile": "Dockerfile", "context": "."}}"#,
        );
        let config = execute(dir.path());
        assert!(
            matches!(config, DevcontainerConfig::Build { dockerfile, .. } if dockerfile == ".devcontainer/Dockerfile")
        );
    }

    #[test]
    fn parses_post_create_command_string() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "ubuntu", "postCreateCommand": "npm install"}"#,
        );
        let config = execute(dir.path());
        let DevcontainerConfig::Image {
            post_create_command,
            ..
        } = config
        else {
            panic!()
        };
        assert_eq!(post_create_command.as_deref(), Some("npm install"));
    }

    #[test]
    fn parses_post_create_command_array() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "ubuntu", "postCreateCommand": ["npm", "install"]}"#,
        );
        let config = execute(dir.path());
        let DevcontainerConfig::Image {
            post_create_command,
            ..
        } = config
        else {
            panic!()
        };
        assert_eq!(post_create_command.as_deref(), Some("'npm' 'install'"));
    }
}
