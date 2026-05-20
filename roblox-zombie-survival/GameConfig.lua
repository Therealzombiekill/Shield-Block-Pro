-- ╔══════════════════════════════════════════════════════════════╗
-- ║  GameConfig.lua  ·  Put this in ReplicatedStorage            ║
-- ║  Type: ModuleScript   Name it exactly: GameConfig            ║
-- ╚══════════════════════════════════════════════════════════════╝

local GameConfig = {}

-- ── Zombies ───────────────────────────────────────────────────────────────────
-- health  : hit points
-- speed   : walk speed (default player is 16)
-- damage  : damage dealt per melee hit
-- reward  : coins given to each surviving player on kill
-- color   : body color

GameConfig.ZOMBIES = {
	Walker = {
		health = 60,
		speed  = 10,
		damage = 8,
		reward = 5,
		color  = Color3.fromRGB(80, 130, 60),
	},
	Runner = {
		health = 40,
		speed  = 22,
		damage = 6,
		reward = 8,
		color  = Color3.fromRGB(200, 70, 70),
	},
	Tank = {
		health = 400,
		speed  = 7,
		damage = 22,
		reward = 30,
		color  = Color3.fromRGB(50, 70, 180),
	},
	Spitter = {
		health = 70,
		speed  = 13,
		damage = 12,
		reward = 12,
		color  = Color3.fromRGB(40, 190, 40),
	},
	Boss = {
		health = 2000,
		speed  = 9,
		damage = 35,
		reward = 250,
		color  = Color3.fromRGB(180, 0, 180),
	},
}

-- ── Wave definitions ──────────────────────────────────────────────────────────
-- Each wave is a list of { type = "ZombieName", count = number }
-- After wave 10 the game auto-scales wave 10 indefinitely (gets harder each loop)

GameConfig.WAVES = {
	[1]  = { {type="Walker",  count=8}  },
	[2]  = { {type="Walker",  count=10}, {type="Runner", count=3}  },
	[3]  = { {type="Walker",  count=8},  {type="Runner", count=6}  },
	[4]  = { {type="Walker",  count=10}, {type="Tank",   count=2}  },
	[5]  = { {type="Runner",  count=10}, {type="Tank",   count=3},  {type="Boss",    count=1} },
	[6]  = { {type="Spitter", count=8},  {type="Tank",   count=4}  },
	[7]  = { {type="Runner",  count=12}, {type="Spitter",count=6}  },
	[8]  = { {type="Tank",    count=5},  {type="Boss",   count=1}  },
	[9]  = { {type="Walker",  count=15}, {type="Spitter",count=8},  {type="Runner",  count=8} },
	[10] = { {type="Boss",    count=3},  {type="Tank",   count=6},  {type="Spitter", count=10} },
}

-- ── Weapons ───────────────────────────────────────────────────────────────────
-- damage   : damage per shot
-- fireRate : shots per second
-- ammo     : shots before reload
-- reload   : reload time in seconds
-- range    : max raycast distance in studs
-- cost     : coins to buy in shop (0 = starter weapon / free)

GameConfig.WEAPONS = {
	Pistol   = { damage=25,  fireRate=2,   ammo=18,  reload=1.5, range=80,  cost=0    },
	Shotgun  = { damage=90,  fireRate=0.8, ammo=8,   reload=2.5, range=35,  cost=150  },
	Rifle    = { damage=50,  fireRate=6,   ammo=30,  reload=2.0, range=120, cost=400  },
	Sniper   = { damage=220, fireRate=0.4, ammo=5,   reload=3.0, range=400, cost=900  },
	Launcher = { damage=380, fireRate=0.3, ammo=4,   reload=4.0, range=90,  cost=2800 },
}

-- Weapon handle colors (visual only)
GameConfig.WEAPON_COLORS = {
	Pistol   = Color3.fromRGB(40,  40,  40),
	Shotgun  = Color3.fromRGB(90,  55,  25),
	Rifle    = Color3.fromRGB(35,  65,  35),
	Sniper   = Color3.fromRGB(25,  25,  55),
	Launcher = Color3.fromRGB(70,  40,  15),
}

-- ── Economy ───────────────────────────────────────────────────────────────────
GameConfig.START_COINS     = 60    -- coins each player starts with
GameConfig.COINS_PER_WAVE  = 25    -- bonus coins for surviving a wave
GameConfig.REVIVE_COST     = 80    -- coins to buy a revive in the shop

-- ── Timing ────────────────────────────────────────────────────────────────────
GameConfig.PRE_WAVE_TIME   = 15    -- countdown seconds before each wave
GameConfig.SHOP_TIME       = 20    -- shop seconds between waves
GameConfig.SPAWN_DELAY     = 0.35  -- seconds between each zombie spawn
GameConfig.ATTACK_COOLDOWN = 1.1   -- seconds between zombie melee hits

-- ── Gamepasses (set real IDs in Roblox after creating them) ───────────────────
GameConfig.GAMEPASSES = {
	DoubleCoins = 0,   -- 2× coin reward on every kill
	StarterRifle= 0,   -- free Rifle at round start
	ExtraLife   = 0,   -- one free revive per round
}

return GameConfig
