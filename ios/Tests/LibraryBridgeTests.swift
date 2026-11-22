import Foundation

@MainActor private final class MockLibrary: LibraryAPI {
    let track = "spotify:track:" + String(repeating: "t", count: 22)
    let playlist = "spotify:playlist:" + String(repeating: "p", count: 22)
    var actions: [LibraryAction] = []
    var blocked: CheckedContinuation<Void, Never>?
    var delayNext = false

    func page(_ source: LibrarySource, offset: Int) async throws -> LibraryPage {
        if delayNext {
            delayNext = false
            await withCheckedContinuation { blocked = $0 }
        }
        let tune = LibraryRow(uri: track, name: "Song", label: "Song - Dolphin")
        let mix = LibraryRow(uri: playlist, name: "The Coast", label: "The Coast")
        switch source {
        case .nowPlaying:
            return LibraryPage(rows: [tune], playback: .init(playing: true, progressMs: 1_500,
                durationMs: 2_000, volume: 68, deviceID: "iphone"))
        case .playlists, .destinations:
            return LibraryPage(rows: [mix], offset: offset)
        case .tracks, .liked:
            let unicode = LibraryRow(uri: track, name: "", label: String(repeating: "🐬", count: 25) + "\n")
            return LibraryPage(rows: [unicode], offset: offset, hasNext: offset == 0)
        case .albums, .queue: return LibraryPage(rows: [], offset: offset)
        }
    }

    func act(_ action: LibraryAction) async throws { actions.append(action) }
}

@main struct BridgeTest {
    @MainActor static func main() async throws {
        let suite = "EddyLibraryTest-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let api = MockLibrary()
        let bridge = LibraryBridge(api: api, defaults: defaults)
        var output: [Data] = []
        func start(_ key: String) {
            bridge.start(accountKey: key) { output.append($0) }
        }
        func request(_ op: UInt8, _ token: UInt8, _ base: UInt8 = 0, _ extra: [UInt8] = []) -> Data {
            Data([op, token, 0, base, 0] + extra)
        }
        func command(_ op: UInt8, _ token: UInt8, _ base: UInt8 = 0, _ extra: [UInt8] = []) async throws -> [Data] {
            let before = output.count
            bridge.receive(request(op, token, base, extra))
            for _ in 0..<500 {
                if let last = output.last, output.count > before,
                   [0x12,0x13,0x14,0x15].contains(last.first!) {
                    return Array(output.dropFirst(before))
                }
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            fatalError("No complete reply for command " + String(op))
        }
        func expect(_ op: UInt8, _ token: UInt8, _ base: UInt8 = 0, _ payload: [UInt8], _ extra: [UInt8] = []) async throws {
            let response = try await command(op, token, base, extra)
            precondition(response.last == Data([payload[0],token,0] + payload.dropFirst()))
        }

        start("alice")
        let hello = try await command(0x15, 1)
        precondition(hello == [Data([0x15])])
        let status = try await command(0x1c, 2)
        precondition(status.first == Data([0x10,2,0,1,220,5,0,0,208,7,0,0,4,68]))
        try await expect(0x43, 3, 0, [0x14,0], [50])
        precondition(api.actions.last == .volume(50, deviceID: "iphone"))

        _ = try await command(0x18, 4)
        try await expect(0x78, 5, 4, [0x14,0]) // hold Left assigns the selected playlist
        try await expect(0x78, 6, 4, [0x14,4]) // second hold plays it
        precondition(api.actions.last == .play(api.playlist))
        let collection = try await command(0x38, 7, 4)
        let text = collection.dropFirst().dropLast().reduce(into: Data()) { $0.append($1.dropFirst(4)) }
        precondition(text.count == 80 && String(data: text, encoding: .utf8) == String(repeating: "🐬", count: 20))
        precondition(collection.allSatisfy { $0.count <= 20 })
        try await expect(0x28, 8, 7, [0x14,0])
        try await expect(0x28, 8, 7, [0x14,0])
        precondition(api.actions.filter { $0 == .queue(api.track) }.count == 1)
        try await expect(0x28, 9, 4, [0x13,3]) // stale page token
        let second = try await command(0x11, 10, 7)
        precondition(second.last == Data([0x12,10,0,1,1,0,4,0,0,0]))
        try await expect(0x20, 77, 10, [0x14,0])
        precondition(api.actions.last == .playFrom(context: api.playlist, position: 4))
        _ = try await command(0x30, 11, 10)
        try await expect(0x34, 12, 11, [0x14,0])
        precondition(api.actions.last == .add(track: api.track, playlist: api.playlist))
        _ = try await command(0x1d, 13, 11)
        try await expect(0x28, 14, 13, [0x14,0])
        try await expect(0x42, 15, 0, [0x14,0])
        precondition(api.actions.last == .next)
        let targets = try await command(0x46, 76) // Save from Now Playing immediately after Next
        precondition(targets.last?.first == 0x12)
        // A hold on Liked Songs fills an empty shortcut, or plays the existing assignment.
        try await expect(0x87, 78, 0, [0x14,0])
        try await expect(0x87, 79, 0, [0x14,4])
        precondition(api.actions.last == .playLiked(position: 0, selectedURI: nil))
        try await expect(0x86, 80, 0, [0x14,4])
        precondition(api.actions.last == .play(api.playlist))
        try await expect(0x82, 81, 0, [0x14,0]) // explicitly replace the playlist
        let shortcuts = try await command(0x64, 82)
        precondition(shortcuts.contains { $0.starts(with: [0x11,82,0,2]) && String(decoding: $0.dropFirst(4), as: UTF8.self) == "Liked Songs" })
        bridge.stop()
        start("bob")
        try await expect(0x62, 1, 0, [0x13,6])
        start("alice")
        try await expect(0x62, 1, 0, [0x14,0]) // account-scoped persistence

        precondition(api.actions.last == .playLiked(position: 0, selectedURI: nil))
        try await expect(0x6a, 2, 0, [0x14,0])
        try await expect(0x62, 3, 0, [0x13,6])

        api.delayNext = true
        bridge.receive(request(0x18, 90))
        while api.blocked == nil { await Task.yield() }
        bridge.stop()
        let count = output.count
        api.blocked?.resume()
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(output.count == count)
        start("alice")
        try await expect(0x28, 91, 90, [0x13,3]) // cancelled request never installs a stale page
        let prior = output.count
        bridge.receive(request(0x43, 99, 0, [101]))
        bridge.receive(request(0x28, 0, 1))
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(output.count == prior)
        print("Passed native bridge packet, playback, preset, paging, mutation and reconnect checks.")
    }
}
