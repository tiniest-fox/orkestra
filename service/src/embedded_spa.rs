//! Shared SPA-serving logic for embedded static assets.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

/// Serve a file from an embedded asset bundle with SPA fallback.
/// Returns the requested file if found, or falls back to `root_file`
/// for client-side routing. Pass `"service.html"` for the service UI bundle.
///
/// Cache-Control policy:
/// - Root HTML file and SPA fallback: `no-cache` (always revalidate)
/// - `assets/*` (content-hashed): `public, max-age=31536000, immutable`
/// - Other static files: no explicit Cache-Control header
pub fn serve_embedded_file<T: Embed>(path: &str, root_file: &str) -> Response {
    let path = if path.is_empty() { root_file } else { path };

    let cache_control: Option<&str> = if path == root_file {
        Some("no-cache")
    } else if path.starts_with("assets/") {
        Some("public, max-age=31536000, immutable")
    } else {
        None
    };

    match T::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut headers = vec![(header::CONTENT_TYPE, mime.as_ref().to_owned())];
            if let Some(cc) = cache_control {
                headers.push((header::CACHE_CONTROL, cc.to_owned()));
            }
            (headers, file.data.to_vec()).into_response()
        }
        None => match T::get(root_file) {
            Some(file) => (
                vec![
                    (header::CONTENT_TYPE, "text/html".to_owned()),
                    (header::CACHE_CONTROL, "no-cache".to_owned()),
                ],
                file.data.to_vec(),
            )
                .into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}
