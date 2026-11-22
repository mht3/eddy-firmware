import Combine
import CoreBluetooth
import Foundation

/// All GATT callbacks and UI state use the main queue. iOS can suspend the app
/// between BLE events, so a resumed heartbeat renews the firmware session.
@MainActor
final class FlipperConnection: NSObject, ObservableObject, @preconcurrency CBCentralManagerDelegate, @preconcurrency CBPeripheralDelegate {
    struct Device: Identifiable, Codable, Equatable {
        let id: UUID
        let name: String
    }

    @Published private(set) var devices: [Device] = []
    @Published private(set) var savedDevices: [Device] = []
    @Published private(set) var systemConnectedIDs: Set<UUID> = []
    @Published private(set) var connectedID: UUID?
    @Published private(set) var status = "Choose your Flipper."
    @Published private(set) var connectedName: String?
    @Published private(set) var selectedID: UUID?
    @Published private(set) var isScanning = false

    var onConnect: (() -> Void)?
    var onCommand: ((Data) -> Void)?
    var onDisconnect: (() -> Void)?

    private static let selectionKey = "eddy.spotify.peripheral"
    private static let savedKey = "eddy.spotify.peripherals"
    // Flipper's normal serial profile exposes a read-only, authenticated flow counter.
    private static let serial = CBUUID(string: "8FE5B3D5-2E7F-4A98-2A48-7ACC60FE0000")
    private static let flow = CBUUID(string: "19ED82AE-ED21-4C9D-4145-228E63FE0000")
    private static let media = CBUUID(string: "EFDD0001-5A34-4A32-9FAB-1F72E60D00ED")
    private static let state = CBUUID(string: "EFDD0002-5A34-4A32-9FAB-1F72E60D00ED")
    private static let commands = CBUUID(string: "EFDD0003-5A34-4A32-9FAB-1F72E60D00ED")
    private static let advertised = ["3080", "3081", "3082", "3083"].map(CBUUID.init(string:)) + [media]

    private let defaults: UserDefaults
    private var central: CBCentralManager?
    private var discovered: [UUID: CBPeripheral] = [:]
    private var peripheral: CBPeripheral?
    // CoreBluetooth can return the same object for a new connection. Wait for
    // the old disconnect callback before issuing another connect for that ID.
    private var closing: [UUID: CBPeripheral] = [:]
    private var stateCharacteristic: CBCharacteristic?
    private var commandCharacteristic: CBCharacteristic?
    private var flowCharacteristic: CBCharacteristic?
    private var libraryEnabled = false
    private var libraryStarted = false
    private var firmwareLibraryEnabled = false
    private var wantsScan = false
    private var wantsConnection = false
    private var ready = false
    private var generation = 0
    private var retry: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var transition: Task<Void, Never>?

