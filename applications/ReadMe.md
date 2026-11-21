# Eddy applications

The installer includes nine apps by default. Use **Add to build** for Spotify, Pomodoro Timer, or Metronome. Open **Arrange my Apps menu** and drag a selected app onto another to swap their positions, including across pages. The emulator, USB installer and qFlipper download use your layout.

| Apps tile | Source |
| --- | --- |
| Sub-GHz | [eddy_signal](main/eddy_signal/) |
| RFID | [eddy_rfid](main/eddy_readers/eddy_rfid.c) |
| NFC | [eddy_nfc](main/eddy_readers/eddy_nfc.c) |
| Infrared | [infrared](main/infrared/) |
| GPIO | [gpio](main/gpio/) |
| iButton | [eddy_ibutton](main/eddy_readers/eddy_ibutton.c) |
| Pomodoro Timer | [eddy_pomodoro](main/eddy_pomodoro/) |
| Metronome | [eddy_metronome](main/eddy_metronome/) |
| Remote Builder | [eddy_remote_builder](main/eddy_remote_builder/) |
| Bluetooth Remote | [eddy_bluetooth](main/eddy_bluetooth/) |
| Music | [eddy_music](main/eddy_music/) |
| Spotify | [eddy_spotify](main/eddy_spotify/) |

[The Eddy build profile](../fbt_options.py) selects the apps to package. In the default layout, Music, Remote Builder, and Bluetooth Remote share the bottom row of the first page. GPIO, iButton, and NFC appear on page two. [The launcher](services/loader/loader_menu.c) places saved remote shortcuts after your apps.

Device settings live in [settings](settings/), background services in [services](services/), and the firmware updater in [system/updater](system/updater/). The repository also includes development tools, tests, and sources for other build profiles.
