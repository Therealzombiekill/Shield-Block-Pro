-- StarterGui/HUD (LocalScript inside a ScreenGui)
-- Shows: wave number, health bar, coins, kill feed, ammo, shop

local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService      = game:GetService("TweenService")

local RE         = require(ReplicatedStorage:WaitForChild("RemoteEvents"))
local GameConfig = require(ReplicatedStorage:WaitForChild("GameConfig"))

local player = Players.LocalPlayer
local gui    = script.Parent   -- ScreenGui

-- ── Build UI ──────────────────────────────────────────────────────────────────

local function makeLabel(parent, name, text, pos, size, fontSize, color)
	local lbl = Instance.new("TextLabel")
	lbl.Name            = name
	lbl.Text            = text
	lbl.Position        = pos
	lbl.Size            = size
	lbl.BackgroundTransparency = 1
	lbl.TextColor3      = color or Color3.new(1,1,1)
	lbl.Font            = Enum.Font.GothamBold
	lbl.TextSize        = fontSize or 18
	lbl.TextStrokeTransparency = 0.5
	lbl.TextXAlignment  = Enum.TextXAlignment.Left
	lbl.Parent          = parent
	return lbl
end

local function makeFrame(parent, name, pos, size, color, alpha)
	local f = Instance.new("Frame")
	f.Name                   = name
	f.Position               = pos
	f.Size                   = size
	f.BackgroundColor3       = color or Color3.new(0,0,0)
	f.BackgroundTransparency = alpha or 0.4
	f.BorderSizePixel        = 0
	f.Parent                 = parent
	return f
end

-- Top bar
local topBar   = makeFrame(gui, "TopBar", UDim2.new(0,0,0,0), UDim2.new(1,0,0,40), Color3.new(0,0,0), 0.5)
local waveLabel= makeLabel(topBar, "Wave",   "Wave 1",    UDim2.new(0.5,-60,0,8),  UDim2.new(0,120,0,24), 20)
local coinLabel= makeLabel(topBar, "Coins",  "💰 50",     UDim2.new(0,8,0,8),      UDim2.new(0,160,0,24), 18, Color3.fromRGB(255,215,0))
local timerLbl = makeLabel(topBar, "Timer",  "",          UDim2.new(1,-90,0,8),    UDim2.new(0,80,0,24),  18, Color3.fromRGB(200,200,255))
timerLbl.TextXAlignment = Enum.TextXAlignment.Right

-- Health bar (bottom-left)
local hpFrame  = makeFrame(gui, "HPFrame", UDim2.new(0,8,1,-50), UDim2.new(0,200,0,30), Color3.fromRGB(30,30,30), 0.3)
local hpFill   = makeFrame(hpFrame, "Fill", UDim2.new(0,0,0,0), UDim2.new(1,0,1,0), Color3.fromRGB(50,200,80), 0)
local hpLabel  = makeLabel(hpFrame, "HPLabel", "100 HP", UDim2.new(0,4,0,6), UDim2.new(1,0,1,0), 14)

-- Kill feed (top-right)
local killFeed = makeFrame(gui, "KillFeed", UDim2.new(1,-210,0,48), UDim2.new(0,200,0,160), Color3.new(0,0,0), 0.8)
local killList = {}

-- Ammo (bottom-right)
local ammoLabel = makeLabel(gui, "Ammo", "No weapon", UDim2.new(1,-120,1,-36), UDim2.new(0,110,0,24), 16, Color3.fromRGB(220,220,220))
ammoLabel.TextXAlignment = Enum.TextXAlignment.Right

-- Shop panel (hidden by default)
local shopPanel = makeFrame(gui, "Shop", UDim2.new(0.5,-200,0.5,-220), UDim2.new(0,400,0,440), Color3.fromRGB(20,20,30), 0.1)
shopPanel.Visible = false
makeLabel(shopPanel, "Title", "🛒  SHOP", UDim2.new(0,10,0,8), UDim2.new(1,-20,0,28), 22, Color3.fromRGB(255,215,0))

