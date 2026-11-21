#pragma once

/** TX Allowed or Blocked Reasons */
typedef enum {
    SubGhzTxAllowed, /**< TX is allowed with this configuration */
    SubGhzTxBlockedRegionNotProvisioned, /**< Region not provisioned */
    SubGhzTxBlockedRegion, /**< Outside provisioned region */
    SubGhzTxBlockedDefault, /**< Outside supported frequency bands */
    SubGhzTxUnsupported, /**< No configuration would allow this */
} SubGhzTx;
