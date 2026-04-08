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
            let mut builder = Response::builder().header(header::CONTENT_TYPE, mime.as_ref());
            if let Some(cc) = cache_control {
                builder = builder.header(header::CACHE_CONTROL, cc);
            }
            builder
                .body(axum::body::Body::from(file.data.to_vec()))
                .unwrap()
        }
        None => match T::get(root_file) {
            Some(file) => Response::builder()
                .header(header::CONTENT_TYPE, "text/html")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(axum::body::Body::from(file.data.to_vec()))
                .unwrap(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::CACHE_CONTROL;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "test-assets/"]
    struct TestAssets;

    /// Helper: extract Cache-Control header value from a Response, if present.
    fn cache_control(response: &Response) -> Option<String> {
        response
            .headers()
            .get(CACHE_CONTROL)
            .map(|v| v.to_str().unwrap().to_owned())
    }

    #[test]
    fn root_html_returns_no_cache() {
        let resp = serve_embedded_file::<TestAssets>("index.html", "index.html");
        assert_eq!(cache_control(&resp).as_deref(), Some("no-cache"));
    }

    #[test]
    fn hashed_asset_returns_immutable() {
        let resp = serve_embedded_file::<TestAssets>("assets/app.abc123.js", "index.html");
        assert_eq!(
            cache_control(&resp).as_deref(),
            Some("public, max-age=31536000, immutable")
        );
    }

    #[test]
    fn other_static_file_has_no_cache_control() {
        let resp = serve_embedded_file::<TestAssets>("other.css", "index.html");
        assert!(cache_control(&resp).is_none());
    }

    #[test]
    fn spa_fallback_returns_no_cache() {
        let resp = serve_embedded_file::<TestAssets>("nonexistent/route", "index.html");
        assert_eq!(cache_control(&resp).as_deref(), Some("no-cache"));
    }
}