-- ── Shop buttons ──────────────────────────────────────────────────────────────

local shopButtons = {}

local function buildShopButtons()
	local y = 44
	local weapons = {"Shotgun","Rifle","Sniper","Launcher"}
	for _, name in ipairs(weapons) do
		local cfg = GameConfig.WEAPONS[name]
		local btn = Instance.new("TextButton")
		btn.Name            = name
		btn.Text            = name .. "  —  $" .. cfg.cost
		btn.Size            = UDim2.new(1,-20,0,38)
		btn.Position        = UDim2.new(0,10,0,y)
		btn.BackgroundColor3= Color3.fromRGB(40,80,60)
		btn.TextColor3      = Color3.new(1,1,1)
		btn.Font            = Enum.Font.Gotham
		btn.TextSize        = 16
		btn.BorderSizePixel = 0
		btn.Parent          = shopPanel
		table.insert(shopButtons, btn)
		y = y + 46

		btn.MouseButton1Click:Connect(function()
			RE.BuyWeapon:FireServer(name)
		end)
	end

	-- Revive button
	local revBtn = Instance.new("TextButton")
	revBtn.Name             = "Revive"
	revBtn.Text             = "Revive  —  $" .. GameConfig.REVIVE_COST
	revBtn.Size             = UDim2.new(1,-20,0,38)
	revBtn.Position         = UDim2.new(0,10,0,y)
	revBtn.BackgroundColor3 = Color3.fromRGB(180,40,40)
	revBtn.TextColor3       = Color3.new(1,1,1)
	revBtn.Font             = Enum.Font.Gotham
	revBtn.TextSize         = 16
	revBtn.BorderSizePixel  = 0
	revBtn.Parent           = shopPanel
	revBtn.MouseButton1Click:Connect(function()
		RE.BuyRevive:FireServer()
	end)

	-- Close button
	local closeBtn = Instance.new("TextButton")
	closeBtn.Text             = "✕  Close"
	closeBtn.Size             = UDim2.new(0,100,0,30)
	closeBtn.Position         = UDim2.new(1,-110,0,8)
	closeBtn.BackgroundColor3 = Color3.fromRGB(80,20,20)
	closeBtn.TextColor3       = Color3.new(1,1,1)
	closeBtn.Font             = Enum.Font.Gotham
	closeBtn.TextSize         = 14
	closeBtn.BorderSizePixel  = 0
	closeBtn.Parent           = shopPanel
	closeBtn.MouseButton1Click:Connect(function() shopPanel.Visible = false end)
end

buildShopButtons()

-- Shop open button (always visible)
local shopBtn = Instance.new("TextButton")
shopBtn.Text             = "🛒 Shop"
shopBtn.Size             = UDim2.new(0,90,0,32)
shopBtn.Position         = UDim2.new(1,-100,0,48)
shopBtn.BackgroundColor3 = Color3.fromRGB(30,100,60)
shopBtn.TextColor3       = Color3.new(1,1,1)
shopBtn.Font             = Enum.Font.GothamBold
shopBtn.TextSize         = 15
shopBtn.BorderSizePixel  = 0
shopBtn.Parent           = gui
shopBtn.MouseButton1Click:Connect(function() shopPanel.Visible = not shopPanel.Visible end)

-- ── Kill feed helper ──────────────────────────────────────────────────────────

