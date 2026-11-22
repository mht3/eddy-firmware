import Foundation

enum LibrarySource: Equatable {
    case liked, playlists, albums, nowPlaying, queue
    case tracks(String)
    case destinations(String)
}

enum LibraryAction: Equatable {
    case play(String), queue(String), add(track: String, playlist: String)
    case previous, toggle, next, volume(Int, deviceID: String)
}

struct LibraryRow: Codable, Equatable {
    let uri: String
    let name: String
    let label: String
}

struct LibraryPlayback {
    let playing: Bool
    let progressMs: Int
    let durationMs: Int
    var volume: Int? = nil
    var deviceID: String? = nil
}

struct LibraryPage {
    let rows: [LibraryRow]
    var offset = 0
    var hasNext = false
    var playback: LibraryPlayback? = nil
}

// Raw values are part of the Flipper's Spotify error packet.
enum LibraryFailure: UInt8, Error {
    case noPlayer, login, offline, restricted, rateLimited, volumeUnavailable, missingPreset
}

@MainActor protocol LibraryAPI {
    func page(_ source: LibrarySource, offset: Int) async throws -> LibraryPage
    func act(_ action: LibraryAction) async throws
}

private struct LibraryCommand: Equatable {
    let op: UInt8
    let token: UInt16
    let base: UInt16
    let volume: UInt8?
    var row: Int { Int(op & 3) }

    init?(_ packet: Data) {
        let b = Array(packet)
        guard b.count == 5 || b.count == 6 else { return nil }
        op = b[0]
        token = UInt16(b[1]) | UInt16(b[2]) << 8
        base = UInt16(b[3]) | UInt16(b[4]) << 8
        guard token != 0 else { return nil }
        if op == 0x43 {
            guard b.count == 6, b[5] <= 100 else { return nil }
            volume = b[5]
        } else {
            guard b.count == 5 else { return nil }
            volume = nil
        }
        switch op {
        case 0x10, 0x15, 0x16, 0x18, 0x19, 0x1c, 0x1e, 0x40...0x43, 0x45, 0x46,
             0x60...0x64, 0x68...0x6b:
            guard base == 0 else { return nil }
        case 0x11, 0x12, 0x1d, 0x20...0x23, 0x28...0x2b, 0x30...0x3b, 0x50...0x5f, 0x70...0x7f:
            guard base != 0 else { return nil }
        default:
            return nil
        }
    }

    func packet(_ opcode: UInt8, _ payload: [UInt8] = []) -> Data {
        Data([opcode, UInt8(truncatingIfNeeded: token), UInt8(token >> 8)] + payload)
    }

    var mutates: Bool {
        switch op {
        case 0x20...0x23, 0x28...0x2b, 0x34...0x37, 0x40...0x43, 0x45,
             0x50...0x63, 0x68...0x6b, 0x70...0x7f: return true
        default: return false
        }
    }
}

@MainActor final class LibraryBridge {
    typealias Write = @MainActor (Data) async throws -> Void
    private struct Display {
        var source: LibrarySource
        var page: LibraryPage
        var token: UInt16
    }
    private let api: LibraryAPI
    private let defaults: UserDefaults
    private var write: Write?
    private var presetKey = ""
    private var pages: [Display] = []
    private var now: LibraryPage?
    private var receipts: [(LibraryCommand, Data)] = []
    private var pending: [LibraryCommand] = []
    private var worker: Task<Void, Never>?
    private var active: LibraryCommand?
    private var generation: UInt64 = 0

    init(api: LibraryAPI, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
    }

    func start(accountKey: String, write: @escaping Write) {
        stop()
        guard !accountKey.isEmpty else { return }
        presetKey = "eddy.spotify.shortcuts." + Data(accountKey.utf8).base64EncodedString()
        self.write = write
    }

    func stop() {
        clear()
        write = nil
        presetKey = ""
    }

    private func clear() {
        generation &+= 1
        worker?.cancel()
        worker = nil
        active = nil
        pending.removeAll()
        pages.removeAll()
        now = nil
        receipts.removeAll()
    }

    func receive(_ data: Data) {
        guard write != nil, let command = LibraryCommand(data) else { return }
        if command.op == 0x15 || command.op == 0x16 {
            clear()
            if command.op == 0x16 { return }
        }
        guard command != active, !pending.contains(command), pending.count < 8 else { return }
        pending.append(command)
        guard worker == nil else { return }
        let epoch = generation
        worker = Task { [weak self] in await self?.process(epoch) }
    }

