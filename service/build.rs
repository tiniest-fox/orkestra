fn main() {
    // Build service UI only when dist-service/ doesn't already exist.
    // In worktrees and CI, dist-service/ is tracked as a placeholder (empty directory),
    // so this step is skipped. It runs on a fresh checkout without the placeholder.
    if !std::path::Path::new("../dist-service").exists() {
        use std::process::Command;
        let status = Command::new("pnpm")
            .args(["build", "--mode", "service"])
            .status()
            .expect("Failed to run pnpm build --mode service. Is pnpm installed?");
        assert!(status.success(), "pnpm build --mode service failed");
    }

    // Rerun if frontend sources or the dist-service directory change.
    println!("cargo:rerun-if-changed=../dist-service");
    println!("cargo:rerun-if-changed=../src/");
    println!("cargo:rerun-if-changed=../package.json");
}
