import Foundation

/// Spotify's network and credential handling stay on the phone. Only display rows and controls travel over BLE.
@MainActor
final class SpotifyLibrary: LibraryAPI {
    typealias Object = [String: Any]
    private let token: (Bool) async throws -> String
    private let session: URLSession
    private var ownerID: String?
    private var retryAfter = Date.distantPast
    private var queue: [LibraryRow] = []
    private struct DestinationCursor {
        var nextOffset: Int? = 0
        var pending: [LibraryRow] = []
        var pages: [[LibraryRow]] = []
    }
    private var destinations = DestinationCursor()

    init(session: URLSession = .shared, token: @escaping (Bool) async throws -> String) {
        self.session = session
        self.token = token
    }

    private func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [],
                         body: Object? = nil) async throws -> Object {
        guard retryAfter <= Date() else { throw LibraryFailure.rateLimited }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "api.spotify.com"
        components.path = "/v1/" + path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw LibraryFailure.restricted }
        for refresh in [false, true] {
            let bearer = try await token(refresh)
            try Task.checkCancellation()
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
            request.httpMethod = method
            request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
            if let body {
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            let (bytes, response) = try await session.data(for: request)
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse else { throw LibraryFailure.offline }
            switch http.statusCode {
            case 200..<300:
                if bytes.isEmpty || method != "GET" { return [:] }
                guard let value = try JSONSerialization.jsonObject(with: bytes) as? Object else {
                    throw LibraryFailure.offline
                }
                return value
            case 401:
                if refresh { throw LibraryFailure.login }
            case 403:
                throw path == "me/player/volume" ? LibraryFailure.volumeUnavailable : LibraryFailure.restricted
            case 404:
                throw path.hasPrefix("me/player") ? LibraryFailure.noPlayer : LibraryFailure.restricted
            case 429:
                retryAfter = Date().addingTimeInterval(max(1, Double(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 30))
                throw LibraryFailure.rateLimited
            default:
                throw LibraryFailure.offline
            }
        }
        throw LibraryFailure.login
    }

    private func spotifyID(_ uri: String, kind: String) throws -> String {
        let prefix = "spotify:" + kind + ":"
        guard uri.hasPrefix(prefix) else { throw LibraryFailure.restricted }
        let id = String(uri.dropFirst(prefix.count))
        guard id.range(of: "^[a-zA-Z0-9]{22}$", options: .regularExpression) != nil else {
            throw LibraryFailure.restricted
        }
        return id
    }

    private func row(_ item: Object?, kind: String) -> LibraryRow {
        let name = item?["name"] as? String ?? "Unavailable"
        let artists = (item?["artists"] as? [Object])?.compactMap { $0["name"] as? String }.joined(separator: ", ")
        let subtitle = kind == "playlist" ? (item?["owner"] as? Object)?["display_name"] as? String : artists
        let uri = item?["uri"] as? String ?? ""
        let unavailable = item?["is_local"] as? Bool == true || item?["is_playable"] as? Bool == false ||
            (item?["restrictions"] as? Object)?["reason"] != nil
        let valid = !unavailable && (try? spotifyID(uri, kind: kind)) != nil
        return LibraryRow(uri: valid ? uri : "", name: name, label: [name, subtitle].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " - "))
    }

    private func items(_ path: String, offset: Int, limit: Int) async throws -> ([Object], Bool) {
        let page = try await request(path, query: [.init(name: "offset", value: String(offset)),
                                                    .init(name: "limit", value: String(limit))])
        guard page["offset"] as? Int == offset, let items = page["items"] as? [Object], items.count <= limit else {
            throw LibraryFailure.offline
        }
        let more = page["next"] is String
        if items.isEmpty && more { throw LibraryFailure.offline }
        return (items, more)
    }

    // Only show playlists the user can add tracks to. Cache the visible four-row pages independently
    // of Spotify's offsets so paging Back and retrying canceled requests preserve the selected row.
    private func ownedPlaylists(offset: Int) async throws -> LibraryPage {
        var cursor = offset == 0 ? DestinationCursor() : destinations
        if ownerID == nil {
            let profile = try await request("me")
            guard let id = profile["id"] as? String, !id.isEmpty else { throw LibraryFailure.restricted }
            ownerID = id
        }
        let i = offset / 4
        if i == cursor.pages.count {
            for _ in 0..<2 {
                guard cursor.pending.count <= 4, let next = cursor.nextOffset else { break }
                let (batch, more) = try await items("me/playlists", offset: next, limit: 50)
                cursor.pending += batch.filter { ($0["owner"] as? Object)?["id"] as? String == ownerID }
                    .map { row($0, kind: "playlist") }.filter { !$0.uri.isEmpty }
                cursor.nextOffset = more ? next + batch.count : nil
            }
            let rows = Array(cursor.pending.prefix(4))
            cursor.pending.removeFirst(rows.count)
            cursor.pages.append(rows)
        }
        guard cursor.pages.indices.contains(i) else { throw LibraryFailure.restricted }
        try Task.checkCancellation()
        destinations = cursor
        return LibraryPage(rows: cursor.pages[i], offset: offset,
                           hasNext: i + 1 < cursor.pages.count || !cursor.pending.isEmpty || cursor.nextOffset != nil)
    }

    func page(_ source: LibrarySource, offset: Int) async throws -> LibraryPage {
        guard offset >= 0, offset % 4 == 0 else { throw LibraryFailure.restricted }
        let path: String
        let kind: String
        var unwrap: String?
        switch source {
        case .nowPlaying:
            let state = try await request("me/player")
            let item = state["item"] as? Object
            let device = state["device"] as? Object
            let volume = device?["volume_percent"] as? Int
            let adjustable = device?["supports_volume"] as? Bool == true && device?["is_restricted"] as? Bool != true
            let playback = LibraryPlayback(playing: state["is_playing"] as? Bool == true,
                                           progressMs: state["progress_ms"] as? Int ?? 0,
                                           durationMs: item?["duration_ms"] as? Int ?? 0,
                                           volume: adjustable ? volume : nil, deviceID: device?["id"] as? String)
            return LibraryPage(rows: item?["type"] as? String == "track" ? [row(item, kind: "track")] : [], playback: playback)
        case .queue:
            if offset == 0 {
                let result = try await request("me/player/queue")
                guard let entries = result["queue"] as? [Object] else { throw LibraryFailure.noPlayer }
                queue = entries.filter { $0["type"] as? String == "track" }.map { row($0, kind: "track") }
            }
            return LibraryPage(rows: Array(queue.dropFirst(offset).prefix(4)), offset: offset, hasNext: offset + 4 < queue.count)
        case .destinations: return try await ownedPlaylists(offset: offset)
        case .liked: path = "me/tracks"; kind = "track"; unwrap = "track"
        case .albums: path = "me/albums"; kind = "album"; unwrap = "album"
        case .playlists: path = "me/playlists"; kind = "playlist"
        case let .tracks(uri):
            if uri.hasPrefix("spotify:playlist:") {
                path = "playlists/" + (try spotifyID(uri, kind: "playlist")) + "/items"
                unwrap = "item"
            } else { path = "albums/" + (try spotifyID(uri, kind: "album")) + "/tracks" }
            kind = "track"
        }
        let (entries, more) = try await items(path, offset: offset, limit: 4)
        let rows = entries.map { entry in
            row(unwrap.map { entry[$0] as? Object ?? entry["track"] as? Object } ?? entry, kind: kind)
        }
        return LibraryPage(rows: rows, offset: offset, hasNext: more)
    }

    func act(_ action: LibraryAction) async throws {
        switch action {
        case let .play(uri):
            let kind = uri.split(separator: ":").dropFirst().first.map(String.init) ?? ""
            guard ["track", "album", "playlist"].contains(kind) else { throw LibraryFailure.restricted }
            _ = try spotifyID(uri, kind: kind)
            _ = try await request("me/player/play", method: "PUT", body: kind == "track" ? ["uris": [uri]] : ["context_uri": uri])
        case let .queue(uri):
            _ = try spotifyID(uri, kind: "track")
            _ = try await request("me/player/queue", method: "POST", query: [.init(name: "uri", value: uri)])
        case let .add(track, playlist):
            _ = try spotifyID(track, kind: "track")
            let id = try spotifyID(playlist, kind: "playlist")
            _ = try await request("playlists/" + id + "/items", method: "POST", body: ["uris": [track]])
        case .previous:
            let state = try await request("me/player/currently-playing")
            if (state["progress_ms"] as? Int ?? 0) >= 3000 {
                _ = try await request("me/player/seek", method: "PUT", query: [.init(name: "position_ms", value: "0")])
            } else { _ = try await request("me/player/previous", method: "POST") }
        case .toggle:
            let state = try await request("me/player/currently-playing")
            _ = try await request(state["is_playing"] as? Bool == true ? "me/player/pause" : "me/player/play", method: "PUT")
        case .next:
            _ = try await request("me/player/next", method: "POST")
        case let .volume(value, deviceID):
            guard (0...100).contains(value), !deviceID.isEmpty else { throw LibraryFailure.volumeUnavailable }
            _ = try await request("me/player/volume", method: "PUT", query: [
                .init(name: "volume_percent", value: String(value)), .init(name: "device_id", value: deviceID)])
        }
    }
}
