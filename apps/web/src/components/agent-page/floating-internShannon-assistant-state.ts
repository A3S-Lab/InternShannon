export const INTERNSHANNON_ASSISTANT_OPEN_EVENT = "internshannon:assistant:open";
export const INTERNSHANNON_ASSISTANT_QUERY_PARAM = "internShannon";
export const INTERNSHANNON_ASSISTANT_QUERY_VALUE = "open";

export function buildInternShannonAssistantUrl(baseUrl = "/admin") {
  const hashIndex = baseUrl.indexOf("#");
  const pathAndSearch = hashIndex >= 0 ? baseUrl.slice(0, hashIndex) : baseUrl;
  const hash = hashIndex >= 0 ? baseUrl.slice(hashIndex + 1) : "";
  const queryIndex = pathAndSearch.indexOf("?");
  const path = queryIndex >= 0 ? pathAndSearch.slice(0, queryIndex) : pathAndSearch;
  const params = new URLSearchParams(queryIndex >= 0 ? pathAndSearch.slice(queryIndex + 1) : "");
  params.delete(INTERNSHANNON_ASSISTANT_QUERY_PARAM);
  params.set(INTERNSHANNON_ASSISTANT_QUERY_PARAM, INTERNSHANNON_ASSISTANT_QUERY_VALUE);
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

export function openInternShannonAssistant() {
  window.dispatchEvent(new Event(INTERNSHANNON_ASSISTANT_OPEN_EVENT));
}