    private func process(_ epoch: UInt64) async {
        defer {
            if generation == epoch { worker = nil; active = nil }
        }
        while epoch == generation, !Task.isCancelled, !pending.isEmpty, let write {
            let command = pending.removeFirst()
            active = command
            let responses: [Data]
            do {
                if let (earlier, receipt) = receipts.first(where: { $0.0.token == command.token }) {
                    guard earlier == command else { throw LibraryFailure.restricted }
                    responses = [receipt]
                } else {
                    responses = try await route(command, epoch: epoch)
                }
            } catch {
                guard epoch == generation, !Task.isCancelled else { return }
                if command.op == 0x1c { now = nil }
                let error = error as? LibraryFailure ?? .offline
                responses = [command.packet(0x13, [error.rawValue])]
            }
            guard epoch == generation, !Task.isCancelled else { return }
            if command.mutates, let response = responses.first,
               !receipts.contains(where: { $0.0.token == command.token }) {
                // Store success or an ambiguous failure before attempting the BLE acknowledgement.
                receipts.append((command, response))
                if receipts.count > 64 { receipts.removeFirst() }
            }
            for bytes in responses {
                guard generation == epoch, !Task.isCancelled else { return }
                do { try await write(bytes) }
                catch {
                    if generation == epoch { stop() }
                    return
                }
            }
        }
    }

