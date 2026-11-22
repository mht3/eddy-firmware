import SwiftUI
import WebKit

/// Serve only the bundled demo. A custom origin lets WebKit load its ES modules offline.
private final class DemoResources: NSObject, WKURLSchemeHandler {
    static let scheme = "eddy-demo"
    static let start = URL(string: "eddy-demo://app/index.html?embedded=1")!
    private static let types = [
        "html": "text/html", "css": "text/css", "js": "text/javascript", "webp": "image/webp",
    ]
    private let files: [String: URL]

    override init() {
        let root = Bundle.main.url(forResource: "demo", withExtension: nil)
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey]
        let contents = root.flatMap { try? FileManager.default.contentsOfDirectory(
            at: $0, includingPropertiesForKeys: Array(keys), options: .skipsHiddenFiles
        ) } ?? []
        files = Dictionary(uniqueKeysWithValues: contents.compactMap { file in
            guard Self.types[file.pathExtension] != nil, let info = try? file.resourceValues(forKeys: keys),
                  info.isRegularFile == true, info.isSymbolicLink != true else { return nil }
            return (file.lastPathComponent, file)
        })
        super.init()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == Self.scheme, url.host == "app",
              url.path == "/" + url.lastPathComponent, let mime = Self.types[url.pathExtension],
              let file = files[url.lastPathComponent],
              let bytes = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let headers = [
            "Content-Type": mime,
            "Access-Control-Allow-Origin": "*",
            "Content-Security-Policy": "default-src 'none'; script-src eddy-demo:; style-src eddy-demo:; img-src eddy-demo:; base-uri 'none'; form-action 'none'",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(bytes)
        task.didFinish()
    }

    // Requests finish synchronously from the app bundle.
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

struct SpotifyDemoView: UIViewRepresentable {
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url == DemoResources.start && action.targetFrame?.isMainFrame == true
                            ? .allow : .cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(DemoResources(), forURLScheme: DemoResources.scheme)
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .clear
        web.load(URLRequest(url: DemoResources.start))
        return web
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
