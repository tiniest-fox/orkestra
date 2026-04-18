//! Integration tests for the orkestra-service devcontainer flow.
//!
//! Tests that don't require a live Docker daemon run normally.
//! Tests that spawn real containers are `#[ignore]` — opt in with:
//! `cargo test -p orkestra-service --test e2e -- --ignored`

use std::sync::Arc;

use tempfile::TempDir;

use orkestra_service::ServiceDatabase;

// ============================================================================
// Helpers
// ============================================================================

/// Open an in-file database in `dir`, running all migrations.
fn open_db(dir: &TempDir) -> Arc<std::sync::Mutex<rusqlite::Connection>> {
    ServiceDatabase::open(dir.path()).unwrap().shared()
}

// ============================================================================
// devcontainer detect
// ============================================================================

mod detect {
    use std::fs;

    use tempfile::TempDir;

    use orkestra_service::{devcontainer_detect, DevcontainerConfig};

    fn write_config(dir: &TempDir, json: &str) {
        let dc_dir = dir.path().join(".devcontainer");
        fs::create_dir_all(&dc_dir).unwrap();
        fs::write(dc_dir.join("devcontainer.json"), json).unwrap();
    }

    #[test]
    fn no_config_returns_default() {
        let dir = TempDir::new().unwrap();
        assert!(matches!(
            devcontainer_detect(dir.path()),
            DevcontainerConfig::Default
        ));
    }

    #[test]
    fn malformed_json_returns_default() {
        let dir = TempDir::new().unwrap();
        write_config(&dir, "{bad json");
        assert!(matches!(
            devcontainer_detect(dir.path()),
            DevcontainerConfig::Default
        ));
    }

    #[test]
    fn image_key_returns_image_config() {
        let dir = TempDir::new().unwrap();
        write_config(&dir, r#"{"image": "rust:1.80"}"#);
        let DevcontainerConfig::Image {
            image,
            post_create_command,
        } = devcontainer_detect(dir.path())
        else {
            panic!("expected Image");
        };
        assert_eq!(image, "rust:1.80");
        assert!(post_create_command.is_none());
    }

    #[test]
    fn post_create_command_string() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "node:20", "postCreateCommand": "npm ci"}"#,
        );
        let DevcontainerConfig::Image {
            post_create_command,
            ..
        } = devcontainer_detect(dir.path())
        else {
            panic!("expected Image");
        };
        assert_eq!(post_create_command.as_deref(), Some("npm ci"));
    }

    #[test]
    fn post_create_command_array_is_shell_quoted() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "node:20", "postCreateCommand": ["npm", "ci", "--frozen-lockfile"]}"#,
        );
        let DevcontainerConfig::Image {
            post_create_command,
            ..
        } = devcontainer_detect(dir.path())
        else {
            panic!("expected Image");
        };
        assert_eq!(
            post_create_command.as_deref(),
            Some("'npm' 'ci' '--frozen-lockfile'")
        );
    }

    #[test]
    fn compose_key_returns_compose_config() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"dockerComposeFile": "docker-compose.yml", "service": "app"}"#,
        );
        let DevcontainerConfig::Compose {
            compose_file,
            service,
            ..
        } = devcontainer_detect(dir.path())
        else {
            panic!("expected Compose");
        };
        assert_eq!(compose_file, ".devcontainer/docker-compose.yml");
        assert_eq!(service, "app");
    }

    #[test]
    fn build_key_returns_build_config() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"build": {"dockerfile": "Dockerfile.dev", "context": "./docker"}}"#,
        );
        let DevcontainerConfig::Build {
            dockerfile,
            context,
            ..
        } = devcontainer_detect(dir.path())
        else {
            panic!("expected Build");
        };
        assert_eq!(dockerfile, ".devcontainer/Dockerfile.dev");
        assert_eq!(context, ".devcontainer/./docker");
    }

    #[test]
    fn build_context_defaults_to_dot() {
        let dir = TempDir::new().unwrap();
        write_config(&dir, r#"{"build": {"dockerfile": "Dockerfile"}}"#);
        let DevcontainerConfig::Build { context, .. } = devcontainer_detect(dir.path()) else {
            panic!("expected Build");
        };
        assert_eq!(context, ".devcontainer");
    }

    #[test]
    fn compose_takes_priority_over_image_field() {
        let dir = TempDir::new().unwrap();
        write_config(
            &dir,
            r#"{"image": "ubuntu", "dockerComposeFile": "compose.yml", "service": "web"}"#,
        );
        assert!(matches!(
            devcontainer_detect(dir.path()),
            DevcontainerConfig::Compose { .. }
        ));
    }
}

