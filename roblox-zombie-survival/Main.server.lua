-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Main.server.lua  ·  Put this in ServerScriptService         ║
-- ║  Type: Script (NOT LocalScript)   Name it: Main             ║
-- ╚══════════════════════════════════════════════════════════════╝

local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService= game:GetService("MarketplaceService")
local GameConfig        = require(ReplicatedStorage:WaitForChild("GameConfig"))

-- ════════════════════════════════════════════════════════════════
-- 1. REMOTE EVENTS  (created here so the client can WaitForChild)
-- ════════════════════════════════════════════════════════════════

local function makeRemote(class, name)
	local r = Instance.new(class)
	r.Name   = name
	r.Parent = ReplicatedStorage
	return r
end

-- server → client
local evWaveStart   = makeRemote("RemoteEvent",    "WaveStart")
local evWaveEnd     = makeRemote("RemoteEvent",    "WaveEnd")
local evGameOver    = makeRemote("RemoteEvent",    "GameOver")
local evCoins       = makeRemote("RemoteEvent",    "CoinsUpdate")
local evKill        = makeRemote("RemoteEvent",    "KillFeed")
local evTick        = makeRemote("RemoteEvent",    "TimerTick")
local evPhase       = makeRemote("RemoteEvent",    "PhaseChange")
local evPlayerState = makeRemote("RemoteEvent",    "PlayerState")  -- "alive"|"dead"

-- client → server
local evBuyWeapon   = makeRemote("RemoteEvent",    "BuyWeapon")
local evBuyRevive   = makeRemote("RemoteEvent",    "BuyRevive")
local evShot        = makeRemote("RemoteEvent",    "PlayerShot")
local fnGetCoins    = makeRemote("RemoteFunction", "GetCoins")
local fnGetPhase    = makeRemote("RemoteFunction", "GetPhase")

-- ════════════════════════════════════════════════════════════════
-- 2. MAP BUILDER  (runs once at startup, builds the arena)
-- ════════════════════════════════════════════════════════════════

local ARENA = 200  -- full width/depth of the arena in studs

local function buildMap()
	-- Remove Roblox default baseplate if present
	local bp = workspace:FindFirstChild("Baseplate")
	if bp then bp:Destroy() end

	local mapFolder = Instance.new("Folder")
	mapFolder.Name   = "Map"
	mapFolder.Parent = workspace

	-- Floor
	local floor = Instance.new("Part")
	floor.Name      = "Floor"
	floor.Anchored  = true
	floor.Size      = Vector3.new(ARENA, 2, ARENA)
	floor.CFrame    = CFrame.new(0, -1, 0)
	floor.Material  = Enum.Material.SmoothPlastic
	floor.Color     = Color3.fromRGB(55, 58, 48)
	floor.Parent    = mapFolder

	-- 4 outer walls
	local walls = {
		{ size = Vector3.new(ARENA+4, 22, 4), pos = Vector3.new(0,  10, -ARENA/2-2) },
		{ size = Vector3.new(ARENA+4, 22, 4), pos = Vector3.new(0,  10,  ARENA/2+2) },
		{ size = Vector3.new(4, 22, ARENA+4), pos = Vector3.new(-ARENA/2-2, 10, 0) },
		{ size = Vector3.new(4, 22, ARENA+4), pos = Vector3.new( ARENA/2+2, 10, 0) },
	}
	for _, w in ipairs(walls) do
		local wall = Instance.new("Part")
		wall.Anchored  = true
		wall.Size      = w.size
		wall.CFrame    = CFrame.new(w.pos)
		wall.Material  = Enum.Material.SmoothPlastic
		wall.Color     = Color3.fromRGB(75, 75, 85)
		wall.Parent    = mapFolder
	end

	-- Cover boxes scattered around the arena
	local coverSpots = {
		{35,0,0}, {-35,0,0}, {0,0,35}, {0,0,-35},
		{22,0,22}, {-22,0,22}, {22,0,-22}, {-22,0,-22},
		{55,0,18}, {-55,0,-18}, {18,0,55}, {-18,0,-55},
		{50,0,-40}, {-50,0,40},
	}
	for _, c in ipairs(coverSpots) do
		local box = Instance.new("Part")
		box.Anchored  = true
		box.Size      = Vector3.new(math.random(6,12), math.random(5,8), math.random(6,12))
		box.CFrame    = CFrame.new(c[1], box.Size.Y/2, c[3])
		box.Material  = Enum.Material.Concrete
		box.Color     = Color3.fromRGB(95, 85, 75)
		box.Parent    = mapFolder
	end

	-- Zombie spawn points: 12 positions around the arena edge (just inside the walls)
	local spawnsFolder = Instance.new("Folder")
	spawnsFolder.Name   = "ZombieSpawns"
	spawnsFolder.Parent = workspace

	local r = ARENA/2 - 6
	for i = 1, 12 do
		local a = (i-1) * (math.pi*2/12)
		local sp = Instance.new("Part")
		sp.Anchored     = true
		sp.CanCollide   = false
		sp.Transparency = 1
		sp.Size         = Vector3.new(4,1,4)
		sp.CFrame       = CFrame.new(math.cos(a)*r, 2, math.sin(a)*r)
		sp.Parent       = spawnsFolder
	end

	-- Player spawn at center
	local spawn = Instance.new("SpawnLocation")
	spawn.Name     = "SpawnLocation"
	spawn.Anchored = true
	spawn.Neutral  = true
	spawn.Size     = Vector3.new(8, 1, 8)
	spawn.CFrame   = CFrame.new(0, 1, 0)
	spawn.Color    = BrickColor.new("Bright blue")
	spawn.Material = Enum.Material.SmoothPlastic
	spawn.Parent   = workspace

	-- Nice lighting
	game.Lighting.Brightness    = 1.2
	game.Lighting.ClockTime     = 20   -- night
	game.Lighting.FogEnd        = 400
	game.Lighting.FogColor      = Color3.fromRGB(100, 100, 120)
	game.Lighting.Ambient       = Color3.fromRGB(50, 50, 70)
	game.Lighting.OutdoorAmbient= Color3.fromRGB(60, 60, 80)

	print("[Map] Arena built.")
