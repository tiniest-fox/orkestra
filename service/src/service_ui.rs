//! Serves the service manager UI at /.

use axum::extract::Path;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../dist-service/"]
struct ServiceUiAssets;

async fn serve_file(Path(path): Path<String>) -> Response {
    crate::embedded_spa::serve_embedded_file::<ServiceUiAssets>(&path, "service.html")
}

async fn serve_file_by_uri(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    crate::embedded_spa::serve_embedded_file::<ServiceUiAssets>(path, "service.html")
}

pub fn router() -> Router {
    Router::new()
        .route("/", get(|| async { serve_file(Path(String::new())).await }))
        .fallback(get(serve_file_by_uri))
}
