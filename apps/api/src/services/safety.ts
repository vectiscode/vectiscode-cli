import type { ChangeFile, SafetyReport } from "../types.js";

function suspiciousSourcePatterns(source: string) {
  const lower = source.toLowerCase();
  const blocked: string[] = [];
  if (/require\s*\(\s*\d{5,}/i.test(source)) blocked.push("require numeric asset id");
  if (lower.includes("loadstring") && /loadstring\s*\(/i.test(source)) blocked.push("loadstring call");
  if (lower.includes("getfenv") && /getfenv\s*\(/i.test(source)) blocked.push("getfenv call");
  if (lower.includes("setfenv") && /setfenv\s*\(/i.test(source)) blocked.push("setfenv call");
  if (/[.:]\s*getasync\s*\(/i.test(source)) blocked.push("HttpService:GetAsync");
  if (/[.:]\s*postasync\s*\(/i.test(source)) blocked.push("HttpService:PostAsync");
  if (/[.:]\s*requestasync\s*\(/i.test(source)) blocked.push("HttpService:RequestAsync");
  if (/[.:]\s*loadasset\s*\(/i.test(source)) blocked.push("InsertService:LoadAsset");
  if (lower.includes("string.reverse") && /string\.reverse\s*\(/i.test(source)) blocked.push("string.reverse call");
  if (/\\\d{2,3}\\\d{2,3}/.test(source)) blocked.push("escaped byte sequence");
  return blocked;
}

const luaClasses = new Set(["Script", "LocalScript", "ModuleScript"]);
const allowedClasses = new Set([
  "Script",
  "LocalScript",
  "ModuleScript",
  "Folder",
  "RemoteEvent",
  "RemoteFunction",
  "Tool",
  "Part",
  "WedgePart",
  "CornerWedgePart",
  "TrussPart",
  "SpawnLocation",
  "Model",
  "Animation",
  "PointLight",
  "SpotLight",
  "SurfaceLight",
  "Attachment",
  "WeldConstraint",
  "ProximityPrompt",
  "ClickDetector",
  "SurfaceGui",
  "BillboardGui",
  "ScreenGui",
  "Frame",
  "ScrollingFrame",
  "CanvasGroup",
  "TextLabel",
  "TextButton",
  "ImageLabel",
  "ImageButton",
  "UIListLayout",
  "UIGridLayout",
  "UIPadding",
  "UICorner",
  "UIStroke",
  "UIGradient",
  "UIAspectRatioConstraint",
  "UIScale",
  "UITextSizeConstraint",
  "UIPageLayout"
]);
const allowedActions = new Set(["create", "update", "delete", "import_asset"]);
const allowedRootServices = new Set([
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterPlayer",
  "StarterGui",
  "StarterPack"
]);
const allowedWorkspaceClasses = new Set([
  "Folder",
  "Model",
  "Part",
  "WedgePart",
  "CornerWedgePart",
  "TrussPart",
  "SpawnLocation",
  "Script",
  "PointLight",
  "SpotLight",
  "SurfaceLight",
  "Attachment",
  "WeldConstraint",
  "ProximityPrompt",
  "ClickDetector",
  "SurfaceGui",
  "BillboardGui"
]);
const allowedPropertyNames = new Set([
  "Name",
  "Anchored",
  "CanCollide",
  "Transparency",
  "Color",
  "Material",
  "Shape",
  "TopSurface",
  "BottomSurface",
  "Size",
  "Position",
  "CFrame",
  "Pivot",
  "Orientation",
  "Neutral",
  "AllowTeamChangeOnTouch",
  "RequiresHandle",
  "CanBeDropped",
  "ToolTip",
  "AnimationId",
  "Enabled",
  "Visible",
  "ZIndex",
  "ResetOnSpawn",
  "IgnoreGuiInset",
  "ZIndexBehavior",
  "BackgroundColor3",
  "BackgroundTransparency",
  "BorderColor3",
  "BorderSizePixel",
  "Text",
  "TextColor3",
  "TextTransparency",
  "TextSize",
  "TextScaled",
  "TextWrapped",
  "TextXAlignment",
  "TextYAlignment",
  "Font",
  "Image",
  "ImageRectOffset",
  "ImageRectSize",
  "ImageColor3",
  "ImageTransparency",
  "ScaleType",
  "AutoButtonColor",
  "ClipsDescendants",
  "LayoutOrder",
  "Size",
  "Position",
  "AnchorPoint",
  "AutomaticSize",
  "AutomaticCanvasSize",
  "CanvasSize",
  "ScrollBarImageColor3",
  "ScrollBarThickness",
  "Padding",
  "PaddingTop",
  "PaddingBottom",
  "PaddingLeft",
  "PaddingRight",
  "CornerRadius",
  "Thickness",
  "ApplyStrokeMode",
  "FillDirection",
  "HorizontalAlignment",
  "VerticalAlignment",
  "SortOrder",
  "CellSize",
  "CellPadding",
  "Color",
  "Rotation",
  "Offset",
  "Scale",
  "Brightness",
  "Range",
  "Angle",
  "Shadows",
  "Face",
  "AlwaysOnTop",
  "MaxDistance",
  "LightInfluence",
  "ActionText",
  "ObjectText",
  "HoldDuration",
  "KeyboardKeyCode",
  "GamepadKeyCode",
  "MaxActivationDistance",
  "RequiresLineOfSight",
  "ClickablePrompt",
  "AspectRatio",
  "AspectType",
  "DominantAxis",
  "MinTextSize",
  "MaxTextSize"
]);
const maxSourceCharsPerFile = 120_000;
const maxFilesPerChangeSet = 600;
const maxPropertiesPerFile = 50;

function isSafePropertyValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return (value.length === 2 || value.length === 3 || value.length === 4)
      && value.every((part) => typeof part === "number" && Number.isFinite(part) && Math.abs(part) <= 1_000_000);
  }
  if (typeof value === "string") return value.length <= 500;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  if (typeof value === "boolean") return true;
  if (!value || typeof value !== "object") return false;

  const typed = value as { type?: unknown; value?: unknown; enumType?: unknown };
  if (typed.type === "Enum") {
    return typeof typed.enumType === "string"
      && /^[A-Za-z][A-Za-z0-9]*$/.test(typed.enumType)
      && typeof typed.value === "string"
      && /^[A-Za-z][A-Za-z0-9]*$/.test(typed.value);
  }

  const expectedLengths: Record<string, number> = {
    Vector2: 2,
    Vector3: 3,
    Color3: 3,
    UDim: 2,
    UDim2: 4,
    CFrame: 12
  };
  const length = typeof typed.type === "string" ? expectedLengths[typed.type] : undefined;
  return typeof length === "number"
    && Array.isArray(typed.value)
    && typed.value.length === length
    && typed.value.every((part) => typeof part === "number" && Number.isFinite(part) && Math.abs(part) <= 1_000_000);
}

export function validateChangeFiles(files: ChangeFile[]): SafetyReport {
  const blockedPatterns = new Set<string>();

  if (files.length > maxFilesPerChangeSet) {
    blockedPatterns.add(`change set exceeds ${maxFilesPerChangeSet} files`);
  }

  for (const file of files) {
    if (!allowedActions.has(file.action)) {
      blockedPatterns.add(`unsupported action: ${file.action}`);
    }

    if (!allowedClasses.has(file.className)) {
      blockedPatterns.add(`unsupported class: ${file.className}`);
    }

    const pathParts = file.instancePath.split("/").filter(Boolean);
    const root = pathParts[0];
    const className = String(file.className);
    const rootAllowed = !!root && (
      allowedRootServices.has(root)
      || (root === "Workspace" && allowedWorkspaceClasses.has(className))
    );
    if (!rootAllowed) {
      blockedPatterns.add(`unsupported root service: ${root || "(empty)"}`);
    }

    if (root === "Workspace" && className !== "Script" && luaClasses.has(className)) {
      blockedPatterns.add("only server Scripts can be targeted under Workspace");
    }

    if (pathParts.some((part) => part === "." || part === "..")) {
      blockedPatterns.add("path traversal segments are not allowed");
    }

    if (file.instancePath.includes("\\") || file.instancePath.includes("//")) {
      blockedPatterns.add("instance paths must use single forward slashes");
    }

    const source = file.source ?? "";
    if (source && !luaClasses.has(className)) {
      blockedPatterns.add(`source is only allowed on Lua classes: ${className}`);
    }

    if (source.length > maxSourceCharsPerFile) {
      blockedPatterns.add(`source exceeds ${maxSourceCharsPerFile} characters`);
    }

    for (const pattern of suspiciousSourcePatterns(source)) {
      blockedPatterns.add(pattern);
    }

    if (file.properties) {
      const entries = Object.entries(file.properties);
      if (entries.length > maxPropertiesPerFile) {
        blockedPatterns.add(`properties exceed ${maxPropertiesPerFile} entries`);
      }
      for (const [key, value] of entries) {
        if (!allowedPropertyNames.has(key)) {
          blockedPatterns.add(`unsupported property: ${key}`);
        }
        if (!isSafePropertyValue(value)) {
          blockedPatterns.add(`unsafe property value: ${key}`);
        }
      }
    }

    if (file.action === "import_asset") {
      if (!file.assetId || !Number.isInteger(file.assetId) || file.assetId <= 0) {
        blockedPatterns.add("import_asset requires a positive assetId");
      }
      if (!["model", "animation", "mesh", "image", "audio"].includes(String(file.assetType ?? ""))) {
        blockedPatterns.add("import_asset requires assetType model, animation, mesh, image, or audio");
      }
    } else if (file.assetId) {
      blockedPatterns.add("assetId is only allowed for import_asset operations");
    }
  }

  return {
    ok: blockedPatterns.size === 0,
    blockedPatterns: [...blockedPatterns]
  };
}
