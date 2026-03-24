fn main() {
    // Tauri validates resource paths at build time. The bundled `ork` binary
    // lives at `../target/release/ork` when built for distribution, but
    // developers running plain `cargo check` haven't built it yet.
    // Create an empty placeholder so the config check passes; `lib.rs` guards
    // against using it by checking that the file is non-empty (`is_real_ork_binary`)
    // before treating it as a real binary.
    let ork_path = std::path::Path::new("../target/release/ork");
    if !ork_path.exists() {
        if let Some(parent) = ork_path.parent() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|e| panic!("build.rs: failed to create target/release/: {e}"));
        }
        std::fs::write(ork_path, b"")
            .unwrap_or_else(|e| panic!("build.rs: failed to write ork placeholder: {e}"));
    }

    tauri_build::build();
}
