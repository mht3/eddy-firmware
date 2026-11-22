import Foundation

// Run the phone's real URLSession adapter and BLE command router with a local Spotify response.
final class SpotifyFixture: URLProtocol {
    static let playlistID = String(repeating: "p", count: 22)
    static let trackID = String(repeating: "t", count: 22)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let url = request.url!
        precondition(url.host == "api.spotify.com" && request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture")
        var result: [String: Any] = [:]
        var code = 200
        let song: [String: Any] = ["name":"Sea Glass", "type":"track", "uri":"spotify:track:" + Self.trackID,
                                   "duration_ms":180000, "artists":[["name":"Eddy"]]]
        switch (request.httpMethod!, url.path) {
        case ("GET", "/v1/me/playlists"):
            result = ["offset":0, "items":[["name":"On the Coast", "uri":"spotify:playlist:" + Self.playlistID, "owner":["id":"me"]]]]
        case ("GET", "/v1/playlists/" + Self.playlistID + "/items"):
            result = ["offset":0, "items":[["item":song]]]
        case ("GET", "/v1/me/player"):
            result = ["item":song, "is_playing":true, "progress_ms":5100, "device":["id":"phone","supports_volume":true,"volume_percent":60]]
        case ("GET", "/v1/me/player/currently-playing"):
            result = ["progress_ms":5100,"is_playing":true]
        case ("PUT", "/v1/me/player/seek"):
            precondition(url.query == "position_ms=0")
            code = 204
        case ("POST", "/v1/me/player/queue"):
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            precondition(items?.first?.value == "spotify:track:" + Self.trackID)
            code = 204
        default: preconditionFailure("Unexpected Spotify request: " + url.path)
        }
        let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: nil)!
        client!.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if code != 204 { client!.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result)) }
        client!.urlProtocolDidFinishLoading(self)
    }
}

@main struct SpotifyLibraryTests {
    @MainActor static func main() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SpotifyFixture.self]
        let api = SpotifyLibrary(session: URLSession(configuration: config)) { _ in "fixture" }
        let bridge = LibraryBridge(api: api)
        var frames: [Data] = []
        bridge.start(accountKey: "test") { frames.append($0) }
        func press(_ op: UInt8, _ token: UInt8, base: UInt8 = 0) async throws -> [Data] {
            frames = []
            bridge.receive(Data([op, token, 0, base, 0]))
            for _ in 0..<200 {
                if let code = frames.last?.first, [0x12,0x13,0x14].contains(code) { return frames }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            preconditionFailure("No Bluetooth reply")
        }
        let playlists = try await press(0x18, 1)
        precondition(playlists.contains { $0.first == 0x11 && String(decoding:$0.dropFirst(4),as:UTF8.self).contains("On the Coast") })
        let tracks = try await press(0x38, 2, base:1)
        precondition(tracks.contains { $0.first == 0x11 && String(decoding:$0.dropFirst(4),as:UTF8.self).contains("Sea Glass") })
        let queued = try await press(0x28, 3, base:2)
        precondition(queued.last == Data([0x14,3,0,0]))
        let now = try await api.page(.nowPlaying, offset:0)
        precondition(now.playback?.volume == 60 && now.rows.first?.name == "Sea Glass")
        try await api.act(.previous)
        bridge.stop()
        print("Playlist browsing, track details, queue, Now Playing and restart verified through the native library adapter.")
    }
}
