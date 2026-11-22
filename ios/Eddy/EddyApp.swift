import SwiftUI

@MainActor
final class EddyPhone: ObservableObject {
    let account = SpotifyAccount()
    let flipper = FlipperConnection()
    @Published var clientID = ""
    private var bridge: LibraryBridge?
    private var activeAccount: String?

    init() {
        clientID = account.clientID
        Diagnostics.removeLegacyCounts()
        flipper.onConnect = { [weak self] in self?.attachLibrary() }
        flipper.onCommand = { [weak self] packet in self?.bridge?.receive(packet) }
        flipper.onDisconnect = { [weak self] in self?.clearLibrary() }
    }

    private func clearLibrary() {
        bridge?.stop()
        bridge = nil
    }

    private func attachLibrary() {
        clearLibrary()
        guard let key = account.accountKey else { return }
        let api = SpotifyLibrary { [account] force in
            do { return try await account.accessToken(forceRefresh: force) }
            catch let error as SpotifyAccountError {
                throw LibraryFailure(rawValue: UInt8(clamping: error.deviceCode)) ?? .offline
            }
        }
        let next = LibraryBridge(api: api)
        next.start(accountKey: key) { [flipper] data in try await flipper.write(data) }
        bridge = next
    }

    func accountChanged() {
        guard activeAccount != account.accountKey else { return }
        if activeAccount != nil { flipper.setLibraryEnabled(false) }
        activeAccount = account.accountKey
        clearLibrary()
        flipper.setLibraryEnabled(activeAccount != nil)
    }
}

@main
@MainActor
struct EddyApp: App {
    @StateObject private var phone = EddyPhone()
    var body: some Scene {
        WindowGroup {
            ConnectionView(phone: phone, account: phone.account, flipper: phone.flipper)
        }
    }
}

private let ocean = Color(red: 0.035, green: 0.10, blue: 0.17)
private let surf = Color(red: 0.58, green: 0.81, blue: 1)

@MainActor
private struct ConnectionView: View {
    @ObservedObject var phone: EddyPhone
    @ObservedObject var account: SpotifyAccount
    @ObservedObject var flipper: FlipperConnection
    @AppStorage("eddy.onboarded") private var onboarded = false
    @State private var step = 0
    @State private var chooser = false
    @State private var accountSheet = false
    @State private var diagnosticsSheet = false
    @State private var didLaunch = false
    @FocusState private var editingClientID: Bool
    @Environment(\.scenePhase) private var phase

    private var nextLabel: String {
        if step == 4 { return "View devices" }
        if (step == 1 && flipper.connectedID == nil) || (step == 2 && !account.isSignedIn) {
            return "Set up later"
        }
        return "Continue"
    }

    var body: some View {
        Group {
            if onboarded { devicesPage } else { welcomeFlow }
        }
        .tint(surf)
        .preferredColorScheme(.dark)
        .onAppear {
            guard !didLaunch else { return }
            didLaunch = true
            phone.accountChanged()
            if flipper.selectedID != nil { flipper.reconnect() }
            if onboarded { flipper.refreshDevices() }
        }
        .onChange(of: step) { _, _ in editingClientID = false }
        .onChange(of: phase) { _, value in
            if value == .active && (onboarded || step == 1) { flipper.refreshDevices() }
        }
        .onChange(of: account.accountKey) { _, _ in
            phone.accountChanged()
            if account.isSignedIn && step == 2 { withAnimation { step = 3 } }
        }
        .onChange(of: flipper.connectedID) { _, device in
            if device != nil { chooser = false }
        }
        .onOpenURL { url in
            if account.handleSpotifyCallback(url) { return }
            if url.scheme == "eddyspotify", url.host == "setup", onboarded, !account.isSignedIn {
                accountSheet = true
            }
        }
        .sheet(isPresented: $diagnosticsSheet) {
            NavigationStack {
                DiagnosticsView()
                    .toolbar { Button("Done") { diagnosticsSheet = false } }
            }
        }
        .sheet(isPresented: $chooser, onDismiss: { flipper.stopScanning() }) { deviceChooser }
        .sheet(isPresented: $accountSheet) {
            NavigationStack {
                Form { spotifyControls }
                    .navigationTitle("Spotify account")
                    .toolbar { Button("Done") { accountSheet = false } }
            }.preferredColorScheme(.dark)
        }
    }

