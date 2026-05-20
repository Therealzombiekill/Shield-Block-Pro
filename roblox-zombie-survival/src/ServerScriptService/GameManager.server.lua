-- ServerScriptService/GameManager.server.lua
-- Owns the round loop: intermission -> wave -> shop -> repeat

local Players         = game:GetService("Players")
local RunService      = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage:WaitForChild("GameConfig"))
local RE         = require(ReplicatedStorage:WaitForChild("RemoteEvents"))

-- Player coin ledger (server-authoritative)
local coins = {}   -- [userId] = number

local function getCoins(player)
	return coins[player.UserId] or 0
end

local function addCoins(player, amount)
	coins[player.UserId] = getCoins(player) + amount
	RE.CoinsUpdated:FireClient(player, coins[player.UserId])
end

local function spendCoins(player, amount)
	if getCoins(player) < amount then return false end
	coins[player.UserId] = getCoins(player) - amount
	RE.CoinsUpdated:FireClient(player, coins[player.UserId])
	return true
end

RE.GetCoins.OnServerInvoke = function(player)
	return getCoins(player)
end

Players.PlayerAdded:Connect(function(player)
	coins[player.UserId] = GameConfig.START_COINS
	player.CharacterAdded:Connect(function(char)
		RE.CoinsUpdated:FireClient(player, getCoins(player))
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	coins[player.UserId] = nil
end)

-- ── Zombie tracking ──────────────────────────────────────────────────────────

local activeZombies = {}   -- set of zombie Models currently alive

local function allZombiesDead()
	for _ in pairs(activeZombies) do return false end
	return true
end

-- ── Spawn helpers ─────────────────────────────────────────────────────────────

local spawnFolder = workspace:FindFirstChild("ZombieSpawns")   -- Folder of SpawnPart parts in the map

local function randomSpawnCFrame()
	if spawnFolder then
		local parts = spawnFolder:GetChildren()
		if #parts > 0 then
			local part = parts[math.random(1, #parts)]
			return part.CFrame + Vector3.new(0, 5, 0)
		end
	end
	-- Fallback: random edge of a 200-stud arena
	local angle = math.random() * math.pi * 2
	local radius = 90
	return CFrame.new(math.cos(angle) * radius, 5, math.sin(angle) * radius)
end

local function buildZombie(zombieType)
	local cfg = GameConfig.ZOMBIES[zombieType]

	local model = Instance.new("Model")
	model.Name  = zombieType

	local hrp = Instance.new("Part")
	hrp.Name      = "HumanoidRootPart"
	hrp.Size      = Vector3.new(2, 2, 1)
	hrp.CFrame    = randomSpawnCFrame()
	hrp.BrickColor= BrickColor.new(cfg.color)
	hrp.Anchored  = false
	hrp.Parent    = model

	local torso = Instance.new("Part")
	torso.Name   = "Torso"
	torso.Size   = Vector3.new(2, 2, 1)
	torso.BrickColor = BrickColor.new(cfg.color)
	torso.Parent = model

	local head = Instance.new("Part")
	head.Name    = "Head"
	head.Size    = Vector3.new(1.5, 1.5, 1.5)
	head.BrickColor = BrickColor.new(cfg.color)
	head.Parent  = model

	local hum = Instance.new("Humanoid")
	hum.MaxHealth   = cfg.health
	hum.Health      = cfg.health
	hum.WalkSpeed   = cfg.speed
	hum.DisplayName = zombieType
	hum.Parent       = model

	-- Store metadata on model
	local meta = Instance.new("StringValue")
	meta.Name  = "ZombieType"
	meta.Value = zombieType
	meta.Parent = model

	model.PrimaryPart = hrp
	model.Parent = workspace

	-- Track alive zombies
	activeZombies[model] = true

	-- Reward players on death
	hum.Died:Connect(function()
		activeZombies[model] = nil
		-- Give coins to all living players (simple broadcast reward)
		for _, player in ipairs(Players:GetPlayers()) do
			if player.Character and player.Character:FindFirstChild("Humanoid")
				and player.Character.Humanoid.Health > 0 then
				addCoins(player, cfg.reward)
				RE.ZombieKilled:FireClient(player, zombieType, cfg.reward)
			end
		end
		task.delay(1, function() model:Destroy() end)
	end)

	return model
end

local function spawnWaveZombies(waveNumber)
	local waveDef = GameConfig.WAVES[waveNumber]
	if not waveDef then
		-- Beyond defined waves: scale up wave 10 indefinitely
		waveDef = GameConfig.WAVES[10]
	end

	for _, entry in ipairs(waveDef) do
		for i = 1, entry.count do
			buildZombie(entry.type)
			task.wait(0.3)   -- stagger spawns slightly
		end
	end
end

-- ── Zombie AI (basic chase) ───────────────────────────────────────────────────

-- Each zombie finds the nearest player and walks toward them.
-- Damage is handled by the Humanoid TouchEnded / a proximity check loop.

local function startZombieAI()
	RunService.Heartbeat:Connect(function()
		for zombie in pairs(activeZombies) do
			local hum = zombie:FindFirstChildOfClass("Humanoid")
			local hrp = zombie:FindFirstChild("HumanoidRootPart")
			if not hum or not hrp or hum.Health <= 0 then continue end

			-- Find nearest player character
			local nearest, nearestDist = nil, math.huge
			for _, player in ipairs(Players:GetPlayers()) do
				local char = player.Character
				if char then
					local pHrp = char:FindFirstChild("HumanoidRootPart")
					if pHrp then
						local dist = (pHrp.Position - hrp.Position).Magnitude
						if dist < nearestDist then
							nearest     = pHrp
							nearestDist = dist
						end
					end
				end
			end

			if nearest then
				hum:MoveTo(nearest.Position)

				-- Melee attack when close
				if nearestDist <= 5 then
					local zombieType = zombie:FindFirstChild("ZombieType")
					local dmg = zombieType and GameConfig.ZOMBIES[zombieType.Value].damage or 10

					local playerChar = nearest.Parent
					local playerHum  = playerChar and playerChar:FindFirstChildOfClass("Humanoid")
					if playerHum and playerHum.Health > 0 then
						playerHum:TakeDamage(dmg)
					end
				end
			end
		end
	end)
end

startZombieAI()

-- ── Shop / revive purchases ───────────────────────────────────────────────────

RE.BuyWeapon.OnServerEvent:Connect(function(player, weaponName)
	local weaponCfg = GameConfig.WEAPONS[weaponName]
	if not weaponCfg then return end
	if not spendCoins(player, weaponCfg.cost) then return end

	-- Give the player a Tool in their backpack
	local tool = Instance.new("Tool")
	tool.Name = weaponName
	tool.RequiresHandle = false

	-- Store weapon stats as values inside the tool (client reads these)
	for key, val in pairs(weaponCfg) do
		if type(val) == "number" then
			local v = Instance.new("NumberValue")
			v.Name  = key
			v.Value = val
			v.Parent = tool
		end
	end

	tool.Parent = player.Backpack
end)

RE.BuyRevive.OnServerEvent:Connect(function(player)
	if not spendCoins(player, GameConfig.REVIVE_COST) then return end
	player:LoadCharacter()
end)

-- ── Main round loop ───────────────────────────────────────────────────────────

local currentWave = 0

local function countdown(seconds, label)
	for i = seconds, 1, -1 do
		RE.CountdownTick:FireAllClients(i)
		task.wait(1)
	end
end

local function runGame()
	while true do
		currentWave = currentWave + 1

		-- Announce wave
		RE.WaveStarted:FireAllClients(currentWave)
		print("[GameManager] Wave", currentWave, "starting")

		spawnWaveZombies(currentWave)

		-- Wait until all zombies are dead OR all players are dead
		repeat task.wait(1) until allZombiesDead() or #Players:GetPlayers() == 0

		-- Wave cleared
		RE.WaveEnded:FireAllClients(currentWave, not allZombiesDead())

		-- Wave-clear coin bonus
		for _, player in ipairs(Players:GetPlayers()) do
			local char = player.Character
			local hum  = char and char:FindFirstChildOfClass("Humanoid")
			if hum and hum.Health > 0 then
				addCoins(player, GameConfig.COINS_PER_WAVE + currentWave * 5)
			end
		end

		if #Players:GetPlayers() == 0 then break end

		-- Shop intermission
		print("[GameManager] Shop phase -", GameConfig.BETWEEN_WAVES, "seconds")
		countdown(GameConfig.BETWEEN_WAVES, "Next wave in")
	end
end

-- Wait for the first player then start
Players.PlayerAdded:Connect(function()
	if currentWave == 0 then
		task.delay(5, runGame)   -- 5-second grace period for others to join
	end
end)
