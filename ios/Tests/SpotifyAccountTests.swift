import Foundation

@main
struct SpotifyAccountTests {
    static func main() throws {
        // RFC 7636 Appendix B verifies the exact PKCE challenge sent to Spotify.
        let id = String(repeating: "ab", count: 16)
        let normalized = try SpotifyOAuth.clientID(" \n" + id.uppercased())
        precondition(normalized == id)
        precondition((try? SpotifyOAuth.clientID(id + "1")) == nil)
        let state = "eddy-ios-" + (try SpotifyOAuth.randomString())
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let url = SpotifyOAuth.authorizeURL(clientID: id, state: state, verifier: verifier)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let fields = Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value!) })
        precondition(fields["code_challenge"] == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        precondition(fields["code_challenge_method"] == "S256")
        precondition(fields["state"] == state && state.count == "eddy-ios-".count + 43 && fields["client_id"] == id)
        precondition(fields["redirect_uri"] == "https://mht3.github.io/eddy-firmware/spotify/")
        precondition(fields["response_type"] == "code" && fields["client_secret"] == nil)
        precondition(fields["scope"]!.split(separator: " ").count == 8)
        let valid = "eddyspotify://callback?code=sample&state=" + state
        let code = try SpotifyOAuth.callbackCode(URL(string: valid)!, state: state)
        precondition(code == "sample")
        for invalid in [valid + "&code=two", valid + "&state=different", valid + "&error=access_denied",
                        valid + "#extra", valid.replacingOccurrences(of: "callback?", with: "callback/extra?"),
                        valid.replacingOccurrences(of: "callback", with: "other"), valid + "wrong"] {
            precondition((try? SpotifyOAuth.callbackCode(URL(string: invalid)!, state: state)) == nil)
        }
        for accepted in ["?code=from-spotify", "?error=access_denied"] {
            precondition(SpotifyOAuth.isNativeCallback(URL(string: SpotifyOAuth.nativeRedirect + accepted)!))
        }
        for rejected in ["eddyspotify://callback?code=browser", "eddyspotify://setup?client_id=test",
                         "eddyspotify://user@spotify-login?code=x", "eddyspotify://spotify-login?code=",
                         "eddyspotify://spotify-login?code=a&code=b", "eddyspotify://spotify-login?error=no&code=yes"] {
            precondition(!SpotifyOAuth.isNativeCallback(URL(string: rejected)!))
        }
        let form = String(decoding: SpotifyOAuth.form(["code": "+?=&", "client_id": id]), as: UTF8.self)
        precondition(form == "client_id=" + id + "&code=%2B%3F%3D%26")
        let first = SpotifyOAuth.namespace(clientID: id, accountID: "first")
        precondition(first == SpotifyOAuth.namespace(clientID: id, accountID: "first"))
        precondition(first != SpotifyOAuth.namespace(clientID: id, accountID: "second"))
        var saved = SpotifyCredential(id: id, accountKey: first, access: "", refresh: "", expires: .distantPast)
        let initial = SpotifyTokenResponse(access_token: "example-access", token_type: "Bearer", expires_in: 3600,
                                          refresh_token: "example-refresh", scope: SpotifyOAuth.scopes.joined(separator: " "))
        try saved.update(initial)
        let restored = try JSONDecoder().decode(SpotifyCredential.self, from: JSONEncoder().encode(saved))
        precondition(restored.refresh == saved.refresh && restored.accountKey == first)
        let next = SpotifyTokenResponse(access_token: "refreshed", token_type: "Bearer", expires_in: 3600,
                                       refresh_token: nil, scope: nil)
        try saved.update(next)
        precondition(saved.access == "refreshed" && saved.refresh == "example-refresh" && saved.expires > Date())
        try saved.update(SpotifyTokenResponse(access_token: "second", token_type: "Bearer", expires_in: 3600,
                                             refresh_token: "rotated", scope: nil))
        precondition(saved.refresh == "rotated")
        do {
            try saved.update(SpotifyTokenResponse(access_token: "bad", token_type: "Bearer", expires_in: 3600,
                                                 refresh_token: "wrong", scope: "user-library-read"))
            preconditionFailure("Partial scopes must be rejected")
        } catch is SpotifyAccountError {}
        precondition(saved.refresh == "rotated" && saved.access == "second")
        print("Spotify PKCE, callbacks, scopes, account isolation, credential round-trip, and token rotation passed.")
    }
}
