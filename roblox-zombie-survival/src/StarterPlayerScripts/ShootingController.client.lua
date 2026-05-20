-- StarterPlayerScripts/ShootingController.client.lua
-- Handles shooting: click to fire raycasts, ammo tracking, reload

local Players           = game:GetService("Players")
local UserInputService  = game:GetService("UserInputService")
local RunService        = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local RE         = require(ReplicatedStorage:WaitForChild("RemoteEvents"))
local GameConfig = require(ReplicatedStorage:WaitForChild("GameConfig"))

local player   = Players.LocalPlayer
local camera   = workspace.CurrentCamera
local mouse    = player:GetMouse()

-- State per equipped weapon
local equipped   = nil   -- current Tool
local ammo       = 0
local maxAmmo    = 0
local reloading  = false
local lastShot   = 0
local fireRate   = 1

local ammoLabel  = nil   -- set by HUD script via shared BindableEvent (or just read here)

-- ── Equip / unequip ───────────────────────────────────────────────────────────

local function onEquip(tool)
	local cfg = GameConfig.WEAPONS[tool.Name]
	if not cfg then return end
	equipped  = tool
	fireRate  = cfg.fireRate
	maxAmmo   = cfg.ammo
	ammo      = cfg.ammo
	reloading = false
end

local function onUnequip()
	equipped = nil
end

local function watchBackpack()
	local char = player.Character or player.CharacterAdded:Wait()
	for _, tool in ipairs(char:GetChildren()) do
		if tool:IsA("Tool") then
			tool.Equipped:Connect(function()   onEquip(tool)   end)
			tool.Unequipped:Connect(function() onUnequip()     end)
		end
	end
	player.Backpack.ChildAdded:Connect(function(item)
		if item:IsA("Tool") then
			item.Equipped:Connect(function()   onEquip(item)   end)
			item.Unequipped:Connect(function() onUnequip()     end)
		end
	end)
end

player.CharacterAdded:Connect(watchBackpack)
if player.Character then watchBackpack() end

-- ── Reload ────────────────────────────────────────────────────────────────────

local function reload()
	if reloading or not equipped then return end
	local cfg = GameConfig.WEAPONS[equipped.Name]
	if not cfg then return end
	reloading = true
	task.wait(cfg.reloadTime)
	ammo      = maxAmmo
	reloading = false
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.R then reload() end
end)

-- ── Shoot ─────────────────────────────────────────────────────────────────────

local function shoot()
	if not equipped then return end
	if reloading then return end
	if ammo <= 0 then
		reload()
		return
	end

	local now = tick()
	if now - lastShot < 1 / fireRate then return end
	lastShot = now

	ammo = ammo - 1
	if ammo <= 0 then reload() end

	local cfg = GameConfig.WEAPONS[equipped.Name]

	-- Raycast from camera through mouse position
	local unitRay = camera:ScreenPointToRay(mouse.X, mouse.Y)
	local raycastParams = RaycastParams.new()
	raycastParams.FilterDescendantsInstances = { player.Character }
	raycastParams.FilterType = Enum.RaycastFilterType.Exclude

	local result = workspace:Raycast(unitRay.Origin, unitRay.Direction * cfg.range, raycastParams)

	if result then
		local hit  = result.Instance
		local model = hit:FindFirstAncestorOfClass("Model")
		if model and model:FindFirstChildOfClass("Humanoid") then
			local zombieType = model:FindFirstChild("ZombieType")
			if zombieType then
				RE.PlayerShot:FireServer(model, equipped.Name)
			end
		end

		-- Visual bullet trail
		local attachment0 = Instance.new("Attachment")
		local attachment1 = Instance.new("Attachment")
		attachment0.WorldPosition = unitRay.Origin
		attachment1.WorldPosition = result.Position
		attachment0.Parent = workspace.Terrain
		attachment1.Parent = workspace.Terrain

		local beam = Instance.new("Beam")
		beam.Attachment0 = attachment0
		beam.Attachment1 = attachment1
		beam.Width0      = 0.05
		beam.Width1      = 0.05
		beam.LightEmission = 1
		beam.Color       = ColorSequence.new(Color3.fromRGB(255, 255, 100))
		beam.Parent      = workspace.Terrain

		task.delay(0.05, function()
			beam:Destroy()
			attachment0:Destroy()
			attachment1:Destroy()
		end)
	end
end

mouse.Button1Down:Connect(shoot)

-- ── Server-side damage application ───────────────────────────────────────────
-- The server handles damage in response to RE.PlayerShot to stay authoritative.
-- This is wired in GameManager via:
--   RE.PlayerShot.OnServerEvent:Connect(function(player, zombieModel, weaponName) ... end)
-- Added here as a comment so you know where to look.
