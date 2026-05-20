-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Client.client.lua  ·  Put in StarterPlayer>StarterPlayerScripts ║
-- ║  Type: LocalScript   Name it: Client                        ║
-- ╚══════════════════════════════════════════════════════════════╝

local Players           = game:GetService("Players")
local UserInputService  = game:GetService("UserInputService")
local TweenService      = game:GetService("TweenService")
local RunService        = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local mouse  = player:GetMouse()
local camera = workspace.CurrentCamera

-- ── Wait for server to create remotes ────────────────────────────────────────
local GameConfig = require(ReplicatedStorage:WaitForChild("GameConfig"))

local RE = {
	WaveStart   = ReplicatedStorage:WaitForChild("WaveStart"),
	WaveEnd     = ReplicatedStorage:WaitForChild("WaveEnd"),
	GameOver    = ReplicatedStorage:WaitForChild("GameOver"),
	CoinsUpdate = ReplicatedStorage:WaitForChild("CoinsUpdate"),
	KillFeed    = ReplicatedStorage:WaitForChild("KillFeed"),
	TimerTick   = ReplicatedStorage:WaitForChild("TimerTick"),
	PhaseChange = ReplicatedStorage:WaitForChild("PhaseChange"),
	PlayerState = ReplicatedStorage:WaitForChild("PlayerState"),
	BuyWeapon   = ReplicatedStorage:WaitForChild("BuyWeapon"),
	BuyRevive   = ReplicatedStorage:WaitForChild("BuyRevive"),
	PlayerShot  = ReplicatedStorage:WaitForChild("PlayerShot"),
	GetCoins    = ReplicatedStorage:WaitForChild("GetCoins"),
	GetPhase    = ReplicatedStorage:WaitForChild("GetPhase"),
}

-- ════════════════════════════════════════════════════════════════
-- BUILD ALL UI PROGRAMMATICALLY
-- ════════════════════════════════════════════════════════════════

local gui = Instance.new("ScreenGui")
gui.Name          = "GameHUD"
gui.ResetOnSpawn  = false
gui.IgnoreGuiInset = true
gui.Parent        = player.PlayerGui

-- ── Helper functions ──────────────────────────────────────────────────────────

local function frame(parent, name, pos, size, color, alpha)
	local f = Instance.new("Frame")
	f.Name                   = name
	f.Position               = pos
	f.Size                   = size
	f.BackgroundColor3       = color or Color3.new(0,0,0)
	f.BackgroundTransparency = alpha or 0.5
	f.BorderSizePixel        = 0
	f.Parent                 = parent
	return f
end

local function label(parent, name, text, pos, size, fs, color, align)
	local l = Instance.new("TextLabel")
	l.Name                    = name
	l.Text                    = text
	l.Position                = pos
	l.Size                    = size
	l.BackgroundTransparency  = 1
	l.TextColor3              = color or Color3.new(1,1,1)
	l.Font                    = Enum.Font.GothamBold
	l.TextSize                = fs or 16
	l.TextStrokeTransparency  = 0.6
	l.TextXAlignment          = align or Enum.TextXAlignment.Left
	l.Parent                  = parent
	return l
end

local function button(parent, name, text, pos, size, bgColor)
	local b = Instance.new("TextButton")
	b.Name             = name
	b.Text             = text
	b.Position         = pos
	b.Size             = size
	b.BackgroundColor3 = bgColor or Color3.fromRGB(40,80,55)
	b.TextColor3       = Color3.new(1,1,1)
	b.Font             = Enum.Font.GothamBold
	b.TextSize         = 15
	b.BorderSizePixel  = 0
	b.AutoButtonColor  = true
	b.Parent           = parent
	return b
end

local function corner(parent, radius)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius or 6)
	c.Parent       = parent
end

-- ── Top bar ───────────────────────────────────────────────────────────────────
local topBar = frame(gui, "TopBar",
	UDim2.new(0,0,0,0), UDim2.new(1,0,0,42),
	Color3.fromRGB(10,10,15), 0.35)

local waveLabel = label(topBar, "Wave", "Waiting...",
	UDim2.new(0.5,-100,0,8), UDim2.new(0,200,0,26),
	20, Color3.fromRGB(255,200,80), Enum.TextXAlignment.Center)

