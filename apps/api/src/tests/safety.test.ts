import { describe, expect, it } from "vitest";
import { getRobloxUiGenerationPrompt, getVisualAestheticsPrompt, repairChangeFilesForStudioSafety, validateGeneratedExperienceQuality } from "../services/aiProvider.js";
import { validateChangeFiles } from "../services/safety.js";

describe("validateChangeFiles", () => {
  it("honors structural and programmatic UI preferences", () => {
    expect(getRobloxUiGenerationPrompt({ robloxUiGeneration: "structural" }).join("\n")).toContain("REVIEWABLE STRUCTURAL UI");
    expect(getRobloxUiGenerationPrompt({ robloxUiGeneration: "programmatic" }).join("\n")).toContain("PROGRAMMATIC FRAMEWORK UI");
    const clean = getVisualAestheticsPrompt({ robloxCartoonyUi: false, robloxUiFont: "GothamBold", robloxUiCornerRadius: 6 }, "Build a settings UI").join("\n");
    expect(clean).toContain("Clean, restrained Roblox game UI");
    expect(clean).toContain("Enum.Font.GothamBold");
    expect(clean).not.toContain("Stud UI");
  });
  it("gives compact safe-area HUD instructions for simple sprint stamina bars", () => {
    const prompt = getVisualAestheticsPrompt(undefined, "Add a sprint system with stamina and a small UI bar").join("\n");

    expect(prompt).toContain("UI STYLE: Compact Roblox HUD bar.");
    expect(prompt).toContain("AnchorPoint=Vector2.new(0.5, 1)");
    expect(prompt).toContain("Position=UDim2.new(0.5, 0, 1, -96)");
    expect(prompt).not.toContain("TextStrokeColor3=black");
    expect(prompt).not.toContain("UI STYLE: Stud UI");
    expect(prompt).not.toContain("UIStroke Thickness=4");
  });

  it("blocks suspicious remote module loaders", () => {
    const result = validateChangeFiles([
      {
        id: "file_test",
        action: "create",
        className: "Script",
        instancePath: "ServerScriptService/Bad",
        reason: "test",
        source: "require(1234567890)"
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.length).toBeGreaterThan(0);
  });

  it("checks long source for suspicious patterns without catastrophic regex behavior", () => {
    const source = `${"local value = 'safe text'\n".repeat(5000)}require(1234567890)`;
    const startedAt = Date.now();
    const result = validateChangeFiles([
      {
        id: "file_long_source",
        action: "create",
        className: "Script",
        instancePath: "ServerScriptService/LongSource",
        reason: "test",
        source
      }
    ]);

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("require numeric asset id");
  });

  it("allows ordinary Luau modules", () => {
    const result = validateChangeFiles([
      {
        id: "file_test",
        action: "create",
        className: "ModuleScript",
        instancePath: "ServerScriptService/Good",
        reason: "test",
        source: "local M = {}; return M"
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("allows server Scripts under Workspace world objects", () => {
    const result = validateChangeFiles([
      {
        id: "file_test",
        action: "update",
        className: "Script",
        instancePath: "Workspace/Collector001/CollectorScript",
        reason: "test",
        source: "print('hello')"
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("blocks client and module scripts under Workspace", () => {
    const result = validateChangeFiles([
      {
        id: "file_test",
        action: "create",
        className: "LocalScript",
        instancePath: "Workspace/Collector001/ClientScript",
        reason: "test",
        source: "print('hello')"
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("unsupported root service: Workspace");
  });

  it("allows reviewed Studio instance property patches", () => {
    const result = validateChangeFiles([
      {
        id: "file_part",
        action: "create",
        className: "Part",
        instancePath: "Workspace/VectisTestPart",
        reason: "test",
        properties: {
          Anchored: true,
          Size: { type: "Vector3", value: [4, 1, 4] },
          Color: { type: "Color3", value: [255, 180, 60] },
          Material: { type: "Enum", enumType: "Material", value: "Neon" }
        }
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("allows richer editable world geometry, prompts, lights, and full transforms", () => {
    const result = validateChangeFiles([
      {
        id: "file_wedge",
        action: "create",
        className: "WedgePart",
        instancePath: "Workspace/Playground/SlideRamp",
        reason: "test",
        properties: {
          Anchored: true,
          CFrame: { type: "CFrame", value: [0, 8, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
          Size: { type: "Vector3", value: [8, 1, 16] }
        }
      },
      {
        id: "file_light",
        action: "create",
        className: "PointLight",
        instancePath: "Workspace/Playground/Lamp/Glow",
        reason: "test",
        properties: {
          Brightness: 2,
          Range: 20,
          Shadows: true
        }
      },
      {
        id: "file_prompt",
        action: "create",
        className: "ProximityPrompt",
        instancePath: "Workspace/Playground/Kiosk/AuraPrompt",
        reason: "test",
        properties: {
          ActionText: "Claim Aura",
          ObjectText: "Aura Kiosk",
          MaxActivationDistance: 12
        }
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("supports large reviewed structural maps without allowing unbounded patches", () => {
    const files = Array.from({ length: 318 }, (_, index) => ({
      id: `file_${index}`,
      action: "create" as const,
      className: "Part" as const,
      instancePath: `Workspace/Playground/Part${index}`,
      reason: "test",
      properties: { Anchored: true }
    }));

    expect(validateChangeFiles(files).ok).toBe(true);
    expect(validateChangeFiles([...files, ...files]).blockedPatterns).toContain("change set exceeds 600 files");
  });

  it("allows common polished Roblox UI properties", () => {
    const result = validateChangeFiles([
      {
        id: "file_button",
        action: "create",
        className: "ImageButton",
        instancePath: "StarterGui/MainGui/ShopButton",
        reason: "test",
        properties: {
          Visible: true,
          ZIndex: 4,
          BackgroundColor3: { type: "Color3", value: [37, 99, 235] },
          Image: "rbxassetid://6031265976",
          ImageRectOffset: { type: "Vector2", value: [324, 364] },
          ImageRectSize: { type: "Vector2", value: [36, 36] },
          ImageColor3: { type: "Color3", value: [255, 255, 255] },
          AutoButtonColor: false,
          ScaleType: { type: "Enum", enumType: "ScaleType", value: "Fit" },
          TextScaled: true
        }
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("repairs reviewed UI properties to stay compatible with the Studio connector", () => {
    const repaired = repairChangeFilesForStudioSafety([
      {
        id: "file_gui",
        action: "create",
        className: "ScreenGui",
        instancePath: "StarterGui/PremiumShopUI",
        reason: "test",
        properties: {
          ResetOnSpawn: false,
          IgnoreGuiInset: false,
          ZIndexBehavior: "Sibling"
        }
      },
      {
        id: "file_label",
        action: "create",
        className: "TextLabel",
        instancePath: "StarterGui/PremiumShopUI/Title",
        reason: "test",
        properties: {
          Text: "Shop",
          Font: "GothamBlack",
          TextXAlignment: "Center"
        }
      }
    ]);

    expect(repaired[0].properties).toEqual({
      ResetOnSpawn: false,
      IgnoreGuiInset: false
    });
    expect(repaired[1].properties?.Font).toEqual({ type: "Enum", enumType: "Font", value: "GothamBlack" });
    expect(repaired[1].properties?.TextXAlignment).toEqual({ type: "Enum", enumType: "TextXAlignment", value: "Center" });
    expect(validateChangeFiles(repaired).ok).toBe(true);
  });

  it("repairs and normalizes string expression properties like UDim2, Color3, Vector3, and Enum", () => {
    const repaired = repairChangeFilesForStudioSafety([
      {
        id: "file_bar",
        action: "create",
        className: "Frame",
        instancePath: "StarterGui/StaminaGui/Container/Bar",
        reason: "test",
        properties: {
          Size: "UDim2.new(0, 240, 0, 32)",
          Position: "UDim2.new(0.5, -120, 0.85, 0)",
          BackgroundColor3: "Color3.fromRGB(46, 204, 113)",
          Font: "Enum.Font.FredokaOne"
        }
      }
    ]);

    expect(repaired[0].properties?.Size).toEqual({ type: "UDim2", value: [0, 240, 0, 32] });
    expect(repaired[0].properties?.Position).toEqual({ type: "UDim2", value: [0.5, -120, 0.85, 0] });
    expect(repaired[0].properties?.BackgroundColor3).toEqual({ type: "Color3", value: [46 / 255, 204 / 255, 113 / 255] });
    expect(repaired[0].properties?.Font).toEqual({ type: "Enum", enumType: "Font", value: "FredokaOne" });
    expect(validateChangeFiles(repaired).ok).toBe(true);
  });

  it("repairs bare array UI properties into connector-compatible typed values", () => {
    const repaired = repairChangeFilesForStudioSafety([
      {
        id: "file_gui",
        action: "create",
        className: "ScreenGui",
        instancePath: "StarterGui/SprintGui",
        reason: "Container for the stamina HUD elements.",
        properties: {
          ResetOnSpawn: false,
          IgnoreGuiInset: true
        }
      },
      {
        id: "file_bar",
        action: "create",
        className: "Frame",
        instancePath: "StarterGui/SprintGui/StaminaBar",
        reason: "Compact HUD bar container.",
        properties: {
          Size: [0, 200, 0, 20],
          Position: [0.5, 0, 1, -96],
          AnchorPoint: [0.5, 1],
          BorderSizePixel: 0,
          BackgroundColor3: [0.078, 0.078, 0.078]
        }
      }
    ]);

    expect(repaired[1].properties?.Size).toEqual({ type: "UDim2", value: [0, 200, 0, 20] });
    expect(repaired[1].properties?.Position).toEqual({ type: "UDim2", value: [0.5, 0, 1, -96] });
    expect(repaired[1].properties?.AnchorPoint).toEqual({ type: "Vector2", value: [0.5, 1] });
    expect(repaired[1].properties?.BackgroundColor3).toEqual({ type: "Color3", value: [0.078, 0.078, 0.078] });
    expect(validateChangeFiles(repaired).ok).toBe(true);
  });

  it("allows reviewed marketplace asset import operations", () => {
    const result = validateChangeFiles([
      {
        id: "file_asset",
        action: "import_asset",
        className: "Model",
        instancePath: "ReplicatedStorage/Assets/BoxingGloves",
        reason: "test",
        assetId: 5315386527,
        assetType: "model"
      }
    ]);

    expect(result.ok).toBe(true);
  });

  it("blocks unsafe property names", () => {
    const result = validateChangeFiles([
      {
        id: "file_bad_prop",
        action: "create",
        className: "Part",
        instancePath: "Workspace/VectisTestPart",
        reason: "test",
        properties: {
          Source: "print('nope')"
        }
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("unsupported property: Source");
  });

  it("repairs accidental UI source by moving behavior into a LocalScript", () => {
    const repaired = repairChangeFilesForStudioSafety([
      {
        id: "file_frame",
        action: "create",
        className: "Frame",
        instancePath: "StarterGui/GravityHUD/MainFrame",
        reason: "test",
        source: "script.Parent.Visible = true",
        properties: {
          BackgroundTransparency: 0.1
        }
      }
    ]);

    expect(repaired).toHaveLength(2);
    expect(repaired[0].className).toBe("Frame");
    expect(repaired[0].source).toBeUndefined();
    expect(repaired[1].className).toBe("LocalScript");
    expect(repaired[1].instancePath).toBe("StarterGui/GravityHUD/MainFrame/ClientBehavior");
    expect(validateChangeFiles(repaired).ok).toBe(true);
  });

  it("blocks asset IDs outside reviewed import operations", () => {
    const result = validateChangeFiles([
      {
        id: "file_bad_asset",
        action: "create",
        className: "Animation",
        instancePath: "ReplicatedStorage/Animations/Flip",
        reason: "test",
        assetId: 123
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("assetId is only allowed for import_asset operations");
  });

  it("rejects dead shop and rebirth UI scaffolds with no buttons or feedback", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "make an actually working shop and rebirth UI with clickable icons",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MainGui",
          reason: "Root container for the game UI."
        },
        {
          id: "file_shop",
          action: "create",
          className: "Frame",
          instancePath: "StarterGui/MainGui/ShopFrame",
          reason: "Shop interface container."
        },
        {
          id: "file_controller",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterPlayer/StarterPlayerScripts/UIController",
          reason: "Manages UI updates and interactions.",
          source: "-- Logic to update HUD labels would go here"
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: generated files contain placeholder or unfinished implementation text");
    expect(result.blockedPatterns).toContain("quality: UI request has no clickable TextButton or ImageButton controls");
    expect(result.blockedPatterns).toContain("quality: shop purchases have no authoritative server handler with currency checks");
    expect(result.blockedPatterns).toContain("quality: rebirth has no authoritative server handler with stat requirements and reset logic");
  });

  it("allows validated shop preview products that only record ownership", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Create a simple shop UI with safe server-side purchase logic.",
        history: []
      },
      [
        {
          id: "file_remote",
          action: "create",
          className: "RemoteEvent",
          instancePath: "ReplicatedStorage/ShopPurchase",
          reason: "Routes purchase requests."
        },
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/ShopGui",
          reason: "Hosts the shop UI."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/ShopGui/ShopClient",
          reason: "Builds the shop UI.",
          source: [
            "local ReplicatedStorage = game:GetService(\"ReplicatedStorage\")",
            "local shopRemote = ReplicatedStorage:WaitForChild(\"ShopPurchase\")",
            "local SHOP_ITEMS = {",
            "  {id = \"SpeedBoost\", displayName = \"SPEED BOOST\", desc = \"Run 50% faster for 60s\", price = 50},",
            "  {id = \"DoubleCoins\", displayName = \"DOUBLE COINS\", desc = \"2x coin pickup for 120s\", price = 120},",
            "  {id = \"MegaJump\", displayName = \"MEGA JUMP\", desc = \"Jump height x2 for 60s\", price = 75},",
            "}",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "local title = Instance.new(\"TextLabel\")",
            "title.Text = \"Shop\"",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "closeButton.MouseButton1Click:Connect(function() shopPanel.Visible = false end)",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"BUY\"",
            "buyButton.MouseButton1Click:Connect(function() shopPanel.Visible = true end)",
            "buyButton.MouseButton1Click:Connect(function() shopRemote:FireServer(\"SpeedBoost\") end)"
          ].join("\n")
        },
        {
          id: "file_server",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/ShopServer",
          reason: "Validates purchases.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local ReplicatedStorage = game:GetService(\"ReplicatedStorage\")",
            "local shopRemote = ReplicatedStorage:WaitForChild(\"ShopPurchase\")",
            "local SHOP_ITEMS = { SpeedBoost = {price = 50}, DoubleCoins = {price = 120}, MegaJump = {price = 75} }",
            "Players.PlayerAdded:Connect(function(player)",
            "  local stats = Instance.new(\"Folder\") stats.Name = \"leaderstats\" stats.Parent = player",
            "  local gold = Instance.new(\"IntValue\") gold.Name = \"Gold\" gold.Value = 500 gold.Parent = stats",
            "end)",
            "shopRemote.OnServerEvent:Connect(function(player, itemId)",
            "  local item = SHOP_ITEMS[itemId]",
            "  local gold = player.leaderstats.Gold",
            "  if not item or gold.Value < item.price then return end",
            "  gold.Value -= item.price",
            "  local owned = Instance.new(\"BoolValue\")",
            "  owned.Name = itemId",
            "  owned.Parent = player",
            "end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
    expect(result.blockedPatterns).not.toContain("quality: shop products advertise gameplay effects but the server only records ownership or currency changes");
  });

  it("rejects shop UI with a bottom-left launcher and bright white grid background", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Fix the shop UI, remove the weird white background and move the shop button to the center left.",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/ShopGui",
          reason: "Hosts the shop UI."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/ShopGui/ShopClient",
          reason: "Builds the shop UI.",
          source: [
            "local gui = script.Parent",
            "local function buildGridBg(parent)",
            "  local container = Instance.new(\"Frame\")",
            "  container.Name = \"GridBg\"",
            "  for i = 1, 20 do",
            "    local tile = Instance.new(\"Frame\")",
            "    tile.BackgroundColor3 = Color3.fromRGB(245, 245, 250)",
            "    tile.Parent = container",
            "  end",
            "end",
            "local launcher = Instance.new(\"TextButton\")",
            "launcher.Name = \"ShopLauncher\"",
            "launcher.Position = UDim2.new(0, 24, 1, -104)",
            "launcher.Text = \"SHOP\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "local buy = Instance.new(\"TextButton\")",
            "buy.Text = \"BUY\"",
            "buy.MouseButton1Click:Connect(function() shopPanel.Visible = true end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: shop launcher should avoid the bottom-left hotbar area; use a center-left side button or side dock");
    expect(result.blockedPatterns).toContain("quality: shop grid background is too bright; use a subtle tinted panel texture instead of a white checkerboard");
  });

  it("rejects shop UI that does not start hidden or wire the close button to the opened panel", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "create a polished shop UI with a launcher and close button",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/ShopGui",
          reason: "Hosts the shop UI."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/ShopGui/ShopClient",
          reason: "Builds the shop UI.",
          source: [
            "local launcher = Instance.new(\"TextButton\")",
            "launcher.Text = \"Shop\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "local title = Instance.new(\"TextLabel\")",
            "title.Text = \"Potion Shop\"",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"X\"",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Buy Speed Potion\"",
            "launcher.Activated:Connect(function() shopPanel.Visible = true end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: shop panels must start hidden and open only from the launcher");
    expect(result.blockedPatterns).toContain("quality: shop panels need a wired close control that hides the same panel the launcher opens");
  });

  it("rejects existing shop controller updates that layer a new generated shop without cleanup", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "replace the existing shop UI with a working speed potion shop",
        history: []
      },
      [
        {
          id: "file_client",
          action: "update",
          className: "LocalScript",
          instancePath: "StarterGui/ShopUI/ShopController",
          reason: "Builds a replacement potion shop UI.",
          source: [
            "local gui = script.Parent",
            "local launcher = Instance.new(\"TextButton\")",
            "launcher.Text = \"Shop\"",
            "launcher.Parent = gui",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "shopPanel.Parent = gui",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "closeButton.Activated:Connect(function() shopPanel.Visible = false end)",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Buy Speed Potion\"",
            "launcher.Activated:Connect(function() shopPanel.Visible = true end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: updates to an existing shop UI must clear or replace the previous shop surface before building a new one");
  });

  it("accepts existing shop controller updates that clean up the previous generated shop", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "replace the existing shop UI with a simple shop UI",
        history: []
      },
      [
        {
          id: "file_client",
          action: "update",
          className: "LocalScript",
          instancePath: "StarterGui/ShopUI/ShopController",
          reason: "Replaces the old shop UI cleanly.",
          source: [
            "local gui = script.Parent",
            "for _, child in ipairs(gui:GetChildren()) do",
            "  if child ~= script then child:Destroy() end",
            "end",
            "local launcher = Instance.new(\"TextButton\")",
            "launcher.Text = \"Shop\"",
            "launcher.Parent = gui",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "shopPanel.Parent = gui",
            "local title = Instance.new(\"TextLabel\")",
            "title.Text = \"Potion Shop\"",
            "title.Parent = shopPanel",
            "local balance = Instance.new(\"TextLabel\")",
            "balance.Text = \"Coins: 250\"",
            "balance.Parent = shopPanel",
            "local itemLabel = Instance.new(\"TextLabel\")",
            "itemLabel.Text = \"Featured item: Speed Potion\"",
            "itemLabel.Parent = shopPanel",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "closeButton.Activated:Connect(function() shopPanel.Visible = false end)",
            "closeButton.Parent = shopPanel",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Buy Speed Potion\"",
            "buyButton.Parent = shopPanel",
            "launcher.Activated:Connect(function() shopPanel.Visible = true end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("rejects generic nice UI scaffolds that are just one panel and one button", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a nice looking ui",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MainHUD",
          reason: "Main container for the HUD interface."
        },
        {
          id: "file_frame",
          action: "create",
          className: "Frame",
          instancePath: "StarterGui/MainHUD/MainFrame",
          reason: "Primary background panel for the HUD."
        },
        {
          id: "file_corner",
          action: "create",
          className: "UICorner",
          instancePath: "StarterGui/MainHUD/MainFrame/UICorner",
          reason: "Rounded corners."
        },
        {
          id: "file_stroke",
          action: "create",
          className: "UIStroke",
          instancePath: "StarterGui/MainHUD/MainFrame/UIStroke",
          reason: "Border."
        },
        {
          id: "file_gradient",
          action: "create",
          className: "UIGradient",
          instancePath: "StarterGui/MainHUD/MainFrame/UIGradient",
          reason: "Depth."
        },
        {
          id: "file_title",
          action: "create",
          className: "TextLabel",
          instancePath: "StarterGui/MainHUD/MainFrame/Title",
          reason: "Header text."
        },
        {
          id: "file_button",
          action: "create",
          className: "TextButton",
          instancePath: "StarterGui/MainHUD/MainFrame/ActionButton",
          reason: "Primary interaction button."
        },
        {
          id: "file_controller",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/MainHUD/HUDController",
          reason: "Handles UI animations and interactions.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local actionButton = script.Parent.MainFrame.ActionButton",
            "local scale = Instance.new(\"UIScale\")",
            "scale.Parent = actionButton",
            "actionButton.MouseEnter:Connect(function() TweenService:Create(scale, TweenInfo.new(0.2), {Scale = 1.05}):Play() end)",
            "actionButton.Activated:Connect(function() print(\"Action triggered!\") end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: polished generic UI requests need multiple useful controls, sections, and feedback states instead of one centered panel or one button");
    expect(result.blockedPatterns).toContain("quality: polished UI cannot be a generic starter template with MainHUD, MainFrame, ActionButton, Click Me, or debug-only action text");
    expect(result.blockedPatterns).toContain("quality: property-only UI controls must set Size, Position or LayoutOrder, text, font, colors, and visual styling instead of relying on default gray Roblox UI");
  });

  it("rejects realistic world props that are only a single plain part", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Create a wooden crate with realistic proportions",
        history: []
      },
      [
        {
          id: "file_crate",
          action: "create",
          className: "Part",
          instancePath: "Workspace/WoodenCrate",
          reason: "Creates a realistic wooden crate for the world.",
          properties: {
            Size: { type: "Vector3", value: [3, 3, 3] },
            Material: { type: "Enum", enumType: "Material", value: "WoodPlanks" },
            Anchored: false
          }
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: detailed world props need a constructed edit-mode Model or multiple Workspace parts, not a single plain Part");
    expect(result.blockedPatterns).toContain("quality: detailed world props need visible construction details such as planks, trim, braces, panels, or material variation");
  });

  it("rejects runtime-only map builders for normal map placement", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Create a round-based minigame system with a lobby and maps",
        history: []
      },
      [
        {
          id: "file_builder",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/MapBuilder",
          reason: "Builds maps at runtime.",
          source: [
            "local lobby = Instance.new(\"Folder\")",
            "lobby.Name = \"Lobby\"",
            "lobby.Parent = workspace",
            "local base = Instance.new(\"Part\")",
            "base.Size = Vector3.new(100, 1, 100)",
            "base.Parent = lobby"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: map, lobby, spawn, prop, and scenery geometry must be edit-mode Workspace instances, not a runtime builder script that only appears while playing");
  });

  it("allows text-only launcher letters instead of blocking a useful UI patch", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "create a typical Roblox shop and rebirth UI with clickable icons, UI only",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds UI with poor launcher buttons.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local shopButton = Instance.new(\"TextButton\")",
            "shopButton.Text = \"SHOP\"",
            "local rebirthButton = Instance.new(\"TextButton\")",
            "rebirthButton.Text = \"RB\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "local rebirthPanel = Instance.new(\"Frame\")",
            "rebirthPanel.Visible = false",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Buy Speed\"",
            "local rebirthAction = Instance.new(\"TextButton\")",
            "rebirthAction.Text = \"Rebirth Now\"",
            "shopButton.Activated:Connect(function() TweenService:Create(shopPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "rebirthButton.Activated:Connect(function() TweenService:Create(rebirthPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "closeButton.Activated:Connect(function() shopPanel.Visible = false rebirthPanel.Visible = false end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("flags blank image-backed controls so UI repairs add real icons", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "add a good front end ui for a brainrot game",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MainUI",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/MainUI/UIController",
          reason: "Builds a colorful UI.",
          source: [
            "local button = Instance.new(\"ImageButton\")",
            "local label = Instance.new(\"TextLabel\")",
            "label.Text = \"Shop\"",
            "button.Activated:Connect(function() label.Text = \"Open\" end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: ImageButton and ImageLabel controls need actual rbxassetid image assets, not blank colored boxes");
  });

  it("flags StarterGui waits inside player LocalScripts because they stop UI creation", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a really good looking brain rot type of ui",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/BrainRotUI",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/BrainRotUI/Controller",
          reason: "Builds the UI.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local player = Players.LocalPlayer",
            "local playerGui = player:WaitForChild(\"StarterGui\")",
            "local button = Instance.new(\"TextButton\")",
            "button.Text = \"Open\"",
            "button.Activated:Connect(function() button.Text = \"Clicked\" end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: LocalScript waits for StarterGui under the player; use script.Parent or PlayerGui so the UI actually appears");
  });

  it("flags repeated icon assets and jittery RenderStepped layout in polished UI", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a really good looking brain rot type of ui",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/BrainRotUI",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/BrainRotUI/Controller",
          reason: "Builds the UI.",
          source: [
            "local RunService = game:GetService(\"RunService\")",
            "local frame = Instance.new(\"Frame\")",
            "local button = Instance.new(\"ImageButton\")",
            "button.Image = \"rbxassetid://14521477161\"",
            "local iconA = Instance.new(\"ImageLabel\")",
            "iconA.Image = \"rbxassetid://14521477161\"",
            "local iconB = Instance.new(\"ImageLabel\")",
            "iconB.Image = \"rbxassetid://14521477161\"",
            "local iconC = Instance.new(\"ImageLabel\")",
            "iconC.Image = \"rbxassetid://14521477161\"",
            "button.Activated:Connect(function() frame.Visible = true end)",
            "RunService.RenderStepped:Connect(function() frame.Size = UDim2.fromOffset(400, 500) end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: custom UI should not reuse the same icon asset for every visual item");
    expect(result.blockedPatterns).toContain("quality: high-quality UI should not mutate layout or font sizes every RenderStepped; use tweened feedback instead");
  });

  it("rejects the old Vectis brainrot frontend preset for high-quality UI", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a really good looking brainrot UI",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/BrainrotFrontend",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/BrainrotFrontend/BrainrotFrontendClient",
          reason: "Builds the UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local BrainrotFrontendRoot = Instance.new(\"Frame\")",
            "local button = Instance.new(\"TextButton\")",
            "button.Text = \"Open\"",
            "local corner = Instance.new(\"UICorner\")",
            "local stroke = Instance.new(\"UIStroke\")",
            "local gradient = Instance.new(\"UIGradient\")",
            "button.Activated:Connect(function() button.Text = \"Clicked\" end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: UI must be custom for this project, not the old Vectis brainrot or polished UI preset");
  });

  it("flags Roblox sprite sheet icons without rect metadata", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a really good looking brainrot UI with icons",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/BrainRotUI",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/BrainRotUI/Controller",
          reason: "Builds the UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local button = Instance.new(\"ImageButton\")",
            "button.Image = \"rbxassetid://3926305904\"",
            "local corner = Instance.new(\"UICorner\")",
            "local stroke = Instance.new(\"UIStroke\")",
            "local gradient = Instance.new(\"UIGradient\")",
            "local scale = Instance.new(\"UIScale\")",
            "button.Activated:Connect(function() TweenService:Create(scale, TweenInfo.new(0.12), {Scale = 1.08}):Play() end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: Roblox sprite sheet icon assets need ImageRectOffset and ImageRectSize or primitive icon art");
  });

  it("flags movement HUD image guesses and _G wiring", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Add unique animations for double jump, sprint and dash and add UI cooldowns with buttons and icons.",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MovementHUD",
          reason: "Holds movement UI."
        },
        {
          id: "file_hud",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/MovementHUD/HUDController",
          reason: "Builds the movement HUD.",
          source: [
            "local RunService = game:GetService(\"RunService\")",
            "local function createAbilityCard(name, key, color, position, iconId)",
            "    local icon = Instance.new(\"ImageLabel\")",
            "    icon.Name = \"Icon\"",
            "    icon.Image = iconId",
            "    local keyLabel = Instance.new(\"TextLabel\")",
            "    keyLabel.Text = key",
            "    return icon",
            "end",
            "createAbilityCard(\"Dash\", \"Q\", Color3.new(0, 1, 1), UDim2.new(), \"rbxassetid://6031277531\")",
            "createAbilityCard(\"Sprint\", \"SHIFT\", Color3.new(0, 1, 0), UDim2.new(), \"rbxassetid://6034501758\")",
            "createAbilityCard(\"Jump\", \"SPACE\", Color3.new(1, 0, 1), UDim2.new(), \"rbxassetid://6034502922\")",
            "RunService.RenderStepped:Connect(function() local state = _G.MovementState end)",
            "if _G.TriggerDash then _G.TriggerDash() end"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: movement HUD icons need reliable primitive icon art or sprite-sheet rect metadata, not bare ImageLabel asset guesses");
    expect(result.blockedPatterns).toContain("quality: movement HUD scripts should communicate through BindableEvents or a shared ModuleScript, not _G globals");
  });

  it("flags small stamina HUD bars that risk edge clipping and use chunky panel styling", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Add a sprint system with stamina and a small UI bar",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/StaminaGui",
          reason: "Holds the stamina interface.",
          properties: { ResetOnSpawn: false }
        },
        {
          id: "file_container",
          action: "create",
          className: "Frame",
          instancePath: "StarterGui/StaminaGui/Container",
          reason: "Main stamina bar container.",
          properties: {
            Size: "UDim2.new(0, 240, 0, 32)",
            Position: "UDim2.new(0.5, -120, 0.85, 0)",
            BackgroundTransparency: 1
          }
        },
        {
          id: "file_shadow",
          action: "create",
          className: "Frame",
          instancePath: "StarterGui/StaminaGui/Container/Shadow",
          reason: "Adds a heavy shadow.",
          properties: {
            Size: "UDim2.new(1, 0, 1, 0)",
            Position: "UDim2.new(0, 4, 0, 4)",
            BackgroundColor3: "Color3.fromRGB(0, 0, 0)",
            BackgroundTransparency: 0.5
          }
        },
        {
          id: "file_bar",
          action: "create",
          className: "Frame",
          instancePath: "StarterGui/StaminaGui/Container/Bar",
          reason: "Background bar.",
          properties: {
            Size: "UDim2.new(1, 0, 1, 0)",
            Position: "UDim2.new(0, 0, 0, 0)",
            BackgroundColor3: "Color3.fromRGB(30, 30, 30)"
          }
        },
        {
          id: "file_stroke",
          action: "create",
          className: "UIStroke",
          instancePath: "StarterGui/StaminaGui/Container/Bar/UIStroke",
          reason: "Adds a thick outline.",
          properties: {
            Color: "Color3.fromRGB(0, 0, 0)",
            Thickness: 4
          }
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: small HUD bars near screen edges must use AnchorPoint and negative safe-area inset so they stay fully on screen");
    expect(result.blockedPatterns).toContain("quality: small stamina or cooldown HUD bars should be compact and readable, not chunky shadow panels with oversized black strokes");
  });

  it("flags movement cooldown UI without seconds and double jump state", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Add unique animations for all three things and add UI cooldowns in seconds for dash and double jump.",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MovementHUD",
          reason: "Holds movement UI."
        },
        {
          id: "file_hud",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/MovementHUD/HUDController",
          reason: "Builds the movement HUD.",
          source: [
            "local jump = Instance.new(\"TextButton\")",
            "jump.Text = \"SPACE\"",
            "local dash = Instance.new(\"TextButton\")",
            "dash.Text = \"Q\"",
            "local sprint = Instance.new(\"TextButton\")",
            "sprint.Text = \"SHIFT\"",
            "dash.Activated:Connect(function() dash.BackgroundTransparency = 0.5 end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: movement cooldown UI must show remaining seconds when requested");
    expect(result.blockedPatterns).toContain("quality: double jump cooldown UI needs its own cooldown state and seconds display, not only dash timing or color changes");
  });

  it("flags double jump repairs that only change camera zoom", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "Fix the broken double jump and keep the MovementHUD visible.",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/MovementHUD",
          reason: "Holds movement UI."
        },
        {
          id: "file_hud",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/MovementHUD/HUDController",
          reason: "Handles double jump feedback.",
          source: [
            "local camera = workspace.CurrentCamera",
            "local doubleJumpButton = Instance.new(\"TextButton\")",
            "doubleJumpButton.Text = \"SPACE\"",
            "local function doDoubleJump()",
            "    camera.FieldOfView = 84",
            "end",
            "doubleJumpButton.Activated:Connect(doDoubleJump)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: double jump must apply a real upward movement change, not only camera, animation, or UI feedback");
    expect(result.blockedPatterns).toContain("quality: double jump cannot be implemented as only camera FOV or zoom feedback");
  });

  it("flags old MovementHUD repairs that create another UI without replacing the old one", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "The old ugly MovementHUD UI is still there and the new UI is invisible, fix it.",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/NewMovementHUD",
          reason: "Adds replacement movement UI."
        },
        {
          id: "file_hud",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/NewMovementHUD/HUDController",
          reason: "Builds another movement HUD.",
          source: [
            "local button = Instance.new(\"TextButton\")",
            "button.Text = \"Sprint\"",
            "button.Activated:Connect(function() end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: old or duplicate UI repair must update or delete the existing StarterGui objects instead of creating another hidden replacement");
  });

  it("flags unsafe dash vectors, humanoid access, and rig mutation", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "implement unique sprint dash and double jump animations with a HUD",
        history: []
      },
      [
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterPlayer/StarterPlayerScripts/MovementMechanics",
          reason: "Handles movement.",
          source: [
            "local camera = workspace.CurrentCamera",
            "local function getHumanoid() return nil end",
            "local function dash(root)",
            "    local moveDir = getHumanoid().MoveDirection",
            "    local dashDir = (camera.CFrame.LookVector * Vector3.new(1, 0, 1)).Unit",
            "    root:ApplyImpulse(dashDir)",
            "end",
            "local function performFlip(root)",
            "    local joint = root:FindFirstChild(\"RootJoint\")",
            "    joint.C0 = joint.C0 * CFrame.Angles(math.rad(-360), 0, 0)",
            "end"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: movement mechanics need nil-safe humanoid/root checks and magnitude guards before using Unit or MoveDirection");
    expect(result.blockedPatterns).toContain("quality: movement animations should avoid direct RootJoint C0 or C1 mutation; use Animator tracks, Motor6D.Transform, or cleaned-up visual effects");
  });

  it("flags toast stacks that overlap primary bottom actions", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "generate a really good looking brainrot HUD",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/BrainRotHUD",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/BrainRotHUD/Controller",
          reason: "Builds the UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local ToastContainer = Instance.new(\"Frame\")",
            "ToastContainer.Position = UDim2.new(0.3, 0, 0.75, 0)",
            "local centerContainer = Instance.new(\"Frame\")",
            "local giantBtn = Instance.new(\"TextButton\")",
            "giantBtn.Text = \"HATCH\"",
            "local corner = Instance.new(\"UICorner\")",
            "local stroke = Instance.new(\"UIStroke\")",
            "local gradient = Instance.new(\"UIGradient\")",
            "local scale = Instance.new(\"UIScale\")",
            "giantBtn.Activated:Connect(function() TweenService:Create(scale, TweenInfo.new(0.12), {Scale = 1.08}):Play() end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: toast stack overlaps the primary bottom action; move notifications above or beside the hatch or collect control");
  });

  it("rejects blank major panels even when open and close controls exist", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "create a nice rebirth and shop UI, UI only",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds empty panels.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local shopIcon = Instance.new(\"ImageButton\")",
            "shopIcon.Image = \"rbxassetid://6031265976\"",
            "local rebirthIcon = Instance.new(\"ImageButton\")",
            "rebirthIcon.Image = \"rbxassetid://6031094678\"",
            "local shopFrame = Instance.new(\"Frame\")",
            "local rebirthFrame = Instance.new(\"Frame\")",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "shopIcon.Activated:Connect(function() TweenService:Create(shopFrame, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "rebirthIcon.Activated:Connect(function() TweenService:Create(rebirthFrame, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "closeButton.Activated:Connect(function() shopFrame.Visible = false rebirthFrame.Visible = false end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: shop or rebirth panels need populated content and visible action controls");
    expect(result.blockedPatterns).toContain("quality: shop or rebirth panels cannot be empty major containers");
  });

  it("allows clickable Roblox UI even when extra animation polish is missing", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "create a polished shop and rebirth UI, UI only",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds static clickable UI.",
          source: [
            "local shopIcon = Instance.new(\"ImageButton\")",
            "shopIcon.Image = \"rbxassetid://6031265976\"",
            "local rebirthIcon = Instance.new(\"ImageButton\")",
            "rebirthIcon.Image = \"rbxassetid://6031094678\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "local rebirthPanel = Instance.new(\"Frame\")",
            "rebirthPanel.Visible = false",
            "local shopTitle = Instance.new(\"TextLabel\")",
            "shopTitle.Text = \"Shop\"",
            "local rebirthTitle = Instance.new(\"TextLabel\")",
            "rebirthTitle.Text = \"Rebirth Requirement\"",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Preview Boost\"",
            "local rebirthAction = Instance.new(\"TextButton\")",
            "rebirthAction.Text = \"Preview Rebirth\"",
            "local closeButton = Instance.new(\"TextButton\")",
            "closeButton.Text = \"Close\"",
            "shopIcon.Activated:Connect(function() shopPanel.Visible = true end)",
            "rebirthIcon.Activated:Connect(function() rebirthPanel.Visible = true end)",
            "closeButton.Activated:Connect(function() shopPanel.Visible = false rebirthPanel.Visible = false end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("accepts a wired animated shop and rebirth UI patch", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "make an actually working shop and rebirth UI with clickable icons",
        history: []
      },
      [
        {
          id: "file_remote_purchase",
          action: "create",
          className: "RemoteEvent",
          instancePath: "ReplicatedStorage/EconomyRemotes/PurchaseProduct",
          reason: "Routes purchase requests to the server."
        },
        {
          id: "file_remote_rebirth",
          action: "create",
          className: "RemoteEvent",
          instancePath: "ReplicatedStorage/EconomyRemotes/RequestRebirth",
          reason: "Routes rebirth requests to the server."
        },
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the economy interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds animated shop and rebirth UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local ReplicatedStorage = game:GetService(\"ReplicatedStorage\")",
            "local remotes = ReplicatedStorage:WaitForChild(\"EconomyRemotes\")",
            "local purchaseRemote = remotes:WaitForChild(\"PurchaseProduct\")",
            "local rebirthRemote = remotes:WaitForChild(\"RequestRebirth\")",
            "local screenGui = script.Parent",
            "local shopIcon = Instance.new(\"ImageButton\")",
            "shopIcon.Image = \"rbxassetid://6031265976\"",
            "local rebirthIcon = Instance.new(\"ImageButton\")",
            "rebirthIcon.Image = \"rbxassetid://6031094678\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "local rebirthPanel = Instance.new(\"Frame\")",
            "rebirthPanel.Visible = false",
            "local closeShop = Instance.new(\"TextButton\")",
            "closeShop.Text = \"Close\"",
            "closeShop.Activated:Connect(function() shopPanel.Visible = false end)",
            "local closeRebirth = Instance.new(\"TextButton\")",
            "closeRebirth.Text = \"Close\"",
            "closeRebirth.Activated:Connect(function() rebirthPanel.Visible = false end)",
            "local shopTitle = Instance.new(\"TextLabel\")",
            "shopTitle.Text = \"Shop\"",
            "local rebirthTitle = Instance.new(\"TextLabel\")",
            "rebirthTitle.Text = \"Rebirth Requirement\"",
            "shopIcon.MouseEnter:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 4}):Play() end)",
            "shopIcon.MouseLeave:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 0}):Play() end)",
            "shopIcon.Activated:Connect(function() shopPanel.Visible = true TweenService:Create(shopPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "rebirthIcon.Activated:Connect(function() rebirthPanel.Visible = true TweenService:Create(rebirthPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Buy PowerPack item\"",
            "buyButton.Activated:Connect(function() purchaseRemote:FireServer(\"PowerPack\") end)",
            "local rebirthButton = Instance.new(\"TextButton\")",
            "rebirthButton.Text = \"Rebirth action\"",
            "rebirthButton.Activated:Connect(function() rebirthRemote:FireServer() end)"
          ].join("\n")
        },
        {
          id: "file_server",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/EconomyServer",
          reason: "Authoritative purchase and rebirth backend.",
          source: [
            "local ReplicatedStorage = game:GetService(\"ReplicatedStorage\")",
            "local remotes = ReplicatedStorage:WaitForChild(\"EconomyRemotes\")",
            "remotes.PurchaseProduct.OnServerEvent:Connect(function(player, productName)",
            "  local stats = player:WaitForChild(\"leaderstats\")",
            "  local coins = stats:WaitForChild(\"Coins\")",
            "  if productName == \"PowerPack\" and coins.Value >= 100 then coins.Value -= 100 end",
            "end)",
            "remotes.RequestRebirth.OnServerEvent:Connect(function(player)",
            "  local stats = player:WaitForChild(\"leaderstats\")",
            "  local strength = stats:WaitForChild(\"Strength\")",
            "  local rebirths = stats:WaitForChild(\"Rebirths\")",
            "  local coins = stats:WaitForChild(\"Coins\")",
            "  if strength.Value >= 1000 then strength.Value = 0 coins.Value = 0 rebirths.Value += 1 end",
            "end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("does not apply stale UI history to a new fighting system request", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "add a fighting system and custom animations",
        history: [
          {
            id: "msg_history",
            projectId: "project",
            threadId: "thread",
            role: "user",
            content: "create a polished shop UI with a close button and animated panel",
            createdAt: new Date().toISOString()
          }
        ]
      },
      [
        {
          id: "file_combat",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/CombatServer",
          reason: "Adds authoritative combat damage.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local DAMAGE = 20",
            "Players.PlayerAdded:Connect(function(player)",
            "  player:SetAttribute(\"CombatDamage\", DAMAGE)",
            "end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("rejects backend scripts when the user asks only for UI", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "just make a polished shop and rebirth UI with clickable icons, no backend",
        history: [
          {
            id: "msg_history",
            projectId: "project",
            threadId: "thread",
            role: "user",
            content: "earlier I asked for purchases and rebirth backend",
            createdAt: new Date().toISOString()
          }
        ]
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the economy interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds animated UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local shopIcon = Instance.new(\"ImageButton\")",
            "shopIcon.Image = \"rbxassetid://6031265976\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "local button = Instance.new(\"TextButton\")",
            "button.Text = \"Preview item\"",
            "local closeShop = Instance.new(\"TextButton\")",
            "closeShop.Text = \"Close\"",
            "closeShop.Activated:Connect(function() shopPanel.Visible = false end)",
            "shopIcon.MouseEnter:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 4}):Play() end)",
            "shopIcon.MouseLeave:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 0}):Play() end)",
            "shopIcon.Activated:Connect(function() shopPanel.Visible = true TweenService:Create(shopPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "button.Activated:Connect(function() button.Text = \"Preview\" end)"
          ].join("\n")
        },
        {
          id: "file_server",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/EconomyServer",
          reason: "Should not be included for UI-only requests.",
          source: "game.Players.PlayerAdded:Connect(function(player) local stats = player:WaitForChild(\"leaderstats\") end)"
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns).toContain("quality: UI-only request added backend, remotes, persistence, or server gameplay wiring");
  });

  it("accepts polished client-only UI when the user asks only for UI", () => {
    const result = validateGeneratedExperienceQuality(
      {
        prompt: "just make a polished shop and rebirth UI with clickable icons, no backend",
        history: []
      },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/EconomyGui",
          reason: "Holds the economy interface."
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/EconomyGui/EconomyClient",
          reason: "Builds animated client-only UI.",
          source: [
            "local TweenService = game:GetService(\"TweenService\")",
            "local shopIcon = Instance.new(\"ImageButton\")",
            "shopIcon.Image = \"rbxassetid://6031265976\"",
            "local rebirthIcon = Instance.new(\"ImageButton\")",
            "rebirthIcon.Image = \"rbxassetid://6031094678\"",
            "local shopPanel = Instance.new(\"Frame\")",
            "shopPanel.Visible = false",
            "local rebirthPanel = Instance.new(\"Frame\")",
            "rebirthPanel.Visible = false",
            "local buyButton = Instance.new(\"TextButton\")",
            "buyButton.Text = \"Preview boost item\"",
            "local closeShop = Instance.new(\"TextButton\")",
            "closeShop.Text = \"Close\"",
            "closeShop.Activated:Connect(function() shopPanel.Visible = false end)",
            "local closeRebirth = Instance.new(\"TextButton\")",
            "closeRebirth.Text = \"Close\"",
            "closeRebirth.Activated:Connect(function() rebirthPanel.Visible = false end)",
            "local shopTitle = Instance.new(\"TextLabel\")",
            "shopTitle.Text = \"Shop\"",
            "local rebirthTitle = Instance.new(\"TextLabel\")",
            "rebirthTitle.Text = \"Rebirth Requirement\"",
            "shopIcon.MouseEnter:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 4}):Play() end)",
            "shopIcon.MouseLeave:Connect(function() TweenService:Create(shopIcon, TweenInfo.new(0.12), {Rotation = 0}):Play() end)",
            "shopIcon.Activated:Connect(function() shopPanel.Visible = true TweenService:Create(shopPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "rebirthIcon.Activated:Connect(function() rebirthPanel.Visible = true TweenService:Create(rebirthPanel, TweenInfo.new(0.2), {Position = UDim2.fromScale(0.5, 0.5)}):Play() end)",
            "buyButton.Activated:Connect(function() buyButton.Text = \"Preview selected\" end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(true);
  });

  it("rejects TextButtons created via Instance.new that never set .Text to a real label", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system with stamina and a small UI bar and an upgrade shop" },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/SprintHUD",
          reason: "ScreenGui container."
        },
        {
          id: "file_shop",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/ShopClient",
          reason: "Builds upgrade shop UI.",
          source: [
            "local billboard = shopPart:WaitForChild(\"BillboardGui\", 10)",
            "local btn = Instance.new(\"TextButton\")",
            "btn.Size = UDim2.new(0.9, 0, 0, 45)",
            "btn.BackgroundColor3 = Color3.fromRGB(40, 40, 40)",
            "btn.Parent = frame",
            "-- Text is only set in updateUI which depends on leaderstats",
            "local function updateUI()",
            "  btn.Text = \"Tier 1 - BUY (50 Studs)\"",
            "end"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.some(p => /TextButton.*Instance\.new.*\.Text.*default.*Button/i.test(p))).toBe(true);
  });

  it("rejects Luau scripts with undeclared variable typos like localstats instead of leaderstats", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system with stamina and a small UI bar and an upgrade shop" },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/SprintHUD",
          reason: "ScreenGui container."
        },
        {
          id: "file_server",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/GameServer",
          reason: "Server script.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local ReplicatedStorage = game:GetService(\"ReplicatedStorage\")",
            "Players.PlayerAdded:Connect(function(player)",
            "  local leaderstats = Instance.new(\"Folder\")",
            "  localstats.Name = \"leaderstats\"",
            "  localstats.Parent = player",
            "  local studs = Instance.new(\"IntValue\")",
            "  studs.Name = \"Studs\"",
            "  studs.Value = 0",
            "  studs.Parent = leaderstats",
            "end)"
          ].join("\n")
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/SprintHUD/SprintClient",
          reason: "Client sprint script.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local container = Instance.new(\"Frame\")",
            "container.Name = \"StaminaContainer\"",
            "container.Size = UDim2.new(0, 200, 0, 20)",
            "container.Parent = script.Parent",
            "local fill = Instance.new(\"Frame\")",
            "fill.Name = \"Fill\"",
            "fill.Size = UDim2.new(1, 0, 1, 0)",
            "fill.Parent = container",
            "local btn = Instance.new(\"TextButton\")",
            "btn.Text = \"Sprint\"",
            "btn.Parent = container"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.some(p => /undeclared variable.*typo/i.test(p))).toBe(true);
  });

  it("accepts Luau scripts with correctly declared variable names", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system with stamina and a small UI bar and an upgrade shop" },
      [
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/SprintHUD",
          reason: "ScreenGui container."
        },
        {
          id: "file_server",
          action: "create",
          className: "Script",
          instancePath: "ServerScriptService/GameServer",
          reason: "Server script.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "Players.PlayerAdded:Connect(function(player)",
            "  local leaderstats = Instance.new(\"Folder\")",
            "  leaderstats.Name = \"leaderstats\"",
            "  leaderstats.Parent = player",
            "  local studs = Instance.new(\"IntValue\")",
            "  studs.Name = \"Studs\"",
            "  studs.Value = 0",
            "  studs.Parent = leaderstats",
            "end)"
          ].join("\n")
        },
        {
          id: "file_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/SprintHUD/SprintClient",
          reason: "Client sprint script.",
          source: [
            "local Players = game:GetService(\"Players\")",
            "local container = Instance.new(\"Frame\")",
            "container.Name = \"StaminaContainer\"",
            "container.Size = UDim2.new(0, 200, 0, 20)",
            "container.Parent = script.Parent",
            "local fill = Instance.new(\"Frame\")",
            "fill.Name = \"Fill\"",
            "fill.Size = UDim2.new(1, 0, 1, 0)",
            "fill.Parent = container",
            "local btn = Instance.new(\"TextButton\")",
            "btn.Text = \"Sprint\"",
            "btn.Parent = container"
          ].join("\n")
        }
      ]
    );

    expect(result.blockedPatterns.every(p => !/undeclared variable.*typo/i.test(p))).toBe(true);
  });

  it("rejects interactive BillboardGuis parented directly under Workspace", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system with stamina and a small UI bar and an upgrade shop" },
      [
        {
          id: "file_billboard",
          action: "create",
          className: "BillboardGui",
          instancePath: "Workspace/UpgradeShop/BillboardGui",
          reason: "BillboardGui inside Workspace part."
        },
        {
          id: "file_button",
          action: "create",
          className: "TextButton",
          instancePath: "Workspace/UpgradeShop/BillboardGui/BuyButton",
          reason: "Interactive button inside Workspace BillboardGui."
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.some(p => /BillboardGuis containing interactive buttons.*must not be parented to Workspace parts/i.test(p))).toBe(true);
  });

  it("rejects LocalScripts that parent interactive BillboardGuis to Workspace parts", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system with stamina and a small UI bar and an upgrade shop" },
      [
        {
          id: "file_shop_client",
          action: "create",
          className: "LocalScript",
          instancePath: "StarterGui/ShopClient",
          reason: "Shop client logic.",
          source: [
            "local billboard = Instance.new(\"BillboardGui\")",
            "billboard.Parent = workspace.UpgradeShop",
            "local btn = Instance.new(\"TextButton\")",
            "btn.Text = \"Buy Speed Upgrade\"",
            "btn.Parent = billboard",
            "btn.Activated:Connect(function() print(\"buy\") end)"
          ].join("\n")
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.some(p => /BillboardGuis containing interactive buttons.*must not be parented to Workspace parts/i.test(p))).toBe(true);
  });

  it("rejects physical parts floating in Workspace with Y > 3", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add an upgrade shop" },
      [
        {
          id: "file_part",
          action: "create",
          className: "Part",
          instancePath: "Workspace/UpgradeShop",
          reason: "Floating shop kiosk.",
          properties: {
            Position: { type: "Vector3", value: [12, 4.5, 12] }
          }
        }
      ]
    );

    expect(result.ok).toBe(false);
    expect(result.blockedPatterns.some(p => /physical Workspace parts.*must be placed cleanly on or near the ground/i.test(p))).toBe(true);
  });

  it("accepts valid ground-aligned parts and ScreenGui shops", () => {
    const result = validateGeneratedExperienceQuality(
      { prompt: "Add a sprint system and an upgrade shop" },
      [
        {
          id: "file_part",
          action: "create",
          className: "Part",
          instancePath: "Workspace/UpgradeShopPad",
          reason: "Shop ground pad.",
          properties: {
            Position: { type: "Vector3", value: [12, 0.5, 12] }
          }
        },
        {
          id: "file_gui",
          action: "create",
          className: "ScreenGui",
          instancePath: "StarterGui/UpgradeShopGui",
          reason: "Screen-space shop menu."
        }
      ]
    );

    expect(result.blockedPatterns.every(p => !/physical Workspace parts.*must be placed cleanly/i.test(p))).toBe(true);
    expect(result.blockedPatterns.every(p => !/BillboardGuis containing interactive buttons/i.test(p))).toBe(true);
  });
});
