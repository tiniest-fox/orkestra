fn main() {
    // Build service UI.
    {
        use std::process::Command;
        let status = Command::new("pnpm")
            .args(["build", "--mode", "service"])
            .status()
            .expect("Failed to run pnpm build --mode service. Is pnpm installed?");
        assert!(status.success(), "pnpm build --mode service failed");
    }

    // Rerun if frontend sources change.
    println!("cargo:rerun-if-changed=../src/");
    println!("cargo:rerun-if-changed=../package.json");
}
