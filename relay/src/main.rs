//! `relay` — stateless WebSocket relay server for NAT/firewall traversal.
//!
//! Routes messages between registered daemons and clients by device ID.
//! Authentication is via a shared API key passed on the WebSocket upgrade URL.

use std::net::IpAddr;

use clap::Parser;

use orkestra_relay::server;
use orkestra_relay::types::RelayConfig;

// ============================================================================
// CLI
// ============================================================================

/// Orkestra relay — stateless WebSocket message router.
#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// IP address to bind to.
    #[arg(long, default_value = "0.0.0.0")]
    bind: IpAddr,

    /// Port to listen on.
    #[arg(long, default_value_t = 3848)]
    port: u16,

    /// Required API key for WebSocket connections.
    #[arg(long, env = "RELAY_API_KEY")]
    api_key: String,

    /// Maximum new WebSocket connections per IP per minute.
    #[arg(long, env = "RELAY_RATE_LIMIT", default_value_t = 30)]
    rate_limit: u32,
}

// ============================================================================
// Entry Point
// ============================================================================

fn main() {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = RelayConfig {
        bind: args.bind,
        port: args.port,
        api_key: args.api_key,
        rate_limit: args.rate_limit,
        forward_timeout_secs: 30,
    };

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime");

    if let Err(e) = rt.block_on(run(config)) {
        tracing::error!("Relay error: {e}");
        std::process::exit(1);
    }
}

// ============================================================================
// Run
// ============================================================================

async fn run(config: RelayConfig) -> Result<(), std::io::Error> {
    let handle = server::start(config).await?;

    // Wait for SIGTERM or SIGINT.
    tokio::signal::ctrl_c().await?;

    tracing::info!("Shutdown signal received — stopping relay");
    handle.shutdown();

    Ok(())
}
