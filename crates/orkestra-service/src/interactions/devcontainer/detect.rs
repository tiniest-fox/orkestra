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

    let json: serde_json::Value = match serde_json::from_str(&strip_json_comments(&file_content)) {
        Ok(v) => v,
        Err(_) => return DevcontainerConfig::Default,
    };

    let post_create_command = json
        .get("postCreateCommand")
        .and_then(parse_post_create_command);

    let mounts = parse_mounts(&json);

    // Compose: dockerComposeFile + service.
    //
    // devcontainer.json paths are relative to the .devcontainer/ directory
    // (VS Code spec). Prefix so they resolve correctly when joined with the
    // repo root in start_container.rs.
    if let (Some(compose_file), Some(service)) = (
        json.get("dockerComposeFile").and_then(|v| v.as_str()),
        json.get("service").and_then(|v| v.as_str()),
    ) {
        let compose_file = format!(".devcontainer/{compose_file}");
        return DevcontainerConfig::Compose {
            compose_file,
            service: service.to_string(),
            post_create_command,
            mounts,
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
                mounts,
            };
        }
    }

    // Image: image field.
    if let Some(image) = json.get("image").and_then(|v| v.as_str()) {
        return DevcontainerConfig::Image {
            image: image.to_string(),
            post_create_command,
            mounts,
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

fn parse_mounts(json: &serde_json::Value) -> Vec<String> {
    json.get("mounts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Strip JSONC-style comments (`//` and `/* */`) from JSON text.
///
/// String-aware: `//` inside a JSON string value is preserved verbatim.
/// Backslash escape sequences inside strings are handled correctly.
fn strip_json_comments(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut in_block_comment = false;

    while let Some(c) = chars.next() {
        if in_string {
            result.push(c);
            if c == '\\' {
                // Escape sequence — push the next char verbatim so `\"` doesn't
                // accidentally close the string.
                if let Some(escaped) = chars.next() {
                    result.push(escaped);
                }
            } else if c == '"' {
                in_string = false;
            }
        } else if in_block_comment {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next(); // consume '/'
                in_block_comment = false;
            }
            // Block comment content is discarded.
        } else {
            match c {
                '/' if chars.peek() == Some(&'/') => {
                    // Line comment — discard until (but not including) newline.
                    for nc in chars.by_ref() {
                        if nc == '\n' {
                            result.push('\n');
                            break;
                        }
                    }
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next(); // consume '*'
                    in_block_comment = true;
                }
                '"' => {
                    result.push(c);
                    in_string = true;
                }
                _ => result.push(c),
            }
        }
    }

    result
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
    fn compose_path_prefixed_with_devcontainer() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"dockerComposeFile": "docker-compose.yml", "service": "app"}"#,
        );
        let config = execute(dir.path());
        assert!(
            matches!(config, DevcontainerConfig::Compose { compose_file, .. } if compose_file == ".devcontainer/docker-compose.yml")
        );
    }

    #[test]
    fn jsonc_line_comments_parsed() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{
                // This is a JSONC comment
                "dockerComposeFile": "docker-compose.yml",
                "service": "app" // inline comment
            }"#,
        );
        let config = execute(dir.path());
        assert!(
            matches!(config, DevcontainerConfig::Compose { compose_file, service, .. }
                if compose_file == ".devcontainer/docker-compose.yml" && service == "app")
        );
    }

    #[test]
    fn jsonc_block_comments_parsed() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{
                /* block comment */
                "dockerComposeFile": /* inline block */ "docker-compose.yml",
                "service": "app"
            }"#,
        );
        let config = execute(dir.path());
        assert!(matches!(config, DevcontainerConfig::Compose { service, .. } if service == "app"));
    }

    #[test]
    fn comments_inside_strings_preserved() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            // URL with "//" inside the string value — must survive stripping.
            r#"{
                // real comment
                "image": "http://registry.example.com/img:v1"
            }"#,
        );
        let config = execute(dir.path());
        assert!(
            matches!(config, DevcontainerConfig::Image { image, .. } if image == "http://registry.example.com/img:v1")
        );
    }

    // -- mounts parsing tests --

    #[test]
    fn parses_mounts_for_image() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "node:20", "mounts": ["myvolume:/mnt/cache", "/host:/container:ro"]}"#,
        );
        let config = execute(dir.path());
        let DevcontainerConfig::Image { mounts, .. } = config else {
            panic!("expected Image variant")
        };
        assert_eq!(mounts, vec!["myvolume:/mnt/cache", "/host:/container:ro"]);
    }

    #[test]
    fn mounts_defaults_to_empty_when_absent() {
        let dir = TempDir::new().unwrap();
        write_config(&dir, r#"{"image": "node:20"}"#);
        let config = execute(dir.path());
        let DevcontainerConfig::Image { mounts, .. } = config else {
            panic!("expected Image variant")
        };
        assert!(mounts.is_empty());
    }

    #[test]
    fn parses_mounts_for_compose() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"dockerComposeFile": "docker-compose.yml", "service": "app", "mounts": ["cache-vol:/root/.cache"]}"#,
        );
        let config = execute(dir.path());
        let DevcontainerConfig::Compose { mounts, .. } = config else {
            panic!("expected Compose variant")
        };
        assert_eq!(mounts, vec!["cache-vol:/root/.cache"]);
    }

    // -- strip_json_comments unit tests --

    use super::strip_json_comments;

    #[test]
    fn strip_line_comment() {
        assert_eq!(
            strip_json_comments(r#"{"a": 1} // comment"#),
            r#"{"a": 1} "#
        );
    }

    #[test]
    fn strip_block_comment() {
        assert_eq!(strip_json_comments(r#"{"a": /* x */ 1}"#), r#"{"a":  1}"#);
    }

    #[test]
    fn preserves_url_in_string() {
        let input = r#"{"url": "http://x.com"}"#;
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn handles_escaped_quotes() {
        // The escaped quote inside the string must not confuse the state machine.
        let input = r#"{"s": "say \"hi\""} // c"#;
        let output = strip_json_comments(input);
        assert_eq!(output, r#"{"s": "say \"hi\""} "#);
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
