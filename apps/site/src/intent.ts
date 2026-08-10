const GREETING_RE = /^(hi|hey|hello|yo|sup|good\s+(morning|afternoon|evening))[\s!.?]*$/i;
const CORRECTION_RE = /\b(i did not|i didn't|didnt|don't|do not|not ask|without code|no code|just talk|explain only|discuss first|why (the )?(fuck )?would you (send|paste).{0,40}code|why would you (send|paste).{0,40}code|stop (sending|pasting).{0,40}code|you are the coder)\b/i;
const FORMATTING_RE = /\b(write|put|make|change|format|display|show|convert|rewrite|rephrase|reformat)\b.{0,60}\b(in a |as a |into a |as |in |into )?(table|list|bullet|numbered|markdown|format|summary|paragraph|csv|json|shorter|longer|simpler|different)\b/i;
const EXPLICIT_PATCH_RE = /\b(add|build|create|implement|generate|make|fix|update|delete|write|code|script|refactor|patch|change|deploy|upload|publish|release|place|move|position|put|resize|scale|rotate|anchor|unanchor)\b/i;
const WORLD_EDIT_RE = /\b(place|move|position|put|resize|scale|rotate|anchor|unanchor)\b.{0,120}\b(it|this|that|crate|part|model|object|spawn|spawnlocation|workspace|map|baseplate|stud|studs|tree|door|npc)\b|\b(it|this|that|crate|part|model|object|spawn|spawnlocation|workspace|map|baseplate|stud|studs|tree|door|npc)\b.{0,120}\b(place|move|position|put|resize|scale|rotate|anchor|unanchor|next to|beside|near)\b/i;
const GAMEPLAY_MECHANIC_RE = /\bplayers?\b.{0,120}\b(collect|sell|upgrade|unlock|earn|buy|purchase|fight|attack|shoot|sprint|dash|double\s*jump|spawn)\b|\b(coins?|currency|cash|backpack|inventory|leaderstats|sell\s*pad|shop|gate|locked\s*area|new\s*area)\b.{0,140}\b(collect|sell|upgrade|unlock|earn|buy|purchase|store|save|grant|open)\b/i;
const FOLLOW_UP_PATCH_RE = /\b(do it|do that|do this|actually do it|actually do that|actually do this|do all of it|do all|go ahead|continue|proceed|implement it|start|apply it|apply that|apply this|apply the patch|queue it|queue that|sync it|sync that|make it happen|generate it|generate that patch|make the patch|whatever you say|one more time|try again|sounds good,?\s*(do|apply|sync)|yes,?\s*(do|apply|sync)|you (?:need|have|(?:are\s+)?supposed) to (?:fucking\s+|actually\s+)?(apply|do|queue|sync|fix) (it|that|this))\b/i;
const CORRECTIVE_PATCH_RE = /\b(fix (it|that|this)|make (it|that|this) (proper|properly|better)|do (it|that|this) (proper|properly|right)|not good enough|still broken|still wrong|acting up|is broken|looks bad|properly)\b/i;
const SOFT_QUESTION_RE = /\b(why|what|how|when|where|can you explain|tell me|do you see|inspect|overview|status|summari[sz]e|analy[sz]e)\b/i;
const UI_REQUEST_RE = /\b(ui|gui|hud|interface|menu|panel|screen|button|icon|icons|visual|layout|frontend|front-end|front\s*end)\b/i;
const SHOP_RE = /\b(shop|store|purchase|purchases)\b/i;
const REBIRTH_RE = /\b(rebirth|rebirths|ascend|ascension|prestige)\b/i;
const BACKEND_RE = /\b(backend|server|remote|remotes|datastore|save|saving|persist|persistent|leaderstats|stats?|currency|coins?|cash|strength|purchase|purchases|buy|bought|transaction|gamepass|developer product|receipt|grant|reward|actually work|fully work|working purchases?|wire|wired|connect to data|hook up|functional economy)\b/i;
const UI_ONLY_PATTERNS = [
  /\b(just|only|pure|visual|frontend|front-end|front\s*end|mockup|design|layout|cosmetic)\b.{0,40}\b(ui|gui|interface|menu|screen|visuals?|frontend|front-end|front\s*end)\b/i,
  /\b(ui|gui|interface|menu|screen|visuals?|frontend|front-end|front\s*end)\b.{0,40}\b(just|only|pure|visual|mockup|design|layout|cosmetic)\b/i,
  /\b(no backend|without backend|don't add backend|do not add backend|no server|without server|no datastore|without datastore)\b/i
];
const AUTO_SYNC_RE = /\b(auto\s*sync|autosync|you need to sync|you need to auto sync|sync automatically|can't sync|cant sync|cannot sync)\b/i;

function isUiOnlyPrompt(prompt: string) {
  return UI_ONLY_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function needsUiBackendClarification(prompt: string) {
  const normalized = prompt.trim();
  if (!normalized) return false;
  return UI_REQUEST_RE.test(normalized)
    && SHOP_RE.test(normalized)
    && REBIRTH_RE.test(normalized)
    && !BACKEND_RE.test(normalized)
    && !isUiOnlyPrompt(normalized);
}

export function isAutoSyncStatusPrompt(prompt: string) {
  return AUTO_SYNC_RE.test(prompt.trim());
}

export function shouldGenerateChangeSet(prompt: string) {
  const normalized = prompt.trim();
  if (!normalized) return false;
  if (GREETING_RE.test(normalized)) return false;
  if (needsUiBackendClarification(normalized)) return false;
  if (isAutoSyncStatusPrompt(normalized)) return false;
  if (CORRECTION_RE.test(normalized) && !FOLLOW_UP_PATCH_RE.test(normalized)) return false;
  if (FORMATTING_RE.test(normalized)) return false;
  if (WORLD_EDIT_RE.test(normalized)) return true;
  if (FOLLOW_UP_PATCH_RE.test(normalized)) return true;
  if (CORRECTIVE_PATCH_RE.test(normalized)) return true;
  if (SOFT_QUESTION_RE.test(normalized) && !EXPLICIT_PATCH_RE.test(normalized)) return false;
  if (GAMEPLAY_MECHANIC_RE.test(normalized)) return true;
  return EXPLICIT_PATCH_RE.test(normalized);
}
