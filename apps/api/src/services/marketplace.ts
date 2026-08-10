export interface RobloxMarketplaceAsset {
  id: number;
  name: string;
  description?: string;
  creatorName?: string;
  assetType?: string;
}

const assetTypeMap: Record<string, string> = {
  model: "Model",
  image: "Image",
  mesh: "Mesh",
  audio: "Audio",
  plugin: "Plugin",
  video: "Video",
  font: "Font"
};

function normalizeAsset(raw: any): RobloxMarketplaceAsset | null {
  const id = Number(raw?.id ?? raw?.assetId ?? raw?.asset?.id);
  const name = String(raw?.name ?? raw?.displayName ?? raw?.asset?.name ?? "");
  if (!Number.isFinite(id) || id <= 0 || !name) return null;

  return {
    id,
    name,
    description: raw?.description ?? raw?.asset?.description,
    creatorName: raw?.creatorName ?? raw?.creator?.name ?? raw?.asset?.creatorName,
    assetType: raw?.assetType ?? raw?.type ?? raw?.asset?.type
  };
}

export async function searchRobloxMarketplace(input: {
  query: string;
  assetType: string;
  limit: number;
}): Promise<RobloxMarketplaceAsset[]> {
  const response = await fetch("https://apis.roblox.com/toolbox-service/v2/assets:search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      assetTypes: [assetTypeMap[input.assetType] ?? "Model"],
      maxPageSize: input.limit
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Roblox Creator Store search failed: ${response.status} ${detail.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const rawItems = data.assets ?? data.results ?? data.data ?? [];
  return rawItems
    .map(normalizeAsset)
    .filter(Boolean)
    .slice(0, input.limit);
}
