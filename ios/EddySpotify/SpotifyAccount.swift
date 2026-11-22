import AuthenticationServices
import Combine
import CryptoKit
import Foundation
import Security
#if canImport(UIKit)
import UIKit
import SpotifyLogin
#else
import AppKit
#endif

struct SpotifyAccountError: LocalizedError {
    let deviceCode: Int
    let errorDescription: String?
    var retryAfter: TimeInterval?
    fileprivate var expiredGrant = false

    init(_ message: String, code: Int = 1, retryAfter: TimeInterval? = nil, expiredGrant: Bool = false) {
        errorDescription = message
        deviceCode = code
        self.retryAfter = retryAfter
        self.expiredGrant = expiredGrant
    }
}

enum SpotifyOAuth {
    static let redirect = "https://mht3.github.io/eddy-firmware/spotify/"
    static let nativeRedirect = "eddyspotify://spotify-login"
    static let scopes = ["user-library-read", "playlist-read-private", "playlist-read-collaborative",
                         "user-modify-playback-state", "user-read-currently-playing", "user-read-playback-state",
                         "playlist-modify-private", "playlist-modify-public"]

    static func clientID(_ input: String) throws -> String {
        let id = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard id.utf8.count == 32, id.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw SpotifyAccountError("Enter the 32-character Client ID from your Spotify app settings.")
        }
        return id
    }

    static func base64URL(_ bytes: Data) -> String {
        bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func randomString() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw SpotifyAccountError("Could not start a secure Spotify sign-in. Try again.")
        }
        return base64URL(Data(bytes))
    }

    static func authorizeURL(clientID: String, state: String, verifier: String) -> URL {
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var url = URLComponents(string: "https://accounts.spotify.com/authorize")!
        url.queryItems = ["client_id": clientID, "response_type": "code", "scope": scopes.joined(separator: " "),
                          "redirect_uri": redirect, "state": state, "code_challenge_method": "S256",
                          "code_challenge": challenge].map { URLQueryItem(name: $0.key, value: $0.value) }
        return url.url!
    }

    static func callbackCode(_ callback: URL, state: String) throws -> String {
        let invalid = SpotifyAccountError("Spotify returned an unexpected sign-in. Please start again.")
        guard let url = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              url.scheme == "eddyspotify", url.host == "callback", url.path.isEmpty, url.user == nil,
              url.password == nil, url.port == nil, url.fragment == nil else { throw invalid }
        let items = url.queryItems ?? []
        let states = items.filter { $0.name == "state" }
        guard states.count == 1, states[0].value == state else { throw invalid }
        let codes = items.filter { $0.name == "code" }
        let errors = items.filter { $0.name == "error" }
        if let error = errors.first {
            guard errors.count == 1, codes.isEmpty else { throw invalid }
            if error.value == "access_denied" { throw SpotifyAccountError("Spotify permission was declined.") }
            throw SpotifyAccountError("Spotify could not authorize this app. Check its developer settings.")
        }
        guard codes.count == 1, let code = codes[0].value, !code.isEmpty else { throw invalid }
        return code
    }

    static func isNativeCallback(_ callback: URL) -> Bool {
        guard let url = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              url.scheme == "eddyspotify", url.host == "spotify-login", url.path.isEmpty,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil else { return false }
        let result = (url.queryItems ?? []).filter { $0.name == "code" || $0.name == "error" }
        return result.count == 1 && !(result[0].value ?? "").isEmpty
    }

    static func form(_ fields: [String: String]) -> Data {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let body = fields.sorted { $0.key < $1.key }.map { name, value in
            name + "=" + value.addingPercentEncoding(withAllowedCharacters: allowed)!
        }.joined(separator: "&")
        return Data(body.utf8)
    }

    static func namespace(clientID: String, accountID: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(("eddy.spotify.v1\u{0}" + clientID + "\u{0}" + accountID).utf8))))
    }
}

struct SpotifyTokenResponse: Decodable {
    let access_token: String
    let token_type: String
    let expires_in: Int
    let refresh_token: String?
    let scope: String?
}

struct SpotifyCredential: Codable {
    let id: String
    let accountKey: String
    var access: String
    var refresh: String
    var expires: Date

