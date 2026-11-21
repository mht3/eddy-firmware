# Eddy applications

The main build has ten Apps tiles. Their implementations live in these directories.

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

[The Eddy build profile](../fbt_options.py) selects the apps to package. [The launcher](services/loader/loader_menu.c) defines their order and displays pinned infrared remotes after the built-in tiles.

Device settings live in [settings](settings/), background services in [services](services/), and the firmware updater in [system/updater](system/updater/). The repository also includes development tools, tests, and sources for other build profiles.