    private enum WriteKind { case reply, hello, goodbye }
    private struct Write {
        let id: UUID
        let data: Data
        let kind: WriteKind
        var result: CheckedContinuation<Void, Error>?
    }
    private var writes: [Write] = []
    private var currentWrite: Write?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.selectedID = defaults.string(forKey: Self.selectionKey).flatMap(UUID.init(uuidString:))
        self.savedDevices = defaults.data(forKey: Self.savedKey)
            .flatMap { try? JSONDecoder().decode([Device].self, from: $0) } ?? []
        super.init()
        // Older installs remembered one UUID but did not retain its name.
        if let id = selectedID, !savedDevices.contains(where: { $0.id == id }) {
            save(Device(id: id, name: "Flipper Zero"))
        }
    }

    private func save(_ device: Device) {
        if let i = savedDevices.firstIndex(where: { $0.id == device.id }) {
            guard savedDevices[i] != device else { return }
            savedDevices[i] = device
        } else {
            savedDevices.append(device)
        }
        persistDevices()
    }

    private func persistDevices() {
        if let data = try? JSONEncoder().encode(savedDevices) { defaults.set(data, forKey: Self.savedKey) }
    }

    func refreshDevices() {
        guard let central else {
            drive()
            return
        }
        guard central.state == .poweredOn else { return }
        let system = central.retrieveConnectedPeripherals(withServices: Self.advertised + [Self.serial])
        systemConnectedIDs = Set(system.map(\.identifier))
        for item in system { remember(item) }
    }

    func scan() {
        stopScan()
        wantsScan = true
        discovered.removeAll()
        devices = []
        drive()
    }

    func stopScanning() {
        wantsScan = false
        stopScan()
    }

    func select(_ id: UUID) {
        guard discovered[id] != nil || savedDevices.contains(where: { $0.id == id }) else { return }
        selectedID = id
        reconnect()
    }

    func reconnect() {
        guard let id = selectedID else { return }
        wantsScan = false
        stopScan()
        wantsConnection = true
        if let current = peripheral {
            if current.identifier == id { reconcileLibrary(); return }
            if ready {
                armTimeout(seconds: 2, message: "Switching Flippers.")
                reconcileLibrary()
                return
            }
        }
        stopSession(cancelLink: true)
        drive()
    }

    func disconnect() {
        wantsScan = false
        wantsConnection = false
        stopScan()
        status = "Flipper disconnected."
        if ready {
            armTimeout(seconds: 2, message: status)
            reconcileLibrary()
        } else {
            stopSession(cancelLink: true)
        }
    }

    func forget(_ id: UUID) {
        if selectedID == id {
            disconnect()
            selectedID = nil
        }
        if defaults.string(forKey: Self.selectionKey) == id.uuidString {
            defaults.removeObject(forKey: Self.selectionKey)
        }
        savedDevices.removeAll { $0.id == id }
        persistDevices()
    }

    func forget() {
        if let id = selectedID { forget(id) }
    }

    func setLibraryEnabled(_ enabled: Bool) {
        libraryEnabled = enabled
        reconcileLibrary()
    }

    private var usingSelectedDevice: Bool {
        wantsConnection && peripheral?.identifier == selectedID
    }

    private var wantsLibrary: Bool { ready && usingSelectedDevice && libraryEnabled }

    private func endLibrary() {
        guard libraryStarted else { return }
        libraryStarted = false
        heartbeat?.cancel()
        heartbeat = nil
        onDisconnect?()
        // In-flight GATT writes still consume their eventual response. Only
        // invalidate application data here; hello/goodbye serialize separately.
        if currentWrite?.kind == .reply, let id = currentWrite?.id { cancelWrite(id) }
        for write in writes where write.kind == .reply { cancelWrite(write.id) }
    }

    private func reconcileLibrary() {
        if !wantsLibrary { endLibrary() }
        guard ready, transition == nil else { return }
        if !wantsLibrary && !firmwareLibraryEnabled {
            if !usingSelectedDevice {
                stopSession(cancelLink: true)
                if wantsConnection { drive() }
            }
            return
        }
        if wantsLibrary && firmwareLibraryEnabled && libraryStarted { return }
        let enable = wantsLibrary
        let session = generation
        transition = Task { [weak self] in
            guard let self, self.generation == session, !Task.isCancelled else { return }
            if self.wantsLibrary == enable {
                if enable {
                    self.libraryStarted = true
                    self.onConnect?()
                }
                do {
                    try await self.enqueue(Data([enable ? 0x15 : 0x16]), kind: enable ? .hello : .goodbye)
                    guard self.generation == session else { return }
                    self.firmwareLibraryEnabled = enable
                    if enable && self.wantsLibrary && self.libraryStarted { self.startHeartbeat() }
                } catch {
                    // A pending hello can be invalidated by signing out while
                    // the previous session's final GATT write is in flight.
                    guard self.generation == session else { return }
                }
            }
            self.transition = nil
            self.reconcileLibrary()
        }
    }

    func write(_ data: Data) async throws {
        guard libraryStarted, wantsLibrary, !data.isEmpty, data.count <= 20 else { throw LinkError.unavailable }
        try await enqueue(data, kind: .reply)
    }

    private func enqueue(_ data: Data, kind: WriteKind) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                guard peripheral != nil, stateCharacteristic != nil else {
                    continuation.resume(throwing: LinkError.unavailable)
                    return
                }
                writes.append(Write(id: id, data: data, kind: kind, result: continuation))
                pump()
            }
            try Task.checkCancellation()
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancelWrite(id) }
        }
    }

    private enum LinkError: LocalizedError {
        case unavailable
        var errorDescription: String? { "The Flipper Bluetooth connection is unavailable." }
    }

    private func cancelWrite(_ id: UUID) {
        if currentWrite?.id == id {
            currentWrite?.result?.resume(throwing: CancellationError())
            currentWrite?.result = nil
        } else if let i = writes.firstIndex(where: { $0.id == id }) {
            writes.remove(at: i).result?.resume(throwing: CancellationError())
        }
    }

    private func pump() {
        guard currentWrite == nil, !writes.isEmpty, let peripheral, let stateCharacteristic else { return }
        while writes.first?.kind == .hello && !wantsLibrary {
            writes.removeFirst().result?.resume(throwing: CancellationError())
        }
        guard !writes.isEmpty else { return }
        let write = writes.removeFirst()
        currentWrite = write
        armTimeout(seconds: usingSelectedDevice ? 12 : 2, message: "Flipper stopped responding.")
        peripheral.writeValue(write.data, for: stateCharacteristic, type: .withResponse)
    }

    private func failWrites() {
        currentWrite?.result?.resume(throwing: LinkError.unavailable)
        currentWrite = nil
        for write in writes { write.result?.resume(throwing: LinkError.unavailable) }
        writes.removeAll()
    }

    private func drive() {
        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main)
            return
        }
        guard let central, central.state == .poweredOn else { return }
        refreshDevices()
        if wantsScan && !isScanning {
            central.scanForPeripherals(withServices: Self.advertised)
            isScanning = true
            if connectedID == nil { status = "Choose your Flipper." }
        }
        if wantsConnection, let id = selectedID, peripheral == nil, closing[id] == nil {
            if let match = discovered[id] ?? central.retrievePeripherals(withIdentifiers: [id]).first {
                stopScan()
                peripheral = match
                match.delegate = self
                status = "Connecting to \(match.name ?? "your Flipper")…"
                central.connect(match)
            } else {
                status = "Waiting for your saved Flipper…"
                central.scanForPeripherals(withServices: Self.advertised)
                isScanning = true
            }
        }
    }

    private func remember(_ item: CBPeripheral, name: String? = nil) {
        let id = item.identifier
        discovered[id] = item
        let saved = savedDevices.first(where: { $0.id == id })
        let label = name ?? item.name ?? saved?.name ?? "Flipper Zero"
        if saved != nil { save(Device(id: id, name: label)) }
        if let i = devices.firstIndex(where: { $0.id == id }) {
            if devices[i].name != label { devices[i] = Device(id: id, name: label) }
        } else {
            devices.append(Device(id: id, name: label))
        }
    }

    private func stopScan() {
        if central?.state == .poweredOn { central?.stopScan() }
        isScanning = false
    }

    private func stopSession(cancelLink: Bool) {
        generation += 1
        endLibrary()
        ready = false
        firmwareLibraryEnabled = false
        connectedName = nil
        connectedID = nil
        retry?.cancel()
        retry = nil
        watchdog?.cancel()
        watchdog = nil
        heartbeat?.cancel()
        heartbeat = nil
        transition?.cancel()
        transition = nil
        failWrites()
        let old = peripheral
        peripheral = nil
        stateCharacteristic = nil
        commandCharacteristic = nil
        flowCharacteristic = nil
        old?.delegate = nil
        if cancelLink, let old, central?.state == .poweredOn, old.state != .disconnected {
            closing[old.identifier] = old
            central?.cancelPeripheralConnection(old)
        }
    }

    private func scheduleRetry() {
        guard wantsConnection, let id = selectedID, central?.state == .poweredOn else { return }
        retry?.cancel()
        let session = generation
        retry = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, let self, self.generation == session,
                  self.selectedID == id, self.wantsConnection else { return }
            self.retry = nil
            self.drive()
        }
    }

    private func failed(_ message: String, cancelLink: Bool = true) {
        stopSession(cancelLink: cancelLink)
        status = wantsConnection ? message + " Reconnecting…" : "Flipper disconnected."
        scheduleRetry()
    }

    private func armTimeout(seconds: UInt64, message: String) {
        watchdog?.cancel()
        let session = generation
        watchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            guard !Task.isCancelled, let self, self.generation == session else { return }
            self.failed(message)
        }
    }

    private func startHeartbeat() {
        let session = generation
        heartbeat = Task { [weak self] in
            var last = Date()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                guard !Task.isCancelled, let self, self.generation == session, self.wantsLibrary, self.libraryStarted else { return }
                let refresh = Date().timeIntervalSince(last) >= 40
                if refresh {
                    self.endLibrary()
                    self.reconcileLibrary()
                    return
                }
                do {
                    try await self.write(Data([0x17]))
                } catch { return } // A failed GATT acknowledgment also tears down the link.
                last = Date()
            }
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
#if os(iOS)
            central.registerForConnectionEvents(options: [.serviceUUIDs: Self.advertised + [Self.serial]])
#endif
            drive()
            return
        }
        stopSession(cancelLink: false)
        closing.removeAll()
        systemConnectedIDs = []
        discovered.removeAll()
        devices = []
        isScanning = false
        switch central.state {
        case .poweredOff: status = "Turn on Bluetooth to connect your Flipper."
        case .unauthorized: status = "Allow Bluetooth access for Eddy in Settings."
        case .unsupported: status = "Bluetooth Low Energy is unavailable on this device."
        default: status = "Waiting for Bluetooth…"
        }
    }

