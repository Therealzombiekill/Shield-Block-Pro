-- ServerScriptService/DamageHandler.server.lua
-- Receives PlayerShot events and applies server-authoritative damage

local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage:WaitForChild("GameConfig"))
local RE         = require(ReplicatedStorage:WaitForChild("RemoteEvents"))

-- Simple per-player cooldown to prevent shot-spam exploits
local lastShotTime = {}   -- [userId] = tick()

RE.PlayerShot.OnServerEvent:Connect(function(player, zombieModel, weaponName)
	local cfg = GameConfig.WEAPONS[weaponName]
	if not cfg then return end

	-- Rate-limit: player cannot shoot faster than weapon's fireRate allows
	local now = tick()
	local userId = player.UserId
	local minInterval = 1 / cfg.fireRate - 0.05   -- 50ms tolerance
	if lastShotTime[userId] and (now - lastShotTime[userId]) < minInterval then
		return
	end
	lastShotTime[userId] = now

	-- Validate the zombie is real and alive
	if not zombieModel or not zombieModel.Parent then return end
	local zombieType = zombieModel:FindFirstChild("ZombieType")
	if not zombieType then return end
	local hum = zombieModel:FindFirstChildOfClass("Humanoid")
	if not hum or hum.Health <= 0 then return end

	-- Validate the player actually has the weapon equipped
	local char = player.Character
	if not char then return end
	local tool = char:FindFirstChild(weaponName)
	if not tool then return end

	-- Range check: zombie must be within weapon range of the player
	local playerHRP = char:FindFirstChild("HumanoidRootPart")
	local zombieHRP = zombieModel:FindFirstChild("HumanoidRootPart")
	if not playerHRP or not zombieHRP then return end
	if (zombieHRP.Position - playerHRP.Position).Magnitude > cfg.range + 5 then
		return   -- extra 5 studs of tolerance for latency
	end

	hum:TakeDamage(cfg.damage)
end)