local function addKillEntry(text)
	local lbl = Instance.new("TextLabel")
	lbl.Size                    = UDim2.new(1,0,0,20)
	lbl.BackgroundTransparency  = 1
	lbl.TextColor3              = Color3.fromRGB(200,255,200)
	lbl.Font                    = Enum.Font.Gotham
	lbl.TextSize                = 13
	lbl.Text                    = text
	lbl.TextXAlignment          = Enum.TextXAlignment.Left
	lbl.Parent                  = killFeed
	table.insert(killList, lbl)

	-- Restack
	for i, item in ipairs(killList) do
		item.Position = UDim2.new(0,4,0, (i-1)*22)
	end

	-- Remove oldest if more than 6
	if #killList > 6 then
		killList[1]:Destroy()
		table.remove(killList, 1)
	end

	-- Fade out after 4s
	task.delay(4, function()
		TweenService:Create(lbl, TweenInfo.new(1), {TextTransparency=1}):Play()
		task.delay(1, function()
			lbl:Destroy()
			local idx = table.find(killList, lbl)
			if idx then table.remove(killList, idx) end
		end)
	end)
end

-- ── Health bar update ─────────────────────────────────────────────────────────

local function updateHealth()
	local char = player.Character
	if not char then return end
	local hum = char:FindFirstChildOfClass("Humanoid")
	if not hum then return end
	local pct = hum.Health / hum.MaxHealth
	TweenService:Create(hpFill, TweenInfo.new(0.2), {Size = UDim2.new(pct,0,1,0)}):Play()
	hpLabel.Text = math.ceil(hum.Health) .. " HP"
	hpFill.BackgroundColor3 = Color3.fromRGB(50 + (1-pct)*200, 200 - (1-pct)*170, 50)
end

local function watchHealth(char)
	local hum = char:WaitForChild("Humanoid")
	hum.HealthChanged:Connect(updateHealth)
	updateHealth()
end

player.CharacterAdded:Connect(watchHealth)
if player.Character then watchHealth(player.Character) end

-- ── Remote event listeners ────────────────────────────────────────────────────

RE.WaveStarted.OnClientEvent:Connect(function(waveNum)
	waveLabel.Text  = "Wave " .. waveNum
	shopPanel.Visible = false

	local announce = makeFrame(gui, "Announce", UDim2.new(0.5,-150,0.4,0), UDim2.new(0,300,0,60), Color3.new(0,0,0), 0.3)
	local lbl = makeLabel(announce, "Txt", "⚠  WAVE " .. waveNum .. " BEGINS!", UDim2.new(0,0,0,16), UDim2.new(1,0,0,28), 22, Color3.fromRGB(255,80,80))
	lbl.TextXAlignment = Enum.TextXAlignment.Center
	task.delay(3, function() announce:Destroy() end)
end)

RE.WaveEnded.OnClientEvent:Connect(function(waveNum, survived)
	if survived then
		shopPanel.Visible = true
	end
end)

RE.ZombieKilled.OnClientEvent:Connect(function(zombieType, reward)
	addKillEntry("+" .. reward .. "  " .. zombieType .. " killed")
end)

RE.CoinsUpdated.OnClientEvent:Connect(function(newTotal)
	coinLabel.Text = "💰 " .. newTotal
end)

RE.CountdownTick.OnClientEvent:Connect(function(secondsLeft)
	timerLbl.Text = "Next wave: " .. secondsLeft .. "s"
	if secondsLeft <= 0 then timerLbl.Text = "" end
end)

RE.GameOver.OnClientEvent:Connect(function(finalWave)
	local frame = makeFrame(gui, "GameOver", UDim2.new(0.5,-150,0.4,-40), UDim2.new(0,300,0,80), Color3.new(0,0,0), 0.2)
	makeLabel(frame, "L1", "GAME OVER", UDim2.new(0,0,0,8),  UDim2.new(1,0,0,30), 28, Color3.fromRGB(255,60,60)).TextXAlignment = Enum.TextXAlignment.Center
	makeLabel(frame, "L2", "You reached Wave " .. finalWave, UDim2.new(0,0,0,40), UDim2.new(1,0,0,24), 18, Color3.new(1,1,1)).TextXAlignment  = Enum.TextXAlignment.Center
end)

-- Initial coin fetch
task.delay(1, function()
	local coins = RE.GetCoins:InvokeServer()
	coinLabel.Text = "💰 " .. (coins or 0)
end)
