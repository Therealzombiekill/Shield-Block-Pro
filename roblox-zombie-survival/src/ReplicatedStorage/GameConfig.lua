-- ReplicatedStorage/GameConfig.lua
-- Shared config readable by both server and client

local GameConfig = {}

-- Zombie types: health, speed, damage, reward (coins on kill)
GameConfig.ZOMBIES = {
	Walker  = { health = 60,  speed = 10, damage = 10, reward = 5,   color = Color3.fromRGB(100, 160, 80)  },
	Runner  = { health = 40,  speed = 20, damage = 8,  reward = 8,   color = Color3.fromRGB(180, 80,  80)  },
	Tank    = { health = 300, speed = 6,  damage = 25, reward = 25,  color = Color3.fromRGB(60,  80,  200) },
	Spitter = { health = 80,  speed = 12, damage = 15, reward = 15,  color = Color3.fromRGB(50,  200, 50)  },
	Boss    = { health = 1500,speed = 8,  damage = 40, reward = 200, color = Color3.fromRGB(200, 0,   200) },
}

-- Wave definitions: list of { type, count } spawns
GameConfig.WAVES = {
	[1]  = { { type = "Walker",  count = 8  } },
	[2]  = { { type = "Walker",  count = 10 }, { type = "Runner",  count = 3  } },
	[3]  = { { type = "Walker",  count = 8  }, { type = "Runner",  count = 6  } },
	[4]  = { { type = "Walker",  count = 6  }, { type = "Tank",    count = 2  } },
	[5]  = { { type = "Runner",  count = 10 }, { type = "Tank",    count = 3  }, { type = "Boss", count = 1 } },
	[6]  = { { type = "Spitter", count = 8  }, { type = "Tank",    count = 4  } },
	[7]  = { { type = "Runner",  count = 12 }, { type = "Spitter", count = 6  } },
	[8]  = { { type = "Tank",    count = 5  }, { type = "Boss",    count = 1  } },
	[9]  = { { type = "Walker",  count = 15 }, { type = "Spitter", count = 8  }, { type = "Runner", count = 8 } },
	[10] = { { type = "Boss",    count = 3  }, { type = "Tank",    count = 6  }, { type = "Spitter", count = 10 } },
}

-- Weapons: damage, firerate (shots/sec), ammo, reload time, range, cost in shop
GameConfig.WEAPONS = {
	Pistol   = { damage = 25,  fireRate = 2,  ammo = 30,  reloadTime = 1.5, range = 60,  cost = 0    },
	Shotgun  = { damage = 80,  fireRate = 0.8,ammo = 16,  reloadTime = 2.5, range = 30,  cost = 200  },
	Rifle    = { damage = 45,  fireRate = 5,  ammo = 60,  reloadTime = 2.0, range = 100, cost = 500  },
	Sniper   = { damage = 200, fireRate = 0.5,ammo = 10,  reloadTime = 3.0, range = 300, cost = 1000 },
	Launcher = { damage = 350, fireRate = 0.3,ammo = 5,   reloadTime = 4.0, range = 80,  cost = 3000 },
}

-- Player starting values
GameConfig.PLAYER_HEALTH    = 100
GameConfig.START_COINS      = 50
GameConfig.COINS_PER_WAVE   = 20   -- bonus for surviving a wave
GameConfig.REVIVE_COST      = 75   -- coins to self-revive (or use gamepass)
GameConfig.BETWEEN_WAVES    = 20   -- seconds of shop time between waves

-- Gamepass IDs (set these in Roblox after creating them)
GameConfig.GAMEPASSES = {
	DoubleCoins = 0,   -- replace 0 with your real gamepass ID
	VIPWeapon   = 0,
	ExtraLife   = 0,
}

return GameConfig
