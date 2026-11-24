// The rule for volume changes asked from the page: one step at a time, and
// never past the limits the owner set (VOLUME_MIN and VOLUME_MAX).

export const STEP = 10;

/**
 * Where a press on "down" or "up" takes the volume, or null when it may not
 * move that way. The owner can set any volume from Spotify itself: from above
 * the ceiling the page only brings it down, from under the floor only up.
 */
export function nextVolume(percent, direction, cfg) {
  if (direction === 'up') {
    return percent < cfg.volumeMax ? Math.min(cfg.volumeMax, percent + STEP) : null;
  }
  return percent > cfg.volumeMin ? Math.max(cfg.volumeMin, percent - STEP) : null;
}