end

buildMap()

-- ════════════════════════════════════════════════════════════════
-- 3. COIN SYSTEM  (server-authoritative)
-- ════════════════════════════════════════════════════════════════

local playerCoins = {}  -- [userId] = amount

local function getCoins(player)
	return playerCoins[player.UserId] or GameConfig.START_COINS
end

local function syncCoins(player)
	evCoins:FireClient(player, getCoins(player))
	local ls = player:FindFirstChild("leaderstats")
	if ls then
		local cv = ls:FindFirstChild("Coins")
		if cv then cv.Value = getCoins(player) end
	end
end

local function setCoins(player, amount)
	playerCoins[player.UserId] = math.max(0, math.floor(amount))
	syncCoins(player)
end

local function addCoins(player, amount)
	setCoins(player, getCoins(player) + amount)
end

local function spendCoins(player, amount)
	if getCoins(player) < amount then return false end
	setCoins(player, getCoins(player) - amount)
	return true
end

fnGetCoins.OnServerInvoke = function(player)
	return getCoins(player)
end

-- ════════════════════════════════════════════════════════════════
-- 4. WEAPON TOOLS
-- ════════════════════════════════════════════════════════════════

local function buildTool(weaponName)
	local cfg  = GameConfig.WEAPONS[weaponName]
	local col  = GameConfig.WEAPON_COLORS[weaponName] or Color3.fromRGB(50,50,50)

	local tool = Instance.new("Tool")
	tool.Name           = weaponName
	tool.RequiresHandle = true
	tool.ToolTip        = weaponName .. "  ($" .. cfg.cost .. ")"

	local handle = Instance.new("Part")
	handle.Name     = "Handle"
	handle.Size     = Vector3.new(0.35, 1.3, 0.5)
	handle.Color    = col
	handle.Material = Enum.Material.SmoothPlastic
	handle.Parent   = tool

	-- Store stats as NumberValues so the client can read them
	for k, v in pairs(cfg) do
		if type(v) == "number" then
			local nv = Instance.new("NumberValue")
			nv.Name  = k
			nv.Value = v
			nv.Parent = tool
		end
	end
	local wt = Instance.new("StringValue")
	wt.Name  = "WeaponType"
	wt.Value = weaponName
	wt.Parent = tool

	return tool
end

