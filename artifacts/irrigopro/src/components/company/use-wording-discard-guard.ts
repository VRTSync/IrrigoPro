import { useEffect } from "react";

// Wouter handles same-page links and observes popstate. Guard before those
// handlers run; beforeunload covers reload, closing the tab, and full navigation.
export function useWordingDiscardGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const url = location.href;
    const priorState = history.state;
    const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation;
    const index = navigation?.currentEntry?.index;
    let restoring = false;

    function unload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = message;
    }
    function followLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const destination = new URL(link.href);
      if (destination.origin !== location.origin || destination.pathname === location.pathname) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function traverse(event: PopStateEvent) {
      if (restoring && location.href === url) {
        restoring = false;
        return;
      }
      if (location.pathname === new URL(url).pathname || window.confirm(message)) return;
      event.stopImmediatePropagation();
      const destinationIndex = navigation?.currentEntry?.index;
      if (index !== undefined && destinationIndex !== undefined && index !== destinationIndex && destinationIndex >= 0) {
        restoring = true;
        history.go(index - destinationIndex);
      } else {
        history.pushState(priorState, "", url);
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", followLink, true);
    window.addEventListener("popstate", traverse, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("popstate", traverse, true);
    };
  }, [dirty, message]);
}
