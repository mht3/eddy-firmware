<img src="website/eddy.svg" width="64" height="64" alt="Eddy ocean current">

# Eddy Firmware

Eddy is a new firmware for Flipper Zero! Eddy started from Next-Flip’s Momentum Firmware and has grown to a standalone, sleek firmware, free for anyone to use! Thank you to those maintainers, artists, and contributors. The repository retains their history, copyright notices and license files. [Momentum source at the fork point](https://github.com/Next-Flip/Momentum-Firmware/tree/d3f89dfe2ef6b01839201598e9be1590cba80322) · [Firmware license](LICENSE)

![Eddy the dolphin surfacing in an ocean eddy](.github/assets/eddy-ocean.gif)

## Get Eddy

[Install the main build](https://mht3.github.io/eddy-firmware/update/) · [Try the home screen](https://mht3.github.io/eddy-firmware/#home-screen) · [Read the wiki](https://mht3.github.io/eddy-firmware/wiki/)

Pair your phone with your Flipper once in Bluetooth settings. Spotify uses the same connection after a power cycle. [Bluetooth pairing guide](https://mht3.github.io/eddy-firmware/bluetooth/)

Open **Apps → Spotify** on the Flipper. Scan its first-run QR code to open Spotify on your phone, press **OK** on the Flipper to dismiss the code, and play a song. **Left / Right** skip tracks and **OK** plays or pauses. Press **Up** to see the QR code again. On iPhone, the current song, artist and playback time appear on the Flipper through Apple Media Service. Android phones with Bluetooth media controls support the three playback buttons. [Spotify guide and screen captures](https://mht3.github.io/eddy-firmware/spotify/) · [Apple Media Service reference](https://developer.apple.com/library/archive/documentation/CoreBluetooth/Reference/AppleMediaService_Reference/Introduction/Introduction.html)

Other apps include Sub-GHz, RFID, NFC, Infrared, GPIO, iButton, Pomodoro Timer, Metronome, Remote Builder, and Bluetooth Remote. In Infrared, choose **Learn a remote** to save your own buttons. Saved remotes appear under **My remotes**.

**Infrared → TV presets** opens ready-to-use controls for Samsung TV, LG TV, TCL RC3000E02, and TCL Roku 32S327. Select your TV, point the Flipper at it, and try **Vol −** with **OK**. On Roku, select **D-pad** to use the arrows and OK directly. **Back** returns to the remote. Other TV models may use different codes.

**Remote Builder** lets you name a remote, pick a position on its six-button grid, and teach it a button from an infrared remote. Hold **OK → Add to Apps** to open that layout directly from the launcher.

**Bluetooth Remote** has Camera, Slides, and Media modes. Open the app and pair the name shown at the bottom of the screen in your iPhone or Mac Bluetooth settings. The status line shows the current peer address. Hold **OK** on the mode list to give that connection a name. In Camera, open the iPhone Camera app and press **OK** for the shutter. In Slides, start a presentation on the Mac and press **Left / Right**. In Media, use **OK** for play/pause and **Left / Right** for tracks.

<details>
<summary>Build and install from source</summary>


From the root of this checkout on macOS or Linux, fetch the pinned dependencies and build the F7 update.

```sh
git submodule update --init --jobs 8 -- assets/protobuf lib
FBT_NO_SYNC=1 ./fbt updater_package
```

FBT downloads the Flipper toolchain on its first run. The update archive appears under `dist/f7-C/flipper-z-f7-update-eddy-*.tgz`. The main build selects its applications explicitly. The website lets you choose which of the eleven app binaries to install.

Use qFlipper’s **Install from file** with the TGZ, or connect the powered-on device with its microSD card installed, close qFlipper, and use the build tool.

```sh
FBT_NO_SYNC=1 ./fbt flash_usb_full
```

Keep the device connected through the restart. Open **Quick Settings → Settings → About** to check the firmware version. Some inherited SDK symbols, app filenames and saved preferences retain their historical identifiers for compatibility.

</details>

<details>
<summary>Run the website and updater locally</summary>


The launch page, one-page wiki and USB updater are in `website/`. To preview the site with the local package, run these commands after building the current revision.

```sh
python3 scripts/eddy_site.py
python3 -m http.server --bind 127.0.0.1 --directory dist/eddy-site 8000
```

Open `http://127.0.0.1:8000/update/` in desktop Chrome or Edge. The Eddy updater uses Web Serial on localhost or HTTPS. It verifies the downloaded components, copies them to the microSD card, and asks the Flipper to verify the package and restart. The same page offers your selected apps as a TGZ for qFlipper.

The public updater and its firmware are hosted on GitHub Pages. Each published build links back to its source revision.

</details>

Bundled third-party components retain their respective licenses and notices.