local function giveWeapon(player, weaponName)
	-- Remove existing copy so inventory doesn't stack
	local bp = player.Backpack
	local existing = bp:FindFirstChild(weaponName)
	if existing then existing:Destroy() end
	local char = player.Character
	if char then
		local held = char:FindFirstChild(weaponName)
		if held then held:Destroy() end
	end
	local tool = buildTool(weaponName)
	tool.Parent = bp
end

local function giveStarterLoadout(player)
	giveWeapon(player, "Pistol")

	-- Gamepass: free Rifle
	if GameConfig.GAMEPASSES.StarterRifle ~= 0 then
		local ok, has = pcall(function()
			return MarketplaceService:UserOwnsGamePassAsync(player.UserId, GameConfig.GAMEPASSES.StarterRifle)
		end)
		if ok and has then giveWeapon(player, "Rifle") end
	end
end

-- ════════════════════════════════════════════════════════════════
-- 5. PLAYER SETUP & LEADERBOARD
-- ════════════════════════════════════════════════════════════════

Players.PlayerAdded:Connect(function(player)
	playerCoins[player.UserId] = GameConfig.START_COINS

	-- Leaderboard (shows in the Roblox tab leaderboard)
	local ls = Instance.new("Folder")
	ls.Name   = "leaderstats"
	ls.Parent = player

	local waveVal = Instance.new("IntValue")
	waveVal.Name  = "Wave"
	waveVal.Value = 0
	waveVal.Parent = ls

	local killsVal = Instance.new("IntValue")
	killsVal.Name  = "Kills"
	killsVal.Value = 0
	killsVal.Parent = ls

	local coinsVal = Instance.new("IntValue")
	coinsVal.Name  = "Coins"
	coinsVal.Value = GameConfig.START_COINS
	coinsVal.Parent = ls

	player.CharacterAdded:Connect(function(char)
		task.wait(0.5)  -- brief wait for character to fully load
		giveStarterLoadout(player)
		syncCoins(player)
		evPlayerState:FireClient(player, "alive")
		evPhase:FireClient(player, currentPhase, currentWave)
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	playerCoins[player.UserId] = nil
end)

-- ════════════════════════════════════════════════════════════════
-- 6. ZOMBIE SYSTEM
-- ════════════════════════════════════════════════════════════════

local zombiesAlive    = {}   -- [model] = true
local spawningDone    = false

local function getSpawnCFrame()
	local sf = workspace:FindFirstChild("ZombieSpawns")
	if sf then
		local parts = sf:GetChildren()
		if #parts > 0 then
			return parts[math.random(1, #parts)].CFrame + Vector3.new(0, 4, 0)
		end
	end
	local a = math.random() * math.pi * 2
	return CFrame.new(math.cos(a)*90, 4, math.sin(a)*90)
end

local function spawnZombie(zombieType, waveNum)
	local cfg   = GameConfig.ZOMBIES[zombieType]
	-- Health scales +12% per wave
	local hpMod = 1 + (waveNum - 1) * 0.12
	local maxHp = math.floor(cfg.health * hpMod)

	-- ── Build model ──────────────────────────────────────────────
	local model    = Instance.new("Model")
	model.Name     = zombieType

	-- Invisible root (physics driver)
	local hrp = Instance.new("Part")
	hrp.Name         = "HumanoidRootPart"
	hrp.Size         = Vector3.new(2, 2, 1)
	hrp.Transparency = 1
	hrp.CanCollide   = false
	hrp.CFrame       = getSpawnCFrame()
	hrp.Parent       = model

	-- Visible torso
	local torso = Instance.new("Part")
	torso.Name     = "Torso"
	torso.Size     = Vector3.new(2, 2.2, 1)
	torso.Color    = cfg.color
	torso.Material = Enum.Material.SmoothPlastic
	torso.CFrame   = hrp.CFrame
	torso.Parent   = model

	local w1 = Instance.new("WeldConstraint")
	w1.Part0  = hrp
	w1.Part1  = torso
	w1.Parent = hrp

	-- Head
	local head = Instance.new("Part")
	head.Name     = "Head"
	head.Size     = Vector3.new(1.8, 1.8, 1.8)
	head.Color    = cfg.color:Lerp(Color3.fromRGB(230, 190, 160), 0.35)
	head.Material = Enum.Material.SmoothPlastic
	head.CFrame   = hrp.CFrame * CFrame.new(0, 2.1, 0)
	head.Parent   = model

	local w2 = Instance.new("WeldConstraint")
	w2.Part0  = torso
	w2.Part1  = head
	w2.Parent = torso

	-- Left & right legs
	for side = -1, 1, 2 do
		local leg = Instance.new("Part")
		leg.Name     = "Leg" .. (side == -1 and "L" or "R")
		leg.Size     = Vector3.new(0.9, 2, 0.9)
		leg.Color    = cfg.color:Lerp(Color3.fromRGB(20,20,20), 0.3)
		leg.Material = Enum.Material.SmoothPlastic
		leg.CFrame   = hrp.CFrame * CFrame.new(side * 0.55, -2, 0)
		leg.Parent   = model
		local wl = Instance.new("WeldConstraint")
		wl.Part0  = torso
		wl.Part1  = leg
		wl.Parent = torso
	end

	-- Zombie type tag (for server hit-validation)
	local tag = Instance.new("StringValue")
	tag.Name  = "ZombieType"
	tag.Value = zombieType
	tag.Parent = model

	-- ── HP bar (BillboardGui, visible to all players) ─────────────
	local bbGui = Instance.new("BillboardGui")
	bbGui.Size        = UDim2.new(0, 90, 0, 10)
	bbGui.StudsOffset = Vector3.new(0, 4, 0)
	bbGui.AlwaysOnTop = false
	bbGui.Parent      = hrp

	local bg = Instance.new("Frame")
	bg.Size                   = UDim2.new(1,0,1,0)
	bg.BackgroundColor3       = Color3.fromRGB(35,35,35)
	bg.BorderSizePixel        = 0
	bg.Parent                 = bbGui

	local fill = Instance.new("Frame")
	fill.Name             = "Fill"
	fill.Size             = UDim2.new(1,0,1,0)
	fill.BackgroundColor3 = Color3.fromRGB(50, 210, 50)
	fill.BorderSizePixel  = 0
	fill.Parent           = bg

	local nameLbl = Instance.new("TextLabel")
	nameLbl.Size                   = UDim2.new(1,0,0,13)
	nameLbl.Position               = UDim2.new(0,0,-1.4,0)
	nameLbl.BackgroundTransparency = 1
	nameLbl.TextColor3             = Color3.fromRGB(255, 80, 80)
	nameLbl.Font                   = Enum.Font.GothamBold
	nameLbl.TextSize               = 12
	nameLbl.Text                   = zombieType
	nameLbl.Parent                 = bbGui

	-- ── Humanoid ──────────────────────────────────────────────────
	local hum = Instance.new("Humanoid")
	hum.MaxHealth = maxHp
	hum.Health    = maxHp
	hum.WalkSpeed = cfg.speed
	hum.Parent    = model

	model.PrimaryPart = hrp
	model.Parent      = workspace

	zombiesAlive[model] = true

	-- Update HP bar colour
	hum.HealthChanged:Connect(function(hp)
		local pct = hp / hum.MaxHealth
		fill.Size = UDim2.new(pct, 0, 1, 0)
		if pct < 0.3 then
			fill.BackgroundColor3 = Color3.fromRGB(210, 50, 50)
		elseif pct < 0.6 then
			fill.BackgroundColor3 = Color3.fromRGB(210, 190, 40)
		end
	end)

	-- Death handler
	hum.Died:Connect(function()
		zombiesAlive[model] = nil

		for _, plr in ipairs(Players:GetPlayers()) do
			local char   = plr.Character
			local plrHum = char and char:FindFirstChildOfClass("Humanoid")
			if plrHum and plrHum.Health > 0 then
				local reward = cfg.reward

				-- Double-coins gamepass check
				if GameConfig.GAMEPASSES.DoubleCoins ~= 0 then
					local ok, has = pcall(function()
						return MarketplaceService:UserOwnsGamePassAsync(plr.UserId, GameConfig.GAMEPASSES.DoubleCoins)
					end)
					if ok and has then reward = reward * 2 end
				end

				addCoins(plr, reward)
				evKill:FireClient(plr, zombieType, reward)

				local ls = plr:FindFirstChild("leaderstats")
				if ls then
					local kv = ls:FindFirstChild("Kills")
					if kv then kv.Value += 1 end
				end
			end
		end

		task.delay(1.5, function()
			if model and model.Parent then model:Destroy() end
		end)
	end)

	-- ── AI: chase + melee ─────────────────────────────────────────
	task.spawn(function()
		local lastAtk = 0
		while model.Parent and hum.Health > 0 do
			local nearPos, nearChar, nearDist = nil, nil, math.huge

			for _, plr in ipairs(Players:GetPlayers()) do
				local c = plr.Character
				local p = c and c:FindFirstChild("HumanoidRootPart")
				if p then
					local d = (p.Position - hrp.Position).Magnitude
					if d < nearDist then
						nearDist  = d
						nearPos   = p.Position
						nearChar  = c
					end
				end
			end

			if nearPos then
				hum:MoveTo(nearPos)

				if nearDist <= 5 then
					local now = tick()
					if now - lastAtk >= GameConfig.ATTACK_COOLDOWN then
						lastAtk = now
						local ph = nearChar and nearChar:FindFirstChildOfClass("Humanoid")
						if ph and ph.Health > 0 then
							ph:TakeDamage(cfg.damage)
						end
					end
				end
			end

			task.wait(0.25)
		end
	end)
end

-- ════════════════════════════════════════════════════════════════
-- 7. SHOP PURCHASES
-- ════════════════════════════════════════════════════════════════

evBuyWeapon.OnServerEvent:Connect(function(player, weaponName)
	local cfg = GameConfig.WEAPONS[weaponName]
	if not cfg then return end
	if not spendCoins(player, cfg.cost) then return end
	giveWeapon(player, weaponName)
end)

evBuyRevive.OnServerEvent:Connect(function(player)
	if not spendCoins(player, GameConfig.REVIVE_COST) then return end
	player:LoadCharacter()
	-- CharacterAdded fires → giveStarterLoadout is called automatically
end)

-- ════════════════════════════════════════════════════════════════
-- 8. DAMAGE HANDLER  (server-authoritative, validated)
-- ════════════════════════════════════════════════════════════════

local lastShotTime = {}

evShot.OnServerEvent:Connect(function(player, zombieModel, weaponName)
	local wcfg = GameConfig.WEAPONS[weaponName]
	if not wcfg then return end

	-- Fire-rate validation: reject shots faster than weapon allows
	local uid = player.UserId
	local now = tick()
	if lastShotTime[uid] and (now - lastShotTime[uid]) < (1/wcfg.fireRate * 0.75) then return end
	lastShotTime[uid] = now

	-- Zombie must be real and alive
	if not zombieModel or not zombieModel.Parent then return end
	if not zombieModel:FindFirstChild("ZombieType") then return end
	local hum = zombieModel:FindFirstChildOfClass("Humanoid")
	if not hum or hum.Health <= 0 then return end

	-- Player must have the weapon equipped or in backpack
	local char = player.Character
	if not char then return end
	if not char:FindFirstChild(weaponName) and not player.Backpack:FindFirstChild(weaponName) then return end

	-- Range check (+ 12 stud latency tolerance)
	local pHrp = char:FindFirstChild("HumanoidRootPart")
	local zHrp = zombieModel:FindFirstChild("HumanoidRootPart")
	if not pHrp or not zHrp then return end
	if (zHrp.Position - pHrp.Position).Magnitude > wcfg.range + 12 then return end

	hum:TakeDamage(wcfg.damage)
end)

-- ════════════════════════════════════════════════════════════════
-- 9. MAIN GAME LOOP
-- ════════════════════════════════════════════════════════════════

currentPhase = "waiting"
currentWave  = 0

fnGetPhase.OnServerInvoke = function()
	return currentPhase, currentWave
end

local function allZombiesDead()
	if not spawningDone then return false end
	for _ in pairs(zombiesAlive) do return false end
	return true
end

local function anyPlayerAlive()
	for _, plr in ipairs(Players:GetPlayers()) do
		local c = plr.Character
		local h = c and c:FindFirstChildOfClass("Humanoid")
		if h and h.Health > 0 then return true end
	end
	return false
end

local function countdown(seconds)
	for i = seconds, 1, -1 do
		evTick:FireAllClients(i)
		task.wait(1)
	end
	evTick:FireAllClients(0)
end

local function doWave(waveNum)
	currentPhase = "wave"
	currentWave  = waveNum
	zombiesAlive = {}
	spawningDone = false

	-- Update wave leaderstat
	for _, plr in ipairs(Players:GetPlayers()) do
		local ls = plr:FindFirstChild("leaderstats")
		if ls then
			local wv = ls:FindFirstChild("Wave")
			if wv then wv.Value = math.max(wv.Value, waveNum) end
		end
	end

	-- Figure out which wave definition to use (repeat last wave for wave>10)
	local waveIndex = math.min(waveNum, #GameConfig.WAVES)
	local waveDef   = GameConfig.WAVES[waveIndex]

	-- Past wave 10: scale counts by 30% per extra wave
	local countScale = 1 + math.max(0, waveNum - #GameConfig.WAVES) * 0.3

	-- Count total zombies so the client can show "X remaining"
	local total = 0
	for _, entry in ipairs(waveDef) do
		total += math.ceil(entry.count * countScale)
	end

	evWaveStart:FireAllClients(waveNum, total)
	evPhase:FireAllClients("wave", waveNum)

	-- Spawn all zombies (staggered)
	task.spawn(function()
		for _, entry in ipairs(waveDef) do
			local count = math.ceil(entry.count * countScale)
			for _ = 1, count do
				spawnZombie(entry.type, waveNum)
				task.wait(GameConfig.SPAWN_DELAY)
			end
		end
		spawningDone = true
	end)

	-- Wait for wave to end
	repeat task.wait(0.5) until allZombiesDead() or not anyPlayerAlive()
end

local function resetGame()
	currentWave = 0
	zombiesAlive = {}
	spawningDone = false

	-- Kill any leftover zombies from workspace
	for _, obj in ipairs(workspace:GetChildren()) do
		if obj:IsA("Model") and GameConfig.ZOMBIES[obj.Name] then
			obj:Destroy()
		end
	end

	for _, plr in ipairs(Players:GetPlayers()) do
		playerCoins[plr.UserId] = GameConfig.START_COINS
		pcall(function() plr:LoadCharacter() end)
		local ls = plr:FindFirstChild("leaderstats")
		if ls then
			local kv = ls:FindFirstChild("Kills")
			if kv then kv.Value = 0 end
			local wv = ls:FindFirstChild("Wave")
			if wv then wv.Value = 0 end
			local cv = ls:FindFirstChild("Coins")
			if cv then cv.Value = GameConfig.START_COINS end
		end
	end
end

local function runGameLoop()
	while true do
		-- ── Wait for at least 1 player ──────────────────────────
		if #Players:GetPlayers() == 0 then
			currentPhase = "waiting"
			evPhase:FireAllClients("waiting", 0)
			repeat task.wait(1) until #Players:GetPlayers() > 0
		end

		-- ── Pre-wave countdown ───────────────────────────────────
		currentPhase = "countdown"
		evPhase:FireAllClients("countdown", currentWave + 1)
		countdown(GameConfig.PRE_WAVE_TIME)

		if #Players:GetPlayers() == 0 then continue end

		-- ── Run the wave ─────────────────────────────────────────
		currentWave += 1
		doWave(currentWave)

		-- ── Check if everyone died ───────────────────────────────
		if not anyPlayerAlive() then
			evGameOver:FireAllClients(currentWave)
			task.wait(8)
			resetGame()
			continue
		end

		-- ── Wave-clear coin bonus ────────────────────────────────
		for _, plr in ipairs(Players:GetPlayers()) do
			local c = plr.Character
			local h = c and c:FindFirstChildOfClass("Humanoid")
			if h and h.Health > 0 then
				addCoins(plr, GameConfig.COINS_PER_WAVE + currentWave * 5)
			end
		end

		evWaveEnd:FireAllClients(currentWave)

		-- ── Shop phase ───────────────────────────────────────────
		currentPhase = "shop"
		evPhase:FireAllClients("shop", currentWave)
		countdown(GameConfig.SHOP_TIME)
	end
end

-- Start loop when first player joins (with a 5-second grace period to load in)
local loopStarted = false
Players.PlayerAdded:Connect(function()
	if not loopStarted then
		loopStarted = true
		task.delay(5, runGameLoop)
	end
end)

-- Handle players who are already in the server when the script loads
if #Players:GetPlayers() > 0 and not loopStarted then
	loopStarted = true
	task.delay(5, runGameLoop)
end