local coinLabel = label(topBar, "Coins", "$ 0",
	UDim2.new(0,10,0,8), UDim2.new(0,180,0,26),
	18, Color3.fromRGB(255,215,0))

local timerLabel = label(topBar, "Timer", "",
	UDim2.new(1,-140,0,8), UDim2.new(0,130,0,26),
	18, Color3.fromRGB(180,200,255), Enum.TextXAlignment.Right)

local zombieLabel = label(topBar, "Zombies", "",
	UDim2.new(0.5,-60,0,8), UDim2.new(0,120,0,26),
	14, Color3.fromRGB(200,100,100), Enum.TextXAlignment.Center)

-- ── Health bar (bottom-left) ──────────────────────────────────────────────────
local hpOuter = frame(gui, "HPOuter",
	UDim2.new(0,10,1,-50), UDim2.new(0,220,0,32),
	Color3.fromRGB(20,20,20), 0.4)
corner(hpOuter, 5)

local hpFill = frame(hpOuter, "Fill",
	UDim2.new(0,0,0,0), UDim2.new(1,0,1,0),
	Color3.fromRGB(50,200,70), 0)
corner(hpFill, 5)

local hpLabel = label(hpOuter, "HPlabel", "100 HP",
	UDim2.new(0,6,0,7), UDim2.new(1,0,1,0),
	14, Color3.new(1,1,1))

-- ── Ammo display (bottom-right) ───────────────────────────────────────────────
local ammoLabel = label(gui, "Ammo", "",
	UDim2.new(1,-170,1,-46), UDim2.new(0,160,0,30),
	17, Color3.fromRGB(220,220,220), Enum.TextXAlignment.Right)

-- ── Kill feed (right side) ────────────────────────────────────────────────────
local killFeedFrame = frame(gui, "KillFeed",
	UDim2.new(1,-220,0,50), UDim2.new(0,210,0,170),
	Color3.new(0,0,0), 1)
local killEntries = {}

-- ── Phase banner (center screen, temporary) ───────────────────────────────────
local phaseBanner = frame(gui, "PhaseBanner",
	UDim2.new(0.5,-220,0.38,0), UDim2.new(0,440,0,70),
	Color3.fromRGB(15,15,15), 0.25)
corner(phaseBanner, 10)
phaseBanner.Visible = false

local phaseLine1 = label(phaseBanner, "L1", "",
	UDim2.new(0,0,0,6), UDim2.new(1,0,0,30),
	26, Color3.fromRGB(255,80,80), Enum.TextXAlignment.Center)
local phaseLine2 = label(phaseBanner, "L2", "",
	UDim2.new(0,0,0,38), UDim2.new(1,0,0,22),
	16, Color3.fromRGB(200,200,200), Enum.TextXAlignment.Center)

local function showBanner(line1, line2, color, duration)
	phaseLine1.Text       = line1
	phaseLine1.TextColor3 = color or Color3.fromRGB(255,80,80)
	phaseLine2.Text       = line2 or ""
	phaseBanner.Visible   = true
	phaseBanner.BackgroundTransparency = 0.25
	phaseLine1.TextTransparency = 0
	phaseLine2.TextTransparency = 0
	task.delay(duration or 3.5, function()
		TweenService:Create(phaseBanner, TweenInfo.new(0.8), {BackgroundTransparency=1}):Play()
		TweenService:Create(phaseLine1,  TweenInfo.new(0.8), {TextTransparency=1}):Play()
		TweenService:Create(phaseLine2,  TweenInfo.new(0.8), {TextTransparency=1}):Play()
		task.delay(0.9, function() phaseBanner.Visible = false end)
	end)
end

-- ── Vignette (red flash when hurt) ───────────────────────────────────────────
local vignette = frame(gui, "Vignette",
	UDim2.new(0,0,0,0), UDim2.new(1,0,1,0),
	Color3.fromRGB(200,0,0), 1)

local function flashVignette()
	vignette.BackgroundTransparency = 0.55
	TweenService:Create(vignette, TweenInfo.new(0.6), {BackgroundTransparency=1}):Play()
end

