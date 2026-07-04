export default defineBackground({
  main() {
    // Let clicking the toolbar icon open the side panel (Chrome). On Firefox the
    // sidebar toggles via the browser action automatically. `sidePanel` is typed
    // as always-present by WXT's merged browser types (it's Chrome-only at
    // runtime), so this is guarded with optional chaining rather than a
    // `@ts-expect-error` (which would be an unused-directive error here).
    browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  },
});
