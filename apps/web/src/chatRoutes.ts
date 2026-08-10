const THREAD_PREFIX = "thread_";

export function threadIdToRouteSegment(threadId: string) {
  if (threadId.startsWith(THREAD_PREFIX)) {
    return threadId.slice(THREAD_PREFIX.length);
  }
  return threadId.trim();
}

export function routeSegmentToThreadCandidates(segment?: string) {
  if (!segment) return [];
  const normalized = segment.trim();
  if (!normalized) return [];
  if (normalized.startsWith(THREAD_PREFIX)) {
    const raw = normalized.slice(THREAD_PREFIX.length);
    return [normalized, raw];
  }
  return [`${THREAD_PREFIX}${normalized}`, normalized];
}

export function chatPathForThread(threadId?: string) {
  if (!threadId || threadId.startsWith("draft_")) return "/new";
  return `/chat/${encodeURIComponent(threadIdToRouteSegment(threadId))}`;
}