-- ── Game Over overlay ─────────────────────────────────────────────────────────
local gameOverFrame = frame(gui, "GameOver",
	UDim2.new(0.5,-200,0.4,-60), UDim2.new(0,400,0,120),
	Color3.fromRGB(15,15,15), 0.2)
corner(gameOverFrame, 12)
gameOverFrame.Visible = false

local goLine1 = label(gameOverFrame, "L1", "GAME OVER",
	UDim2.new(0,0,0,10), UDim2.new(1,0,0,40),
	32, Color3.fromRGB(255,50,50), Enum.TextXAlignment.Center)
local goLine2 = label(gameOverFrame, "L2", "",
	UDim2.new(0,0,0,55), UDim2.new(1,0,0,26),
	20, Color3.fromRGB(220,220,220), Enum.TextXAlignment.Center)
local goLine3 = label(gameOverFrame, "L3", "New game starts in 8 seconds...",
	UDim2.new(0,0,0,82), UDim2.new(1,0,0,20),
	14, Color3.fromRGB(160,160,160), Enum.TextXAlignment.Center)

-- ════════════════════════════════════════════════════════════════
-- SHOP PANEL
-- ════════════════════════════════════════════════════════════════

local shopPanel = frame(gui, "Shop",
	UDim2.new(0.5,-210,0.5,-270), UDim2.new(0,420,0,540),
	Color3.fromRGB(12,14,18), 0.08)
corner(shopPanel, 12)
shopPanel.Visible = false

label(shopPanel, "Title", "WEAPON SHOP",
	UDim2.new(0,0,0,10), UDim2.new(1,0,0,32),
	22, Color3.fromRGB(255,210,60), Enum.TextXAlignment.Center)

local shopCoinLabel = label(shopPanel, "YourCoins", "Your coins: 0",
	UDim2.new(0,0,0,42), UDim2.new(1,0,0,20),
	14, Color3.fromRGB(200,200,200), Enum.TextXAlignment.Center)

-- Close button
local closeShop = button(shopPanel, "Close", "✕  Close",
	UDim2.new(1,-110,0,8), UDim2.new(0,100,0,28),
	Color3.fromRGB(90,20,20))
corner(closeShop, 5)
closeShop.MouseButton1Click:Connect(function() shopPanel.Visible = false end)

-- Weapon rows
local shopWeapons = { "Shotgun", "Rifle", "Sniper", "Launcher" }
local yPos = 70

for _, wname in ipairs(shopWeapons) do
	local wcfg = GameConfig.WEAPONS[wname]
	local row  = frame(shopPanel, "Row_"..wname,
		UDim2.new(0,10,0,yPos), UDim2.new(1,-20,0,64),
		Color3.fromRGB(25,30,40), 0.3)
	corner(row, 8)

	label(row, "Name", wname,
		UDim2.new(0,10,0,6), UDim2.new(0,130,0,22),
		17, Color3.fromRGB(255,240,180))

	-- Stat summary
	local stats = string.format("DMG:%d  RPM:%d  AMO:%d  RNG:%d",
		wcfg.damage, math.floor(wcfg.fireRate*60), wcfg.ammo, wcfg.range)
	label(row, "Stats", stats,
		UDim2.new(0,10,0,30), UDim2.new(0,220,0,18),
		11, Color3.fromRGB(160,190,160))

	local buyBtn = button(row, "Buy", "$ " .. wcfg.cost .. "  BUY",
		UDim2.new(1,-110,0,12), UDim2.new(0,100,0,38),
		Color3.fromRGB(30,90,50))
	corner(buyBtn, 6)

	buyBtn.MouseButton1Click:Connect(function()
		RE.BuyWeapon:FireServer(wname)
	end)

	yPos += 72
end

-- Revive button
local revRow = frame(shopPanel, "ReviveRow",
	UDim2.new(0,10,0,yPos), UDim2.new(1,-20,0,56),
	Color3.fromRGB(80,15,15), 0.35)
corner(revRow, 8)

label(revRow, "Name", "REVIVE  (if dead)",
	UDim2.new(0,10,0,8), UDim2.new(0,200,0,22),
	16, Color3.fromRGB(255,130,130))

local revBtn = button(revRow, "Buy", "$ " .. GameConfig.REVIVE_COST .. "  REVIVE",
	UDim2.new(1,-120,0,10), UDim2.new(0,110,0,36),
	Color3.fromRGB(130,20,20))
