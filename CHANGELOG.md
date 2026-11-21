# Eddy Firmware changes

- The installer opens with nine apps selected. You can add Pomodoro Timer and Metronome, swap app positions across pages, and try your layout before installing it.
- The first Apps page groups Spotify, Remote Builder, and Bluetooth Remote along the bottom. In Spotify, tap Up or Down for phone volume and hold Up for the setup QR. The playable demo features Low Tide, High Tide, and Dolphin Days.
- The installer lets you choose apps, try each one in the emulator, and install the same selection over USB or through qFlipper.
- Apps → Spotify adds a first-run QR, playback controls over the Flipper’s existing phone pairing and an iPhone track display. The website includes handheld screen captures and a playable demo.
- Sub-GHz remains a receive-only signal meter. The radio drivers enforce the factory region, and the protocol library rejects saving and transmitting decoded dynamic codes. A microSD card can no longer override these limits.
- A configured PIN applies on boot and on lock. Unlock the handheld before using USB or Bluetooth RPC. SDK 88 removes obsolete radio APIs. Third-party native apps built for the previous major SDK need a compatible rebuild.

- The home screen opens Apps, Settings, and Power off. Quick Settings controls brightness and volume.
- Remote Builder saves six-button infrared layouts with custom labels and positions. Bluetooth Remote adds camera shutter, slide navigation, and media controls.
- The other eight Apps tiles include Sub-GHz, RFID, NFC, Infrared, GPIO, iButton, Pomodoro Timer, and Metronome. Saved infrared remotes can be pinned to Apps.
- Infrared includes four built-in TV presets, with a six-button layout and a navigation pad for TCL Roku. A fresh install starts with an empty personal remote library. The main build omits the unused universal-remote databases.
- The website includes an interactive preview and a USB updater for the main firmware build.

Changes and contributor credits before Eddy are in the [Momentum changelog at the fork point](https://github.com/Next-Flip/Momentum-Firmware/blob/d3f89dfe2ef6b01839201598e9be1590cba80322/CHANGELOG.md).
