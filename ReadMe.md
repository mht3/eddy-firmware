<img src="website/eddy.svg" width="64" height="64" alt="Eddy ocean current">

# Eddy Firmware

Eddy is an independent firmware fork for Flipper Zero. The home screen shows Eddy the dolphin and the battery percentage. Press **OK** for Apps, Settings, and Power. Press **Up** for brightness and volume. Left and Right choose a control, Up and Down adjust its level, and the Settings tile opens device settings.

**Apps** opens a grid with Sub-GHz, RFID, NFC, Infrared, GPIO, iButton, and Pomodoro Timer. Sub-GHz measures received power at 433.92 MHz. RFID, NFC, and iButton identify a tag or key type. Pomodoro runs a 25-minute focus session followed by a five-minute break. OK starts or pauses the timer. It keeps time when you leave and signals transitions while open.

**To save a TV remote**, open Infrared → Learn a remote. Capture a button, choose Save, and name the remote and its button. Saved remotes appear under My remotes. Choose **Pin to Home** inside a remote to put its name on the desktop. Press **Down** there to open the remote, then choose a button to send. One remote can be pinned at a time. With no pin, Down opens Apps. Under Infrared, **Button tester** lets you check whether a remote is emitting infrared.

**To turn off the Flipper**, hold Back on the home screen, then press Right to confirm. You can also choose Power from the launcher.

Eddy started from Next-Flip’s Momentum Firmware at commit `d3f89dfe`. Momentum builds on Flipper Devices’ firmware and work from Unleashed and Xtreme. Thank you to those maintainers, artists, and contributors. The repository retains their history, copyright notices and license files. [Momentum source at the fork point](https://github.com/Next-Flip/Momentum-Firmware/tree/d3f89dfe2ef6b01839201598e9be1590cba80322) · [Firmware license](LICENSE)

The project logo shows an ocean eddy from above. The home-screen animation adapts the inherited Flipper dolphin artwork in `assets/icons/Dolphin/DolphinDone_80x58.png`.

![Eddy the dolphin surfacing in an ocean eddy](.github/assets/eddy-ocean.gif)

## Build and install

From the root of this checkout on macOS or Linux, fetch the pinned dependencies and build the F7 update.

```sh
git submodule update --init --jobs 8 -- assets/protobuf lib
FBT_NO_SYNC=1 ./fbt updater_package
```

FBT downloads the Flipper toolchain on its first run. The update archive appears under `dist/f7-C/flipper-z-f7-update-eddy-*.tgz`. The main build selects its applications explicitly. The inherited third-party app collection is optional source and is outside the main package.

Use qFlipper’s **Install from file** with the TGZ, or connect the powered-on device with its microSD card installed, close qFlipper, and use the build tool.

```sh
FBT_NO_SYNC=1 ./fbt flash_usb_full
```

Keep the device connected through the restart. Open **Quick Settings → Settings → About** to check the firmware version. Some inherited SDK symbols, app filenames and saved preferences retain their historical identifiers for compatibility.

## Website and main build

The launch page, one-page wiki and USB updater are in `website/`. To preview the site with the local package, run these commands after building the current revision.

```sh
python3 scripts/eddy_site.py
python3 -m http.server --bind 127.0.0.1 --directory dist/eddy-site 8000
```

Open `http://127.0.0.1:8000/update/` in desktop Chrome or Edge. The Eddy updater uses Web Serial on localhost or HTTPS. It verifies the downloaded components, copies them to the microSD card, and asks the Flipper to verify the package and restart. The same page offers the full TGZ for qFlipper.

### Publish on GitHub Pages

The [Eddy website](https://mht3.github.io/eddy-fw/) and [USB updater](https://mht3.github.io/eddy-fw/update/) use free GitHub Pages hosting. The website source lives in this firmware repository. Pages serves the generated site from the root of the `main` branch in the separate [website repository](https://github.com/mht3/eddy-fw).

To publish a new release, build the desired firmware commit and stage the matching website using the commands above. Copy the contents of `dist/eddy-site/` into a checkout of `mht3/eddy-fw`, remove any superseded firmware bundles from that checkout, and push the changes to `main`. Keep its `.nojekyll` file. GitHub Actions also provides the full staged site as the `eddy-website` artifact when the firmware build workflow runs.

Building from a public, committed revision keeps the matching source available with each binary. The project's distribution license and source notices are part of the checkout. Bundled third-party components retain their respective terms.
