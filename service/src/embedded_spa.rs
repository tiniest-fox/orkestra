//! Shared SPA-serving logic for embedded static assets.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

/// Serve a file from an embedded asset bundle with SPA fallback.
/// Returns the requested file if found, or falls back to `root_file`
/// for client-side routing. Pass `"service.html"` for the service UI bundle.
pub fn serve_embedded_file<T: Embed>(path: &str, root_file: &str) -> Response {
    let path = if path.is_empty() { root_file } else { path };

    match T::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref().to_owned())],
                file.data.to_vec(),
            )
                .into_response()
        }
        None => match T::get(root_file) {
            Some(file) => {
                ([(header::CONTENT_TYPE, "text/html")], file.data.to_vec()).into_response()
            }
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}