corner(revBtn, 6)
revBtn.MouseButton1Click:Connect(function() RE.BuyRevive:FireServer() end)

-- Shop open button (always visible in top-right)
local openShopBtn = button(gui, "OpenShop", "🛒  Shop",
	UDim2.new(1,-100,0,50), UDim2.new(0,90,0,32),
	Color3.fromRGB(20,90,50))
corner(openShopBtn, 6)
openShopBtn.MouseButton1Click:Connect(function()
	shopPanel.Visible = not shopPanel.Visible
	if shopPanel.Visible then
		local coins = RE.GetCoins:InvokeServer()
		shopCoinLabel.Text = "Your coins: $ " .. (coins or 0)
	end
end)

-- ════════════════════════════════════════════════════════════════
-- KILL FEED
-- ════════════════════════════════════════════════════════════════

local function addKillEntry(text, color)
	local lbl = Instance.new("TextLabel")
	lbl.Size                   = UDim2.new(1,0,0,22)
	lbl.BackgroundTransparency = 1
	lbl.TextColor3             = color or Color3.fromRGB(180,255,180)
	lbl.Font                   = Enum.Font.Gotham
	lbl.TextSize               = 13
	lbl.Text                   = text
	lbl.TextXAlignment         = Enum.TextXAlignment.Left
	lbl.Parent                 = killFeedFrame

	table.insert(killEntries, lbl)
	for i, e in ipairs(killEntries) do
		e.Position = UDim2.new(0, 4, 0, (i-1)*24)
	end
	if #killEntries > 6 then
		killEntries[1]:Destroy()
		table.remove(killEntries, 1)
	end

	task.delay(5, function()
		TweenService:Create(lbl, TweenInfo.new(0.8), {TextTransparency=1}):Play()
		task.delay(0.9, function()
			lbl:Destroy()
			local idx = table.find(killEntries, lbl)
			if idx then table.remove(killEntries, idx) end
		end)
	end)
end

-- ════════════════════════════════════════════════════════════════
-- HEALTH BAR UPDATER
-- ════════════════════════════════════════════════════════════════

local lastHealth = 100

local function updateHealthBar(char)
	local hum = char:WaitForChild("Humanoid")
	hum.HealthChanged:Connect(function(hp)
		local pct = hp / hum.MaxHealth
		TweenService:Create(hpFill,  TweenInfo.new(0.2), {Size = UDim2.new(pct,0,1,0)}):Play()
		hpLabel.Text = math.ceil(hp) .. " HP"
		if pct < 0.3 then
			hpFill.BackgroundColor3 = Color3.fromRGB(210,40,40)
		elseif pct < 0.6 then
			hpFill.BackgroundColor3 = Color3.fromRGB(210,170,30)
		else
			hpFill.BackgroundColor3 = Color3.fromRGB(50,200,70)
		end
		if hp < lastHealth then flashVignette() end
		lastHealth = hp
	end)
	-- Initial sync
	local pct = hum.Health / hum.MaxHealth
	hpFill.Size = UDim2.new(pct,0,1,0)
	hpLabel.Text = math.ceil(hum.Health) .. " HP"
end

player.CharacterAdded:Connect(function(char)
	updateHealthBar(char)
	gameOverFrame.Visible = false
	lastHealth = 100
end)
if player.Character then updateHealthBar(player.Character) end

-- ════════════════════════════════════════════════════════════════
-- SHOOTING SYSTEM
-- ════════════════════════════════════════════════════════════════

local equipped    = nil    -- currently held Tool
local ammo        = 0
local maxAmmo     = 0
local isReloading = false
local lastShot    = 0

local function updateAmmo()
	if not equipped then
		ammoLabel.Text = ""
		return
	end
	if isReloading then
		ammoLabel.Text = equipped.Name .. "  [RELOADING...]"
		ammoLabel.TextColor3 = Color3.fromRGB(255,180,50)
	else
		ammoLabel.Text = equipped.Name .. "  " .. ammo .. " / " .. maxAmmo
		ammoLabel.TextColor3 = ammo <= 3
			and Color3.fromRGB(255,80,80)
			or  Color3.fromRGB(220,220,220)
	end
