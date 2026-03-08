//! Serves embedded PWA static files at /app.

use axum::Router;

#[cfg(feature = "embed-pwa")]
mod inner {
    use axum::extract::Path;
    use axum::response::{Redirect, Response};
    use axum::routing::get;
    use axum::Router;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "../dist/"]
    struct PwaAssets;

    async fn serve_file(Path(path): Path<String>) -> Response {
        crate::embedded_spa::serve_embedded_file::<PwaAssets>(&path, "index.html")
    }

    pub fn router() -> Router {
        Router::new()
            .route("/app", get(|| async { Redirect::permanent("/app/") }))
            .route(
                "/app/",
                get(|| async { serve_file(Path(String::new())).await }),
            )
            .route("/app/{*path}", get(serve_file))
    }
}

#[cfg(not(feature = "embed-pwa"))]
mod inner {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::Router;

    pub fn router() -> Router {
        Router::new().route(
            "/app/{*path}",
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    "PWA not embedded. Build with: cargo build -p ork-service --features embed-pwa",
                )
                    .into_response()
            }),
        )
    }
}

pub fn router() -> Router {
    inner::router()
}