#if os(iOS)
    func centralManager(_ central: CBCentralManager, connectionEventDidOccur event: CBConnectionEvent,
                        for peripheral: CBPeripheral) {
        refreshDevices()
    }
#endif

    func centralManager(_ central: CBCentralManager, didDiscover item: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard wantsScan || (wantsConnection && selectedID == item.identifier) else { return }
        remember(item, name: advertisementData[CBAdvertisementDataLocalNameKey] as? String)
        if wantsConnection && item.identifier == selectedID { drive() }
    }

    func centralManager(_ central: CBCentralManager, didConnect item: CBPeripheral) {
        guard item === peripheral, wantsConnection else {
            central.cancelPeripheralConnection(item)
            return
        }
        refreshDevices()
        item.discoverServices([Self.serial, Self.media])
        armTimeout(seconds: 20, message: "Flipper pairing timed out.")
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect item: CBPeripheral, error: Error?) {
        ended(item)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral item: CBPeripheral, error: Error?) {
        ended(item)
    }

    private func ended(_ item: CBPeripheral) {
        refreshDevices()
        if closing.removeValue(forKey: item.identifier) != nil {
            if retry == nil { drive() }
        } else if item === peripheral {
            failed("Flipper disconnected.", cancelLink: false)
        }
    }

    func peripheral(_ item: CBPeripheral, didDiscoverServices error: Error?) {
        guard item === peripheral else { return }
        guard error == nil,
              let serial = item.services?.first(where: { $0.uuid == Self.serial }),
              item.services?.contains(where: { $0.uuid == Self.media }) == true else {
            failed("Eddy’s media service is unavailable. Turn on Bluetooth on your Flipper.")
            return
        }
        item.discoverCharacteristics([Self.flow], for: serial)
    }

    func peripheral(_ item: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard item === peripheral else { return }
        if service.uuid == Self.serial {
            guard error == nil, let flow = service.characteristics?.first(where: {
                $0.uuid == Self.flow && $0.properties.contains(.read)
            }) else {
                failed("Could not verify the Flipper Bluetooth connection.")
                return
            }
            flowCharacteristic = flow
            item.readValue(for: flow)
            return
        }
        guard service.uuid == Self.media else { return }
        guard error == nil,
              let state = service.characteristics?.first(where: { $0.uuid == Self.state && $0.properties.contains(.write) }),
              let commands = service.characteristics?.first(where: { $0.uuid == Self.commands && $0.properties.contains(.notify) })
        else {
            failed("Eddy’s media controls are unavailable.")
            return
        }
        stateCharacteristic = state
        commandCharacteristic = commands
        item.setNotifyValue(true, for: commands)
    }

    func peripheral(_ item: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard item === peripheral, characteristic === commandCharacteristic else { return }
        guard error == nil, characteristic.isNotifying else {
            failed("Flipper media notifications are unavailable.")
            return
        }
        guard !ready, wantsConnection else { return }
        ready = true
        let name = item.name ?? devices.first(where: { $0.id == item.identifier })?.name ?? "Flipper Zero"
        connectedID = item.identifier
        connectedName = name
        status = "Connected to " + name + "."
        save(Device(id: item.identifier, name: name))
        defaults.set(item.identifier.uuidString, forKey: Self.selectionKey)
        watchdog?.cancel()
        refreshDevices()
        reconcileLibrary()
    }

    func peripheral(_ item: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard item === peripheral else { return }
        if characteristic === flowCharacteristic {
            guard error == nil, characteristic.value?.count == 4,
                  let media = item.services?.first(where: { $0.uuid == Self.media }) else {
                failed("Flipper pairing was not completed.")
                return
            }
            flowCharacteristic = nil
            item.discoverCharacteristics([Self.state, Self.commands], for: media)
            return
        }
        guard characteristic === commandCharacteristic, wantsLibrary, libraryStarted else { return }
        guard error == nil else {
            failed("Could not receive a Flipper command.")
            return
        }
        guard let data = characteristic.value, let op = data.first,
              data.count == (op == 0x43 ? 6 : 5) else { return }
        onCommand?(data)
    }

    func peripheral(_ item: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard item === peripheral, characteristic === stateCharacteristic, let sent = currentWrite else { return }
        watchdog?.cancel()
        currentWrite = nil
        if let error {
            sent.result?.resume(throwing: error)
            failed("Could not send media data to the Flipper.")
        } else {
            sent.result?.resume()
            pump()
        }
    }

    func peripheral(_ item: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
        if item === peripheral, invalidatedServices.contains(where: { $0.uuid == Self.media || $0.uuid == Self.serial }) {
            failed("Flipper media service restarted.")
        }
    }
}
