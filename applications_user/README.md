# Community utilities

Eddy offers these community apps as optional downloads in the installer. Both run on a stock Flipper Zero. The release workflow builds them against the same SDK as the firmware. To rebuild the packages and their SHA-256 catalog locally, run `python3 scripts/build_community_apps.py` from an initialized firmware checkout.

| Utility | Author | Pinned source | Catalog |
| --- | --- | --- | --- |
| Calendar 1.1 | TechArtDev | [techartdev/Calendar, 3f29994](https://github.com/techartdev/Calendar/tree/3f29994837002986dbf9afc117338d5ee633c1ee) | [Flipper Lab](https://lab.flipper.net/apps/techart_calendar) · [Catalog manifest](https://github.com/flipperdevices/flipper-application-catalog/tree/main/applications/Tools/techart_calendar) |
| Resistance calculator 1.4 | Lewis Westbury | [Catalog source snapshot, 1066d17](https://github.com/xMasterX/all-the-plugins/tree/1066d17ad1e8fbf75cea5c6612d79ba539ec8a33/apps_source_code/resistors) | [Flipper Lab](https://lab.flipper.net/apps/resistors) · [Catalog manifest](https://github.com/flipperdevices/flipper-application-catalog/tree/main/applications/Tools/resistors) |

Each source directory includes its original MIT license. The installer distributes a copy alongside the app. Eddy keeps the catalog app IDs and graphics. Its Calendar build redraws on button releases and removes the viewport before freeing its input queue. Its Resistance calculator build closes the GUI record on exit.
