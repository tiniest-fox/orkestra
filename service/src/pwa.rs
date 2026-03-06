//! Serves embedded PWA static files at /app.

use axum::Router;

#[cfg(feature = "embed-pwa")]
mod inner {
    use axum::extract::Path;
    use axum::http::{header, StatusCode};
    use axum::response::{IntoResponse, Redirect, Response};
    use axum::routing::get;
    use axum::Router;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "../dist/"]
    struct PwaAssets;

    async fn serve_file(Path(path): Path<String>) -> Response {
        let path = if path.is_empty() {
            "index.html".to_string()
        } else {
            path
        };

        match PwaAssets::get(&path) {
            Some(file) => {
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                (
                    [(header::CONTENT_TYPE, mime.as_ref().to_owned())],
                    file.data.to_vec(),
                )
                    .into_response()
            }
            None => {
                // SPA fallback: serve index.html for unmatched routes.
                match PwaAssets::get("index.html") {
                    Some(file) => {
                        ([(header::CONTENT_TYPE, "text/html")], file.data.to_vec()).into_response()
                    }
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            }
        }
    }

    pub fn router() -> Router {
        Router::new()
            .route("/app", get(|| async { Redirect::permanent("/app/") }))
            .route(
                "/app/",
                get(|| async { serve_file(Path("index.html".to_string())).await }),
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
