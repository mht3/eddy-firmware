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

    func openSetup(_ url: URL) {
        guard url.scheme == "eddyspotify", url.host == "setup",
              url.path.isEmpty || url.path == "/",
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let ids = query.filter { $0.name == "client_id" }
        guard ids.count == 1, let id = try? SpotifyOAuth.clientID(ids[0].value ?? "") else { return }
        clientID = id

    }
}

@main
@MainActor
struct EddySpotifyApp: App {
    @StateObject private var phone = EddyPhone()
    var body: some Scene {
        WindowGroup {
            ConnectionView(phone: phone, account: phone.account, flipper: phone.flipper)
                .onOpenURL { url in
                    if !phone.account.handleSpotifyCallback(url) { phone.openSetup(url) }
                }
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
    @State private var didLaunch = false
    @State private var pairedDuringSetup = false
    @Environment(\.scenePhase) private var phase

    private var paired: Bool { pairedDuringSetup || flipper.connectedID != nil }
    private var availableStep: Int { paired ? (account.isSignedIn ? 4 : 2) : 1 }
    private var selection: Binding<Int> {
        Binding(get: { step }, set: { step = min($0, availableStep) })
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
        .onChange(of: phase) { _, value in
            if value == .active && (onboarded || step == 1) { flipper.refreshDevices() }
        }
        .onChange(of: account.accountKey) { _, _ in
            phone.accountChanged()
            if account.isSignedIn && step == 2 { withAnimation { step = 3 } }
        }
        .onChange(of: flipper.connectedID) { _, device in
            if device != nil { pairedDuringSetup = true; chooser = false }
        }
        .onChange(of: phone.clientID) { _, id in
            if onboarded && !account.isSignedIn && (try? SpotifyOAuth.clientID(id)) != nil { accountSheet = true }
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
            TabView(selection: selection) {
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
                panel("Analytics", symbol: "hand.raised.fill") {
                    Text("Eddy collects no usage analytics. Your Spotify credentials stay in your iPhone’s Keychain. Spotify receives your library and playback requests.")
                }.tag(3)
                panel("You’re all set!", symbol: "checkmark.circle") {
                    Text("Open Apps → Spotify on your Flipper. Pick a playlist or see what’s playing.")
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
            Button(step == 4 ? "View devices" : "Continue") {
                if step == 4 { onboarded = true; flipper.refreshDevices() }
                else { withAnimation { step += 1 } }
            }
            .disabled(step < 4 && step >= availableStep)
            .buttonStyle(.borderedProminent).controlSize(.large)
            .padding(.vertical, 12)
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
                Text("Scan the QR in Apps → Spotify with your iPhone camera and tap Open Eddy, or paste your Client ID below.")
            }
            TextField("Spotify Client ID", text: $phone.clientID)
                .textFieldStyle(.roundedBorder).autocorrectionDisabled()
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
            DisclosureGroup("Spotify app settings") {
                Text("To sign in inside Spotify, add eddyspotify://spotify-login as a redirect URI and enable iOS for this bundle ID in your Spotify developer app.")
                Text(Bundle.main.bundleIdentifier ?? "dev.eddyfirmware.spotify").font(.footnote.monospaced()).textSelection(.enabled)
                Text("Already registered the Eddy website redirect? Use browser sign-in once, then return here for Bluetooth.")
            }
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
                    Button { accountSheet = true } label: {
                        LabeledContent("Spotify", value: account.isSignedIn ? "Linked" : "Log in")
                    }
                }
            }
            .navigationTitle("Devices")
        }
    }
}
