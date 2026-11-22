import { bindingDescriptor, listRegistryShortcuts, resolveShortcutBindings, type ShortcutRegistry } from "../../shortcuts/core";
import type { PageKeyClaim } from "./linkGuard";

/**
 * The chords a surface serves before an HTML page's own scripts (HtmlViewer's
 * `forwardPageKeys`): each Cmd chord its shortcuts bind (`Mod`, never `Ctrl`),
 * once, as `bindingDescriptor` describes it. A binding plain data cannot match
 * exactly is left out, so its key reaches the page first, and the host after
 * if the page did not use it. (Kept out of linkGuard.ts, which is vendored
 * dependency-free.)
 */
export function pageKeyClaims(registry: ShortcutRegistry): PageKeyClaim[] {
  const claims = new Map<string, PageKeyClaim>();
  for (const entry of listRegistryShortcuts(registry)) {
    for (const binding of resolveShortcutBindings(entry)) {
      const chord = bindingDescriptor(binding);
      if (!chord || !chord.mod || chord.ctrl) continue;
      claims.set(`${chord.key}:${chord.shift}:${chord.alt}`, { key: chord.key, shift: chord.shift, alt: chord.alt });
    }
  }
  return [...claims.values()];
}