end

local function startReload()
	if isReloading or not equipped then return end
	local wt    = equipped:FindFirstChild("WeaponType")
	local wcfg  = wt and GameConfig.WEAPONS[wt.Value]
	if not wcfg then return end
	isReloading = true
	updateAmmo()
	task.wait(wcfg.reload)
	if equipped then  -- check still equipped
		ammo        = maxAmmo
		isReloading = false
		updateAmmo()
	end
end

local function onToolEquipped(tool)
	local wt   = tool:FindFirstChild("WeaponType")
	if not wt then return end
	local wcfg = GameConfig.WEAPONS[wt.Value]
	if not wcfg then return end
	equipped    = tool
	maxAmmo     = wcfg.ammo
	ammo        = wcfg.ammo
	isReloading = false
	updateAmmo()
end

local function onToolUnequipped()
	equipped    = nil
	isReloading = false
	updateAmmo()
end

local function watchCharacterTools(char)
	local function watchTool(tool)
		if not tool:IsA("Tool") then return end
		tool.Equipped:Connect(function()   onToolEquipped(tool) end)
		tool.Unequipped:Connect(function() onToolUnequipped()   end)
	end

	for _, item in ipairs(char:GetChildren()) do watchTool(item) end
	char.ChildAdded:Connect(watchTool)

	for _, item in ipairs(player.Backpack:GetChildren()) do watchTool(item) end
	player.Backpack.ChildAdded:Connect(watchTool)
end

player.CharacterAdded:Connect(watchCharacterTools)
if player.Character then watchCharacterTools(player.Character) end

-- Reload key (R)
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.R then
		task.spawn(startReload)
	end
end)

-- ── Shoot on click ────────────────────────────────────────────────────────────

local function muzzleFlash(origin, hitPoint)
	-- Bullet trail
	local a0 = Instance.new("Attachment")
	local a1 = Instance.new("Attachment")
	a0.WorldPosition = origin
	a1.WorldPosition = hitPoint
	a0.Parent = workspace.Terrain
	a1.Parent = workspace.Terrain

	local beam = Instance.new("Beam")
	beam.Attachment0  = a0
	beam.Attachment1  = a1
	beam.Width0       = 0.06
	beam.Width1       = 0.06
	beam.LightEmission = 1
	beam.Color        = ColorSequence.new(Color3.fromRGB(255,245,150))
	beam.Parent       = workspace.Terrain

	task.delay(0.04, function()
		beam:Destroy()
		a0:Destroy()
		a1:Destroy()
	end)
end

local function shoot()
	if not equipped then return end
	if isReloading   then return end

	local wt   = equipped:FindFirstChild("WeaponType")
	local wcfg = wt and GameConfig.WEAPONS[wt.Value]
	if not wcfg then return end

	-- Fire-rate gate
	local now = tick()
	if now - lastShot < 1/wcfg.fireRate then return end
	lastShot = now

	if ammo <= 0 then
		task.spawn(startReload)
		return
	end

	ammo -= 1
	updateAmmo()

	-- Raycast from camera centre through mouse position
	local unitRay = camera:ScreenPointToRay(mouse.X, mouse.Y)
	local params  = RaycastParams.new()
	params.FilterDescendantsInstances = { player.Character }
	params.FilterType = Enum.RaycastFilterType.Exclude

	local result = workspace:Raycast(unitRay.Origin, unitRay.Direction * wcfg.range, params)

	if result then
		muzzleFlash(unitRay.Origin + unitRay.Direction * 1.5, result.Position)

		-- Walk up the hit instance to find a Model with a ZombieType tag
		local hit   = result.Instance
		local model = hit:FindFirstAncestorOfClass("Model")
		if model and model:FindFirstChild("ZombieType") then
			RE.PlayerShot:FireServer(model, wt.Value)
		end
	end

	if ammo == 0 then task.spawn(startReload) end
end

mouse.Button1Down:Connect(shoot)

-- ════════════════════════════════════════════════════════════════
-- REMOTE EVENT LISTENERS
-- ════════════════════════════════════════════════════════════════