    private var welcomeFlow: some View {
        VStack(spacing: 12) {
            TabView(selection: $step) {
                panel("Welcome to Eddy!", symbol: nil) {
                    Text("Connect your Flipper Zero and bring your Spotify library to its screen.")
                }.tag(0)
                panel("Connect your device", symbol: "antenna.radiowaves.left.and.right") {
                    Text("Turn on Bluetooth on your Flipper running Eddy firmware.")
                    if let name = flipper.connectedName {
                        Label(name, systemImage: "checkmark.circle.fill")
                    } else {
                        Button("Connect device") { openChooser() }.buttonStyle(.borderedProminent)
                    }
                }.tag(1)
                panel("Log in to Spotify", symbol: "music.note.list") { spotifyControls }.tag(2)
                panel("Optional diagnostics", symbol: "hand.raised.fill") {
                    DiagnosticsPreferences()
                }.tag(3)
                panel("You’re all set!", symbol: "checkmark.circle") {
                    if flipper.connectedID != nil && account.isSignedIn {
                        Text("Open Apps → Spotify on your Flipper to browse your playlists.")
                    } else {
                        Text("You can finish setting up your Flipper and Spotify in Devices.")
                    }
                }.tag(4)
            }
            #if os(iOS)
            .tabViewStyle(.page(indexDisplayMode: .never))
            #endif
            HStack(spacing: 7) {
                ForEach(0..<5) { index in
                    Capsule().fill(index == step ? surf : .white.opacity(0.3))
                        .frame(width: index == step ? 22 : 7, height: 7)
                }
            }.accessibilityElement(children: .ignore).accessibilityLabel("Step \(step + 1) of 5")
            Button(nextLabel) {
                if step == 4 { onboarded = true; flipper.refreshDevices() }
                else { withAnimation { step += 1 } }
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .padding(.vertical, 4)
            Button("Diagnostics") { diagnosticsSheet = true }
                .font(.footnote).padding(.bottom, 6)
        }
        .background(ocean.ignoresSafeArea())
    }

    private func panel<Content: View>(_ title: String, symbol: String?, @ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                if let symbol {
                    Image(systemName: symbol).font(.system(size: 58, weight: .light)).foregroundStyle(surf)
                        .frame(height: 100).accessibilityHidden(true)
                } else {
                    Image("EddyMark").resizable().scaledToFit().frame(height: 100).accessibilityHidden(true)
                }
                Text(title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                content()
            }
            .frame(maxWidth: 420)
            .padding(.horizontal, 26)
            .padding(.vertical, 48)
            .frame(maxWidth: .infinity)
        }
        .multilineTextAlignment(.center)
    }

    @ViewBuilder private var spotifyControls: some View {
        if account.isSignedIn {
            Label("Spotify linked", systemImage: "checkmark.circle.fill")
            if onboarded {
                Link("Open Spotify", destination: URL(string: "https://open.spotify.com/")!)
                Button("Sign out", role: .destructive) { account.signOut() }
            }
        } else {
            if (try? SpotifyOAuth.clientID(phone.clientID)) == nil {
                Text("Copy your Client ID from your Spotify developer app and paste it here.")
            }
            TextField("Spotify Client ID", text: $phone.clientID)
                .textFieldStyle(.roundedBorder).autocorrectionDisabled()
                .focused($editingClientID)
                .submitLabel(.done)
                .onSubmit { editingClientID = false }
                #if os(iOS)
                .textInputAutocapitalization(.never).keyboardType(.asciiCapable)
                #endif
            Button(account.isSigningIn ? "Signing in…" : "Log in to Spotify") {
                Task { await account.signIn(clientID: phone.clientID) }
            }
            .disabled(account.isSigningIn || (try? SpotifyOAuth.clientID(phone.clientID)) == nil)
            .buttonStyle(.borderedProminent)
            Button("Use browser for sign-in") {
                Task { await account.signIn(clientID: phone.clientID, preferSpotifyApp: false) }
            }
            .disabled((account.isSigningIn && !account.waitingForSpotifyApp) || (try? SpotifyOAuth.clientID(phone.clientID)) == nil)
        }
        if !account.status.isEmpty { Text(account.status).font(.footnote).foregroundStyle(.secondary) }
    }

    private func openChooser() { flipper.scan(); chooser = true }

    private var deviceChooser: some View {
        NavigationStack {
            List {
                Text(flipper.status).foregroundStyle(.secondary)
                ForEach(flipper.devices) { device in
                    Button { flipper.select(device.id) } label: {
                        Label(device.name, systemImage: "dot.radiowaves.left.and.right")
                    }
                }
            }
            .navigationTitle("Connect device")
            .toolbar { Button("Done") { chooser = false } }
        }
        .preferredColorScheme(.dark)
    }

    private var devicesPage: some View {
        NavigationStack {
            List {
                Section {
                    let known = flipper.savedDevices + flipper.devices.filter { nearby in
                        flipper.systemConnectedIDs.contains(nearby.id) && !flipper.savedDevices.contains { $0.id == nearby.id }
                    }
                    if known.isEmpty { Text("Connect your Flipper to see it here.").foregroundStyle(.secondary) }
                    ForEach(known) { device in
                        let active = flipper.connectedID == device.id
                        HStack {
                            Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(surf)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(device.name)
                                Text(active ? (account.isSignedIn ? "Connected · Spotify linked" : "Connected") :
                                     flipper.systemConnectedIDs.contains(device.id) ? "Connected to iPhone" : "Saved")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if active {
                                Button("Disconnect") { flipper.disconnect() }
                            } else {
                                Button("Connect") { flipper.select(device.id) }
                            }
                        }.buttonStyle(.borderless)
                        .swipeActions {
                            Button("Forget", role: .destructive) { flipper.forget(device.id) }
                        }
                    }
                    Button { openChooser() } label: { Label("Connect device", systemImage: "plus") }
                }
                Section {
                    NavigationLink("Diagnostics") { DiagnosticsView() }
                    Button { accountSheet = true } label: {
                        LabeledContent("Spotify", value: account.isSignedIn ? "Linked" : "Log in")
                    }
                    Link(destination: URL(string: "https://ko-fi.com/mhtaylor")!) {
                        Label("Buy me a Coffee", systemImage: "cup.and.saucer")
                    }
                }
            }
            .navigationTitle("Devices")
        }
    }
}
