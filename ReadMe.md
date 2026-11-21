<img src="website/eddy.svg" width="64" height="64" alt="Eddy ocean current">

# Eddy Firmware

Eddy is an independent firmware fork for Flipper Zero. The main build includes an ocean desktop with Eddy the dolphin, Eddy Settings, the file browser, Infrared, GPIO, U2F, a receive-only Signal Meter at 433.92 MHz, and the USB updater.

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

Keep the device connected through the restart. Open **Settings → About** to check the firmware version. From the main menu, **Signal Meter** samples received power and **Eddy Settings** changes the interface. Some inherited SDK symbols, app filenames and saved preferences retain their historical identifiers for compatibility.

## Website and main build

The launch page, one-page wiki and USB updater are in `website/`. To preview the site with the local package, run these commands after building the current revision.

```sh
python3 scripts/eddy_site.py
python3 -m http.server --bind 127.0.0.1 --directory dist/eddy-site 8000
```

Open `http://127.0.0.1:8000/update/` in desktop Chrome or Edge. The Eddy updater uses Web Serial on localhost or HTTPS. It verifies the downloaded components, copies them to the microSD card, and asks the Flipper to verify the package and restart. The same page offers the full TGZ for qFlipper.

### Publish eddy-fw.dev

1. Push this checkout to the Eddy GitHub fork. Enable Issues for the bug-report link and GitHub Actions for builds.
2. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Add `eddy-fw.dev` as the custom domain and configure the apex domain with your DNS provider. Enable HTTPS when GitHub issues the certificate. [GitHub custom domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
3. Run **Actions → Build Eddy → Run workflow** on the desired mainline revision, or push an Eddy release tag such as `eddy-0.1.0`. The workflow builds one F7 package, stages it with the matching site, and deploys both to Pages. Normal branch builds and pull requests produce downloadable CI artifacts.
4. Visit `https://eddy-fw.dev/update/` in desktop Chrome or Edge. Choose **Connect Flipper Zero**, select your device, then choose **Install** once the updater identifies the F7 and its microSD card. The page also links to the source revision, qFlipper download and Flipper Lab.

Building from a public, committed revision keeps the matching source available with each binary. The project's distribution license and source notices are part of the checkout. Bundled third-party components retain their respective terms.