    mutating func update(_ token: SpotifyTokenResponse) throws {
        guard token.token_type.lowercased() == "bearer", !token.access_token.isEmpty,
              token.expires_in > 0 else { throw SpotifyAccountError("Spotify returned an incomplete sign-in. Try again.") }
        if let scope = token.scope, !Set(SpotifyOAuth.scopes).isSubset(of: Set(scope.components(separatedBy: " "))) {
            throw SpotifyAccountError("Approve the requested library and playback permissions to use Eddy.")
        }
        if let rotated = token.refresh_token, !rotated.isEmpty { refresh = rotated }
        guard !refresh.isEmpty else { throw SpotifyAccountError("Spotify did not return a saved sign-in. Try again.") }
        access = token.access_token
        expires = Date().addingTimeInterval(TimeInterval(token.expires_in))
    }
}

@MainActor
private enum SpotifyKeychain {
    static let item: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword, kSecAttrService: "eddy.spotify.oauth", kSecAttrAccount: "current"
    ]

    static func load() throws -> SpotifyCredential? {
        var query = item
        query[kSecReturnData] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let credential = try? JSONDecoder().decode(SpotifyCredential.self, from: data) else {
            throw SpotifyAccountError("Unlock your device to read the saved Spotify sign-in.")
        }
        return credential
    }

    static func save(_ credential: SpotifyCredential) throws {
        let fields: [CFString: Any] = [kSecValueData: try JSONEncoder().encode(credential),
                                       kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(item as CFDictionary, fields as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(item.merging(fields) { _, value in value } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw SpotifyAccountError("Could not save your Spotify sign-in in Keychain.") }
    }

    static func clear() throws {
        let status = SecItemDelete(item as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SpotifyAccountError("Your Spotify sign-in could not be removed. Unlock your device and try again.")
        }
    }
}

#if canImport(UIKit)
@MainActor
private final class SpotifyAppLogin: NSObject, SessionManagerDelegate {
    let manager: SessionManager
    private var result: CheckedContinuation<SpotifyTokenResponse, Error>?
    private var callbackReceived = false

    init(clientID: String) {
        let config = SpotifyLogin.Configuration(clientID: clientID, redirectURL: URL(string: SpotifyOAuth.nativeRedirect)!)
        manager = SessionManager(configuration: config, delegate: nil)
        super.init()
        manager.delegate = self
    }

    func start() async throws -> SpotifyTokenResponse {
        let scopes = SpotifyLogin.Scope.allCases.filter { SpotifyOAuth.scopes.contains($0.name) }
        return try await withCheckedThrowingContinuation { continuation in
            result = continuation
            manager.initiateSession(with: scopes, authorizationFlow: .clientOnlyFailsIfNotInstalled)
        }
    }

    func open(_ url: URL) -> Bool {
        guard result != nil, !callbackReceived, SpotifyOAuth.isNativeCallback(url) else { return false }
        callbackReceived = true
        return manager.openURL(url)
    }

    func cancel() { complete(.failure(CancellationError())) }

    private func complete(_ outcome: Result<SpotifyTokenResponse, Error>) {
        guard let result else { return }
        self.result = nil
        manager.delegate = nil
        result.resume(with: outcome)
    }

    nonisolated func sessionManager(manager: SessionManager, didInitiate session: Session) {
        let token = SpotifyTokenResponse(access_token: session.accessToken, token_type: "Bearer",
                                         expires_in: Int(session.expirationDate.timeIntervalSinceNow),
                                         refresh_token: session.refreshToken, scope: session.scopes.map(\.name).joined(separator: " "))
        Task { @MainActor in self.complete(.success(token)) }
    }

    nonisolated func sessionManager(manager: SessionManager, didFailWith error: Error) {
        Task { @MainActor in self.complete(.failure(error)) }
    }
}
#endif

@MainActor
final class SpotifyAccount: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var isSignedIn = false
    @Published private(set) var isSigningIn = false
    @Published private(set) var waitingForSpotifyApp = false
    @Published private(set) var status = "Sign in to Spotify."
    @Published private(set) var clientID = ""
    @Published private(set) var accountKey: String?

    private let transport = URLSession(configuration: .ephemeral)
    private var credential: SpotifyCredential?
    private var generation = UUID()
    private var refreshing: Task<String, Error>?
    #if canImport(UIKit)
    private var appLogin: SpotifyAppLogin?
    #endif
    private var webSession: ASWebAuthenticationSession?
    private var callbackContinuation: CheckedContinuation<URL, Error>?
    private var presentationWindow: ASPresentationAnchor?
    private var pendingSignIn: UUID?

    override init() {
        super.init()
        do {
            if let saved = try SpotifyKeychain.load() { apply(saved) }
        } catch { status = error.localizedDescription }
    }

    private func apply(_ saved: SpotifyCredential) {
        credential = saved
        clientID = saved.id
        accountKey = saved.accountKey
        isSignedIn = true
        status = "Signed in to Spotify."
    }

    func signOut() {
        do {
            try SpotifyKeychain.clear()
            #if canImport(UIKit)
            appLogin?.cancel()
            appLogin = nil
            #endif
            waitingForSpotifyApp = false
            callbackContinuation?.resume(throwing: CancellationError())
            callbackContinuation = nil
            pendingSignIn = nil
            isSigningIn = false
            webSession?.cancel()
            webSession = nil
            presentationWindow = nil
            generation = UUID()
            refreshing?.cancel()
            refreshing = nil
            credential = nil
            isSignedIn = false
            accountKey = nil
            status = "Signed out of Spotify."
        } catch { status = error.localizedDescription }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // A foreground window is retained before the authentication session starts.
        presentationWindow ?? ASPresentationAnchor()
    }

    private func finishCallback(_ result: Result<URL, Error>, attempt: UUID) {
        guard pendingSignIn == attempt, let continuation = callbackContinuation else { return }
        callbackContinuation = nil
        continuation.resume(with: result)
    }

    private func present(_ url: URL, attempt: UUID) async throws -> URL {
        #if canImport(UIKit)
        presentationWindow = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.compactMap { $0.keyWindow }.first
        #else
        presentationWindow = NSApp?.keyWindow
        #endif
        guard presentationWindow != nil else { throw SpotifyAccountError("Open Eddy on screen, then tap Sign in again.") }
        return try await withCheckedThrowingContinuation { continuation in
            callbackContinuation = continuation
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "eddyspotify") { [weak self] callback, error in
                let result: Result<URL, Error>
                if let callback { result = .success(callback) }
                else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    result = .failure(SpotifyAccountError("Spotify sign-in was canceled."))
                } else {
                    result = .failure(SpotifyAccountError("Could not open Spotify sign-in. Try again."))
                }
                Task { @MainActor in self?.finishCallback(result, attempt: attempt) }
            }
            session.presentationContextProvider = self
            webSession = session
            if !session.start() {
                finishCallback(.failure(SpotifyAccountError("Could not start Spotify sign-in.")), attempt: attempt)
            }
        }
    }

    @discardableResult func handleSpotifyCallback(_ url: URL) -> Bool {
        #if canImport(UIKit)
        return appLogin?.open(url) ?? false
        #else
        return false
        #endif
    }

    private func authorize(clientID id: String, preferSpotifyApp: Bool, attempt: UUID) async throws -> SpotifyTokenResponse {
        #if canImport(UIKit)
        if preferSpotifyApp {
            let login = SpotifyAppLogin(clientID: id)
            if login.manager.isSpotifyAppInstalled {
                appLogin = login
                waitingForSpotifyApp = true
                status = "Approve Eddy in Spotify."
                defer {
                    if pendingSignIn == attempt {
                        appLogin = nil
                        waitingForSpotifyApp = false
                    }
                }
                do { return try await login.start() }
                catch let error as SpotifyError where error == .authorizationCancelled || error == .accessDenied {
                    throw SpotifyAccountError(error.localizedDescription)
                } catch {
                    guard pendingSignIn == attempt else { throw CancellationError() }
                    // The app could not complete the handoff. The existing HTTPS
                    // registration still supports personal accounts set up for web.
                }
            }
        }
        #endif
        let state = "eddy-ios-" + (try SpotifyOAuth.randomString())
        let verifier = try SpotifyOAuth.randomString()
        status = "Waiting for Spotify…"
        let callback = try await present(SpotifyOAuth.authorizeURL(clientID: id, state: state, verifier: verifier), attempt: attempt)
        guard pendingSignIn == attempt else { throw CancellationError() }
        let code = try SpotifyOAuth.callbackCode(callback, state: state)
        return try await exchange(["grant_type":"authorization_code", "client_id":id, "code":code,
                                   "redirect_uri":SpotifyOAuth.redirect, "code_verifier":verifier])
    }

    func signIn(clientID input: String, preferSpotifyApp: Bool = true) async {
        if isSigningIn {
            guard waitingForSpotifyApp, !preferSpotifyApp else { return }
            #if canImport(UIKit)
            appLogin?.cancel()
            appLogin = nil
            #endif
            waitingForSpotifyApp = false
        }
        let attempt = UUID()
        pendingSignIn = attempt
        isSigningIn = true
        defer {
            if pendingSignIn == attempt {
                pendingSignIn = nil
                isSigningIn = false
                webSession = nil
                presentationWindow = nil
            }
        }
        do {
            let id = try SpotifyOAuth.clientID(input)
            let token = try await authorize(clientID: id, preferSpotifyApp: preferSpotifyApp, attempt: attempt)
            guard pendingSignIn == attempt else { return }
            let key = try await profileKey(token: token.access_token, id: id)
            var next = SpotifyCredential(id: id, accountKey: key, access: "", refresh: "", expires: .distantPast)
            try next.update(token)
            guard pendingSignIn == attempt else { return }
            try SpotifyKeychain.save(next)
            generation = UUID()
            refreshing?.cancel()
            refreshing = nil
            apply(next)
        } catch {
            if pendingSignIn == attempt { status = error.localizedDescription }
        }
    }

    func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard var next = credential else { throw SpotifyAccountError("Sign in to Spotify in Eddy.") }
        if let refreshing { return try await refreshing.value }
        if !forceRefresh && next.expires.timeIntervalSinceNow > 60 { return next.access }
        let current = generation
        let task = Task { () throws -> String in
            defer { if generation == current { refreshing = nil } }
            do {
                let response = try await exchange(["grant_type":"refresh_token", "client_id":next.id,
                                                   "refresh_token":next.refresh])
                guard generation == current else { throw CancellationError() }
                try next.update(response)
                try SpotifyKeychain.save(next)
                apply(next)
                return next.access
            } catch let error as SpotifyAccountError {
                if generation == current && error.expiredGrant {
                    signOut()
                    status = error.localizedDescription
                }
                throw error
            }
        }
        refreshing = task
        return try await task.value
    }

    private func exchange(_ fields: [String:String]) async throws -> SpotifyTokenResponse {
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = SpotifyOAuth.form(fields)
        let data = try await requestData(request)
        guard let response = try? JSONDecoder().decode(SpotifyTokenResponse.self, from: data) else {
            throw SpotifyAccountError("Spotify returned an unreadable sign-in response. Try again.", code: 2)
        }
        return response
    }

    private func profileKey(token: String, id: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://api.spotify.com/v1/me")!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let data = try await requestData(request)
        let profile = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let account = (profile?["account_id"] as? String) ?? (profile?["id"] as? String), !account.isEmpty else {
            throw SpotifyAccountError("Spotify could not identify the signed-in account. Try again.")
        }
        return SpotifyOAuth.namespace(clientID: id, accountID: account)
    }

    private func requestData(_ input: URLRequest) async throws -> Data {
        var request = input
        request.timeoutInterval = 15
        let data: Data, response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch let error as URLError where error.code != .cancelled {
            throw SpotifyAccountError("Could not reach Spotify. Check your connection and try again.", code: 2)
        }
        guard let http = response as? HTTPURLResponse else {
            throw SpotifyAccountError("Could not reach Spotify. Check your connection.", code: 2)
        }
        if (200..<300).contains(http.statusCode) { return data }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String:Any]
        let error = json?["error"] as? String
        if error == "invalid_grant" {
            throw SpotifyAccountError("Your Spotify sign-in expired. Sign in again.", expiredGrant: true)
        }
        if error == "invalid_client" {
            throw SpotifyAccountError("Spotify did not recognize the Client ID. Check your Spotify app settings.")
        }
        if http.statusCode == 403 {
            throw SpotifyAccountError("Spotify denied access. Check this account in the developer app’s User Management and the owner's Premium subscription.", code: 3)
        }
        if http.statusCode == 429 {
            let retry = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
            let quota = (json?["error"] as? [String:Any])?["reason"] as? String == "QUOTA_EXCEEDED"
            throw SpotifyAccountError(quota ? "Spotify’s developer quota has been reached. Try again later." :
                                       "Spotify is receiving too many requests. Try again shortly.",
                                      code: 4, retryAfter: retry ?? (quota ? 600 : 30))
        }
        throw SpotifyAccountError("Spotify could not complete sign-in. Try again.", code: http.statusCode >= 500 ? 2 : 1)
    }
}
