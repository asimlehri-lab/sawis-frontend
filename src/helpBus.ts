// Lets any screen open the Help window on a given topic without passing
// props through the whole tree. App.tsx listens for this event.
export const OPEN_HELP_EVENT = "sawis:open-help";

export function openHelp(topicId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT, { detail: { topicId } }));
}
