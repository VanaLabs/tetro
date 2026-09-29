//! Transport and URL rules for user-selected AI endpoints and external links.
use url::{Host, Url};

pub fn endpoint(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Enter a valid server URL".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Server URLs cannot contain credentials, query parameters or fragments. Put the API key in its separate field.".into());
    }
    let loopback = match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => return Err("A server hostname is required".into()),
    };
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Remote AI servers require HTTPS. HTTP is allowed only for localhost (127.0.0.1 or ::1).".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn client() -> Result<reqwest::Client, String> {
    // A redirect could downgrade HTTPS or send provider-specific headers to another server.
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| "Could not initialize secure HTTP transport".into())
}

pub fn external_link(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid link".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") || !url.username().is_empty() || url.password().is_some() {
        return Err("Only web and email links can be opened".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_endpoints_require_tls_and_no_embedded_secrets() {
        for value in ["http://example.com/v1", "http://192.168.1.10:8080", "http://localhost.evil.test", "https://user:secret@example.com", "https://example.com?key=secret", "file:///tmp/server", "https://example.com/#secret"] {
            assert!(endpoint(value).is_err(), "accepted {value}");
        }
        for value in ["https://example.com/v1", "http://localhost:11434", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1"] { assert!(endpoint(value).is_ok()); }
    }
    #[test]
    fn external_links_cannot_open_files_or_shell_options() {
        for value in ["file:///Applications/Terminal.app", "javascript:alert(1)", "-a Terminal", "x-apple.systempreferences:com.apple.preference.security"] { assert!(external_link(value).is_err()); }
        assert!(external_link("https://vanalabs.am").is_ok());
        assert!(external_link("mailto:hello@example.com").is_ok());
    }
    #[tokio::test]
    async fn authenticated_http_client_does_not_follow_redirects() {
        use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::TcpListener};
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap(); let addr=listener.local_addr().unwrap();
        let server=tokio::spawn(async move { let (mut stream,_)=listener.accept().await.unwrap(); let mut request=[0;2048]; stream.read(&mut request).await.unwrap(); stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/stolen\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap(); });
        let response=client().unwrap().get(format!("http://{addr}")).header("x-api-key","dummy").send().await.unwrap();
        assert_eq!(response.status(),reqwest::StatusCode::FOUND); server.await.unwrap();
    }
}