// ============================================================================
// database — container_id column and round-trips
// ============================================================================

mod database {
    use super::open_db;
    use tempfile::TempDir;

    use orkestra_service::{
        add_project, devcontainer_detect, get_project, set_container_id, update_project_status,
        DevcontainerConfig, ProjectStatus, ServiceDatabase,
    };

    #[test]
    fn new_project_has_null_container_id() {
        let dir = TempDir::new().unwrap();
        let conn = open_db(&dir);
        let p = add_project(&conn, "app", "/repos/app", 3850, "s").unwrap();
        assert!(p.container_id.is_none());
    }

    #[test]
    fn set_container_id_stores_and_retrieves() {
        let dir = TempDir::new().unwrap();
        let conn = open_db(&dir);
        let p = add_project(&conn, "app", "/repos/app", 3850, "s").unwrap();

        set_container_id(&conn, &p.id, Some("sha256:abc123")).unwrap();
        let updated = get_project(&conn, &p.id).unwrap();
        assert_eq!(updated.container_id.as_deref(), Some("sha256:abc123"));
    }

    #[test]
    fn clear_container_id_sets_to_none() {
        let dir = TempDir::new().unwrap();
        let conn = open_db(&dir);
        let p = add_project(&conn, "app", "/repos/app", 3850, "s").unwrap();

        set_container_id(&conn, &p.id, Some("abc")).unwrap();
        set_container_id(&conn, &p.id, None).unwrap();
        let cleared = get_project(&conn, &p.id).unwrap();
        assert!(cleared.container_id.is_none());
    }

    #[test]
    fn status_update_does_not_clear_container_id() {
        let dir = TempDir::new().unwrap();
        let conn = open_db(&dir);
        let p = add_project(&conn, "app", "/repos/app", 3850, "s").unwrap();

        set_container_id(&conn, &p.id, Some("ctr-xyz")).unwrap();
        update_project_status(&conn, &p.id, ProjectStatus::Running, None, None).unwrap();

        let r = get_project(&conn, &p.id).unwrap();
        assert_eq!(r.container_id.as_deref(), Some("ctr-xyz"));
        assert_eq!(r.status, ProjectStatus::Running);
    }

    /// Detect config for a project that has a devcontainer.json and verify
    /// the round-trip of storing the resulting `container_id` in the DB.
    #[test]
    fn detect_and_store_container_id_round_trip() {
        use std::fs;
        use tempfile::TempDir;

        let repo = TempDir::new().unwrap();
        let dc_dir = repo.path().join(".devcontainer");
        fs::create_dir_all(&dc_dir).unwrap();
        fs::write(
            dc_dir.join("devcontainer.json"),
            r#"{"image": "ubuntu:24.04", "postCreateCommand": "apt-get update"}"#,
        )
        .unwrap();

        let db_tmp = TempDir::new().unwrap();
        let conn = open_db(&db_tmp);
        let p = add_project(&conn, "myapp", repo.path().to_str().unwrap(), 3850, "s").unwrap();

        let config = devcontainer_detect(repo.path());
        let DevcontainerConfig::Image {
            image,
            post_create_command,
        } = &config
        else {
            panic!("expected Image config");
        };
        assert_eq!(image, "ubuntu:24.04");
        assert_eq!(post_create_command.as_deref(), Some("apt-get update"));

        // Simulate what provision does: store the container ID after docker run.
        set_container_id(&conn, &p.id, Some("container-abc")).unwrap();
        let saved = get_project(&conn, &p.id).unwrap();
        assert_eq!(saved.container_id.as_deref(), Some("container-abc"));
    }