RE.WaveStart.OnClientEvent:Connect(function(waveNum, totalZombies)
	waveLabel.Text  = "Wave " .. waveNum
	zombieLabel.Text = totalZombies .. " zombies"
	shopPanel.Visible = false
	gameOverFrame.Visible = false

	local color = waveNum >= 8 and Color3.fromRGB(255,50,50)
		or waveNum >= 5 and Color3.fromRGB(255,150,50)
		or Color3.fromRGB(255,80,80)

	showBanner(
		"WAVE " .. waveNum .. " BEGINS!",
		totalZombies .. " zombies incoming",
		color, 3.5
	)
end)

RE.WaveEnd.OnClientEvent:Connect(function(waveNum)
	shopPanel.Visible = true
	zombieLabel.Text  = ""
	showBanner(
		"WAVE " .. waveNum .. " CLEARED!",
		"Shop is open  —  " .. GameConfig.SHOP_TIME .. "s",
		Color3.fromRGB(80,230,100), 4
	)
	local coins = RE.GetCoins:InvokeServer()
	shopCoinLabel.Text = "Your coins: $ " .. (coins or 0)
end)

RE.GameOver.OnClientEvent:Connect(function(waveNum)
	gameOverFrame.Visible = true
	goLine2.Text = "You survived " .. waveNum .. " wave" .. (waveNum == 1 and "" or "s")
	shopPanel.Visible = false
	zombieLabel.Text  = ""
	waveLabel.Text    = "GAME OVER"
	task.delay(8, function()
		gameOverFrame.Visible = false
		waveLabel.Text = "Waiting..."
	end)
end)

RE.CoinsUpdate.OnClientEvent:Connect(function(amount)
	coinLabel.Text     = "$ " .. amount
	if shopPanel.Visible then
		shopCoinLabel.Text = "Your coins: $ " .. amount
	end
end)

RE.KillFeed.OnClientEvent:Connect(function(zombieType, reward)
	addKillEntry("+" .. reward .. "  " .. zombieType .. " killed",
		zombieType == "Boss" and Color3.fromRGB(255,100,255) or Color3.fromRGB(160,255,160))
end)

RE.TimerTick.OnClientEvent:Connect(function(secs)
	if secs > 0 then
		timerLabel.Text = "Next wave: " .. secs .. "s"
	else
		timerLabel.Text = ""
	end
end)

RE.PhaseChange.OnClientEvent:Connect(function(phase, waveOrCountdown)
	if phase == "waiting" then
		waveLabel.Text   = "Waiting for players..."
		timerLabel.Text  = ""
		zombieLabel.Text = ""
	elseif phase == "countdown" then
		waveLabel.Text   = "WAVE " .. (waveOrCountdown) .. " coming..."
		shopPanel.Visible = false
	elseif phase == "shop" then
		shopPanel.Visible = true
		waveLabel.Text    = "Wave " .. waveOrCountdown .. " cleared!"
	elseif phase == "wave" then
		shopPanel.Visible = false
	end
end)

RE.PlayerState.OnClientEvent:Connect(function(state)
	if state == "alive" then
		gameOverFrame.Visible = false
	end
end)

-- ── Initial state sync on join ────────────────────────────────────────────────
task.delay(1.5, function()
	local coins = RE.GetCoins:InvokeServer()
	coinLabel.Text = "$ " .. (coins or 0)

	local phase, wave = RE.GetPhase:InvokeServer()
	if phase == "shop" then
		shopPanel.Visible  = true
		waveLabel.Text     = "Wave " .. wave .. " cleared!"
		shopCoinLabel.Text = "Your coins: $ " .. (coins or 0)
	elseif phase == "wave" then
		waveLabel.Text = "Wave " .. wave
	elseif phase == "waiting" or phase == "countdown" then
		waveLabel.Text = "Get ready..."
	end
end)

-- ── Zombie counter update (live count from workspace) ────────────────────────
RunService.Heartbeat:Connect(function()
	local count = 0
	for _, obj in ipairs(workspace:GetChildren()) do
		if obj:IsA("Model") and GameConfig.ZOMBIES[obj.Name] then
			count += 1
		end
	end
	if count > 0 then
		zombieLabel.Text = count .. " zombies left"
	elseif zombieLabel.Text ~= "" and not zombieLabel.Text:find("incoming") then
		zombieLabel.Text = ""
	end
end)