    private func row(_ index: Int, in page: LibraryPage?, kind: String? = nil) throws -> LibraryRow {
        guard let page, page.rows.indices.contains(index) else { throw LibraryFailure.restricted }
        let item = page.rows[index]
        let parts = item.uri.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "spotify",
              ["track", "album", "playlist"].contains(String(parts[1])),
              kind == nil || String(parts[1]) == kind,
              parts[2].utf8.count == 22, parts[2].utf8.allSatisfy({
                  (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
              }) else { throw LibraryFailure.restricted }
        return item
    }

    private func readPresets() -> [LibraryRow?] {
        if let bytes = defaults.data(forKey: presetKey),
           let stored = try? JSONDecoder().decode([LibraryRow?].self, from: bytes), stored.count == 4 {
            return stored
        }
        return Array(repeating: nil, count: 4)
    }

    private func route(_ c: LibraryCommand, epoch: UInt64) async throws -> [Data] {
        if c.op == 0x15 { return [Data([0x15])] }
        let current = pages.last
        if c.base != 0, current?.token != c.base { throw LibraryFailure.restricted }
        var ack = UInt8(0)
        var action: LibraryAction?
        switch c.op {
        case 0x20...0x23, 0x28...0x2b:
            if case .destinations = current?.source { throw LibraryFailure.restricted }
            let item = try row(c.row, in: current?.page, kind: c.op >= 0x28 ? "track" : nil)
            action = c.op >= 0x28 ? .queue(item.uri) : .play(item.uri)
            ack = UInt8(c.row)
        case 0x34...0x37:
            guard case let .destinations(track) = current?.source else { throw LibraryFailure.restricted }
            action = .add(track: track, playlist: try row(c.row, in: current?.page, kind: "playlist").uri)
            ack = UInt8(c.row)
        case 0x40: action = .previous
        case 0x41: action = .toggle
        case 0x42: action = .next
        case 0x43:
            guard let value = c.volume, now?.playback?.volume != nil,
                  let device = now?.playback?.deviceID, !device.isEmpty else { throw LibraryFailure.volumeUnavailable }
            action = .volume(Int(value), deviceID: device)
        case 0x45: action = .queue(try row(0, in: now, kind: "track").uri)
        case 0x50...0x5f, 0x60...0x64, 0x68...0x6b, 0x70...0x7f:
            var slots = readPresets()
            if c.op == 0x64 {
                let empty = LibraryRow(uri: "", name: "", label: "Unassigned")
                return packets(LibraryPage(rows: slots.map { $0 ?? empty }), for: c)
            }
            let slot = (0x50...0x5f).contains(c.op) || c.op >= 0x70 ? Int((c.op >> 2) & 3) : c.row
            if (0x60...0x63).contains(c.op) {
                guard let saved = slots[slot] else { throw LibraryFailure.missingPreset }
                action = .play(saved.uri)
            } else if (0x68...0x6b).contains(c.op) {
                slots[slot] = nil
            } else {
                guard current?.source == .playlists else { throw LibraryFailure.restricted }
                let item = try row(c.row, in: current?.page, kind: "playlist")
                ack = UInt8(c.row)
                if c.op >= 0x70, let saved = slots[slot] {
                    action = .play(saved.uri)
                    ack += 4
                } else {
                    slots[slot] = item
                }
            }
            if action == nil { defaults.set(try JSONEncoder().encode(slots), forKey: presetKey) }
        default:
            return try await pageResponse(c, current: current, epoch: epoch)
        }
        if let action {
            try await api.act(action)
            guard generation == epoch, !Task.isCancelled else { throw CancellationError() }
            switch action {
            case .play, .next, .previous, .toggle: now = nil
            default: break
            }
        }
        return [c.packet(0x14, [ack])]
    }

    private func pageResponse(_ c: LibraryCommand, current: Display?, epoch: UInt64) async throws -> [Data] {
        var source: LibrarySource
        var offset = 0
        switch c.op {
        case 0x10: source = .liked
        case 0x18: source = .playlists
        case 0x19: source = .albums
        case 0x1c: source = .nowPlaying
        case 0x1e: source = .queue
        case 0x11, 0x12:
            guard let current, c.op == 0x11 ? current.page.hasNext : current.page.offset > 0 else {
                throw LibraryFailure.restricted
            }
            source = current.source
            offset = max(0, current.page.offset + (c.op == 0x11 ? 4 : -4))
        case 0x1d:
            guard pages.count > 1 else { throw LibraryFailure.restricted }
            pages.removeLast()
            pages[pages.count - 1].token = c.token
            return packets(pages[pages.count - 1].page, for: c)
        case 0x30...0x33: source = .destinations(try row(c.row, in: current?.page, kind: "track").uri)
        case 0x38...0x3b:
            guard current?.source == .playlists || current?.source == .albums else { throw LibraryFailure.restricted }
            source = .tracks(try row(c.row, in: current?.page, kind: current?.source == .playlists ? "playlist" : "album").uri)
        case 0x46:
            if case .destinations = current?.source { throw LibraryFailure.restricted }
            source = .destinations(try row(0, in: now, kind: "track").uri)
        default: throw LibraryFailure.restricted
        }
        let page = try await api.page(source, offset: offset)
        guard generation == epoch, !Task.isCancelled else { throw CancellationError() }
        guard page.rows.count <= 4, page.offset == offset, offset <= Int(UInt32.max) else {
            throw LibraryFailure.restricted
        }
        if source == .nowPlaying { now = page }
        else {
            if c.op == 0x11 || c.op == 0x12 { pages.removeLast() }
            else if [0x10, 0x18, 0x19, 0x1e].contains(c.op) { pages.removeAll() }
            pages.append(Display(source: source, page: page, token: c.token))
        }
        return packets(page, for: c)
    }

    private func bytes(_ label: String) -> [UInt8] {
        var result = [UInt8]()
        for scalar in label.unicodeScalars {
            let clean = (scalar.value < 32 || scalar.value == 127) ? " " : String(scalar)
            guard result.count + clean.utf8.count <= 80 else { break }
            result.append(contentsOf: clean.utf8)
        }
        return result
    }

    private func word(_ number: Int) -> [UInt8] {
        let n = UInt32(clamping: number)
        return (0..<4).map { UInt8(truncatingIfNeeded: n >> ($0 * 8)) }
    }

    private func packets(_ page: LibraryPage, for c: LibraryCommand) -> [Data] {
        var header: [UInt8] = []
        if c.op == 0x1c {
            let p = page.playback
            let duration = max(0, p?.durationMs ?? 0)
            header = [page.rows.isEmpty ? 0 : p.map { $0.playing ? 1 : 2 } ?? 0]
            header += word(min(duration, p?.progressMs ?? 0)) + word(duration)
            let volume = p?.volume.flatMap { (0...100).contains($0) ? UInt8($0) : nil }
            header += [UInt8(bytes(page.rows.first?.name ?? "").count),
                       p?.deviceID?.isEmpty == false ? volume ?? 255 : 255]
        }
        var result = [c.packet(0x10, header)]
        for (index, item) in page.rows.enumerated() {
            let label = bytes(item.label.isEmpty ? "Unavailable" : item.label)
            for i in stride(from: 0, to: label.count, by: 16) {
                result.append(c.packet(0x11, [UInt8(index)] + label[i..<min(i+16,label.count)]))
            }
        }
        result.append(c.packet(0x12, [UInt8(page.rows.count), page.offset > 0 ? 1 : 0,
                                      page.hasNext ? 1 : 0] + word(page.offset)))
        return result
    }
}
