import Bugsnag from '@bugsnag/react-native';

// Start the Bugsnag JS client only if native side initialized it.
try {
  if (Bugsnag.isStarted()) {
    // Already started by native layer — nothing to do
  } else {
    // Native layer did not start Bugsnag (no valid API key) — skip JS init
    console.log('[Bugsnag] Skipped — not started by native layer');
  }
} catch (e) {
  console.log('[Bugsnag] Initialization skipped:', e.message);
}
