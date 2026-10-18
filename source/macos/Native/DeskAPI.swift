import Foundation
import WebKit

struct DeskAPIError: LocalizedError {
  let status: Int
  let message: String
  var errorDescription: String? { message }
  var authentication: Bool { [401, 403, 302, 303, 307, 308].contains(status) }
  var permanent: Bool { (400..<500).contains(status) && status != 429 && !authentication }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
@MainActor final class DeskAPI {
  private let store = WKWebsiteDataStore.default().httpCookieStore
  private let redirects = NoRedirects()
  private lazy var session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.httpShouldSetCookies = false
    c.httpCookieStorage = nil
    c.timeoutIntervalForRequest = 15
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: c, delegate: redirects, delegateQueue: nil)
  }()
  func request(_ path: String, body: [String: JSONValue]? = nil, base: URL? = nil) async throws
    -> JSONValue
  {
    let payload = try body.map { try JSONValue.object($0).data() }
    let (data, response) = try await bytes(
      path, body: payload, method: body == nil ? "GET" : "POST", contentType: "application/json",
      base: base)
    do { return try JSONValue.parse(data) } catch {
      throw DeskAPIError(
        status: response.mimeType == "text/html" ? 401 : 502,
        message: response.mimeType == "text/html"
          ? "Sign in to reconnect your workspace."
          : "The server returned an unreadable response. Your changes are saved on this Mac.")
    }
  }
  func bytes(
    _ path: String, body: Data? = nil, method: String = "GET", contentType: String? = nil,
    base: URL? = nil
  )
    async throws -> (Data, HTTPURLResponse)
  {
    let target = base ?? dashboardURL
    guard target.host != "unconfigured.invalid" else { throw ConnectionError.noWorkspace }
    guard path.hasPrefix("/api/"),
      let url = URL(string: path, relativeTo: target)?.absoluteURL,
      url.host == target.host
    else { throw DeskAPIError(status: 400, message: "Invalid workspace address.") }
    let cookies = await withCheckedContinuation { continuation in
      store.getAllCookies { continuation.resume(returning: $0) }
    }
    let matching = cookies.filter { cookie in
      let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
      return (url.host == domain || url.host!.hasSuffix("." + domain))
        && (cookie.expiresDate == nil || cookie.expiresDate! > Date())
        && url.path.hasPrefix(cookie.path)
    }
    var request = URLRequest(url: url)
    request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: matching)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("https://" + target.host!, forHTTPHeaderField: "Origin")
    if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw DeskAPIError(status: 502, message: "No response from your workspace.")
    }
    if let headers = http.allHeaderFields as? [String: String] {
      for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url) {
        await withCheckedContinuation { continuation in
          store.setCookie(cookie) { continuation.resume() }
        }
      }
    }
    guard (200..<300).contains(http.statusCode) else {
      let value = try? JSONValue.parse(data)
      throw DeskAPIError(
        status: http.statusCode,
        message: value?["error"].text.isEmpty == false
          ? value!["error"].text
          : [401, 403, 302, 303, 307, 308].contains(http.statusCode)
            ? "Sign in to reconnect your workspace."
            : "The workspace could not save this change (\(http.statusCode)).")
    }
    return (data, http)
  }
  func upload(_ url: URL, type: String, key: String) async throws {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let data = try Data(contentsOf: url)
    guard !data.isEmpty, data.count <= 10 * 1024 * 1024 else {
      throw DeskAPIError(status: 413, message: "Choose a file smaller than 10 MB.")
    }
    let boundary = "DotDesk-" + UUID().uuidString
    var body = Data()
    func append(_ text: String) { body.append(Data(text.utf8)) }
    for (name, value) in [("target_type", type), ("target_key", key)] {
      append(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
    }
    let name = url.lastPathComponent.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(
      of: "\r", with: ""
    ).replacingOccurrences(of: "\n", with: "")
    append(
      "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    body.append(data)
    append("\r\n--\(boundary)--\r\n")
    _ = try await bytes(
      "/api/files", body: body, method: "POST",
      contentType: "multipart/form-data; boundary=\(boundary)")
  }
}