    #[test]
    fn migrations_apply_on_existing_v1_database() {
        // Simulate a database that was created with V1 schema (no container_id column)
        // and verify that opening it again with V2 migrations succeeds.
        use rusqlite::Connection;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("service.db");

        // Create V1 schema manually.
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE service_projects (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     path TEXT NOT NULL UNIQUE,
                     daemon_port INTEGER NOT NULL,
                     shared_secret TEXT NOT NULL,
                     status TEXT NOT NULL DEFAULT 'stopped',
                     error_message TEXT,
                     pid INTEGER,
                     created_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }

        // Opening through ServiceDatabase should apply V2 (add container_id).
        let db = ServiceDatabase::open(dir.path()).unwrap();
        let conn = db.shared();

        // Insert a project and verify container_id is accessible.
        let p = add_project(&conn, "migrated", "/migrated", 3850, "s").unwrap();
        assert!(p.container_id.is_none());

        set_container_id(&conn, &p.id, Some("cid-after-migration")).unwrap();
        let r = get_project(&conn, &p.id).unwrap();
        assert_eq!(r.container_id.as_deref(), Some("cid-after-migration"));
    }
}

// ============================================================================
// Docker round-trip (requires live Docker — ignored by default)
// ============================================================================

mod docker {

    use tempfile::TempDir;

    use orkestra_service::{
        devcontainer_find_container, devcontainer_prepare_image, devcontainer_start_container,
        devcontainer_stop_container, ContainerStartParams, DevcontainerConfig,
    };

    /// Verify `find_container` returns `None` for a project name that doesn't exist.
    /// Requires only a working `docker` binary — no network access needed.
    #[test]
    #[ignore = "requires a running Docker daemon"]
    fn find_container_none_for_nonexistent_project() {
        let result = devcontainer_find_container("orkestra-e2e-nonexistent-xyz-999");
        assert!(result.is_none());
    }

    /// Full lifecycle: pull default image → start container → find it → stop it.
    /// Requires Docker and network access to pull `ghcr.io/orkestra/base:latest`.
    #[test]
    #[ignore = "requires Docker daemon and network access to pull images"]
    fn default_image_full_lifecycle() {
        let repo = TempDir::new().unwrap();
        let override_dir = TempDir::new().unwrap();
        let project_id = "e2e-lifecycle-test";

        let config = DevcontainerConfig::Default;

        let image = devcontainer_prepare_image(&config, repo.path(), project_id)
            .expect("docker pull should succeed");
        assert!(!image.is_empty());

        // Use /bin/sh as a stand-in for orkd (we just need a container to stay alive).

        let container_id = devcontainer_start_container(&ContainerStartParams {
            project_id: project_id.to_string(),
            config: config.clone(),
            image,
            repo_path: repo.path().to_path_buf(),
            port: 19999, // use a high port to avoid conflicts
            override_dir: override_dir.path().to_path_buf(),
            force_build: false,
            cpu_limit: None,
            memory_limit_mb: None,
        })
        .expect("docker run should succeed");

        assert!(!container_id.is_empty());

        // Container should be discoverable by project_id.
        let found = devcontainer_find_container(project_id);
        assert!(
            found.is_some(),
            "container should be found by project_id filter"
        );

        // Cleanup.
        devcontainer_stop_container(&config, &container_id, None, override_dir.path())
            .expect("docker stop/rm should succeed");

        let gone = devcontainer_find_container(project_id);
        assert!(gone.is_none(), "container should be gone after stop");
    }

    /// Image-based devcontainer: pull a declared image, start, stop.
    #[test]
    #[ignore = "requires Docker daemon and network access to pull images"]
    fn image_based_devcontainer_lifecycle() {
        use std::fs;

        let repo = TempDir::new().unwrap();
        let override_dir = TempDir::new().unwrap();
        let project_id = "e2e-image-test";

        let dc_dir = repo.path().join(".devcontainer");
        fs::create_dir_all(&dc_dir).unwrap();
        fs::write(
            dc_dir.join("devcontainer.json"),
            r#"{"image": "ubuntu:24.04"}"#,
        )
        .unwrap();

        let config = orkestra_service::devcontainer_detect(repo.path());
        assert!(matches!(config, DevcontainerConfig::Image { .. }));

        let image = devcontainer_prepare_image(&config, repo.path(), project_id)
            .expect("docker pull should succeed");

        let container_id = devcontainer_start_container(&ContainerStartParams {
            project_id: project_id.to_string(),
            config: config.clone(),
            image,
            repo_path: repo.path().to_path_buf(),
            port: 19998,
            override_dir: override_dir.path().to_path_buf(),
            force_build: false,
            cpu_limit: None,
            memory_limit_mb: None,
        })
        .expect("docker run should succeed");

        devcontainer_stop_container(&config, &container_id, None, override_dir.path())
            .expect("cleanup should succeed");
    }
}
