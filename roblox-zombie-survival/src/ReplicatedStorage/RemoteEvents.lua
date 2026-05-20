-- ReplicatedStorage/RemoteEvents.lua
-- Run this as a Script inside ReplicatedStorage on startup,
-- or require it to get references to all RemoteEvents/Functions.

local RE = {}

local root = script.Parent

local function getOrCreate(class, name)
	local obj = root:FindFirstChild(name)
	if not obj then
		obj = Instance.new(class)
		obj.Name = name
		obj.Parent = root
	end
	return obj
end

-- Server -> Client
RE.WaveStarted      = getOrCreate("RemoteEvent",    "WaveStarted")       -- (waveNumber)
RE.WaveEnded        = getOrCreate("RemoteEvent",    "WaveEnded")         -- (waveNumber, survived)
RE.ZombieKilled     = getOrCreate("RemoteEvent",    "ZombieKilled")      -- (player, zombieType, reward)
RE.PlayerDied       = getOrCreate("RemoteEvent",    "PlayerDied")        -- (player)
RE.GameOver         = getOrCreate("RemoteEvent",    "GameOver")          -- (finalWave)
RE.CoinsUpdated     = getOrCreate("RemoteEvent",    "CoinsUpdated")      -- (player, newTotal)
RE.CountdownTick    = getOrCreate("RemoteEvent",    "CountdownTick")     -- (secondsLeft)

-- Client -> Server
RE.BuyWeapon        = getOrCreate("RemoteEvent",    "BuyWeapon")         -- (weaponName)
RE.BuyRevive        = getOrCreate("RemoteEvent",    "BuyRevive")         -- ()
RE.PlayerShot       = getOrCreate("RemoteEvent",    "PlayerShot")        -- (zombieModel, weaponName)

-- Client -> Server (returns value)
RE.GetCoins         = getOrCreate("RemoteFunction", "GetCoins")          -- () -> number

return RE
