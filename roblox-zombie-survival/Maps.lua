-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Maps.lua  ·  Put this in ReplicatedStorage                  ║
-- ║  Type: ModuleScript   Name it exactly: Maps                  ║
-- ╚══════════════════════════════════════════════════════════════╝
--
-- 4 maps: City Ruins, Graveyard, Military Base, Dark Forest
-- Picked randomly each round. Call Maps.build(Maps.random()) to use.

local Maps    = {}
local Lighting = game:GetService("Lighting")

local ARENA = 200   -- must match the ARENA value removed from Main.server.lua

-- ════════════════════════════════════════════════════════════════
-- PART FACTORIES
-- ════════════════════════════════════════════════════════════════

-- Generic block part
local function P(folder, name, size, pos, color, mat, trans, noCollide, rotDeg)
	local p = Instance.new("Part")
	p.Name         = name
	p.Anchored     = true
	p.CanCollide   = noCollide ~= true
	p.Size         = size
	p.Color        = color or Color3.fromRGB(128,128,128)
	p.Material     = mat or Enum.Material.SmoothPlastic
	p.Transparency = trans or 0
	if rotDeg then
		p.CFrame = CFrame.new(pos) * CFrame.Angles(
			math.rad(rotDeg[1] or 0),
			math.rad(rotDeg[2] or 0),
			math.rad(rotDeg[3] or 0))
	else
		p.CFrame = CFrame.new(pos)
	end
	p.Parent = folder
	return p
end

-- Cylinder — axis runs along X by default in Roblox.
-- Pass rotDeg={0,0,90} to stand it upright (vertical trunk/pole).
-- Pass rotDeg={0,yAngle,0} to lay it flat at a horizontal angle.
local function Cyl(folder, name, size, pos, color, mat, rotDeg)
	local p = P(folder, name, size, pos, color, mat, 0, false, rotDeg)
	p.Shape = Enum.PartType.Cylinder
	return p
end

-- Ball / sphere
local function Ball(folder, name, size, pos, color, mat)
	local p = P(folder, name, size, pos, color, mat)
	p.Shape = Enum.PartType.Ball
	return p
end

-- SpawnLocation at arena center
local function makePlayerSpawn()
	local s = Instance.new("SpawnLocation")
	s.Name     = "SpawnLocation"
	s.Anchored = true
	s.Neutral  = true
	s.Size     = Vector3.new(8,1,8)
	s.CFrame   = CFrame.new(0,1,0)
	s.Color    = BrickColor.new("Bright blue")
	s.Parent   = workspace
end

local function setLighting(t)
	Lighting.ClockTime      = t.clock  or 12
	Lighting.Brightness     = t.bright or 1
	Lighting.FogEnd         = t.fogEnd or 500
	Lighting.FogColor       = t.fogColor or Color3.fromRGB(128,128,128)
	Lighting.Ambient        = t.ambient or Color3.fromRGB(70,70,70)
	Lighting.OutdoorAmbient = t.outdoor or Color3.fromRGB(100,100,100)
end

-- ════════════════════════════════════════════════════════════════
-- MAP 1 ── CITY RUINS
-- Night-time destroyed city. Overturned cars, concrete barriers,
-- dumpsters, rubble, street lamps, crumbling building facades.
-- ════════════════════════════════════════════════════════════════

local function buildCity()
	local m = Instance.new("Folder")
	m.Name   = "Map"
	m.Parent = workspace

	local H    = ARENA/2
	local WALLH = 22

	-- Floor: dark asphalt
	P(m,"Floor", Vector3.new(ARENA,2,ARENA), Vector3.new(0,-1,0),
		Color3.fromRGB(44,44,47), Enum.Material.SmoothPlastic)

	-- Road markings (no collision, purely visual)
	P(m,"LineH", Vector3.new(ARENA,0.1,2.5), Vector3.new(0,0,0),
		Color3.fromRGB(215,195,45), Enum.Material.SmoothPlastic, 0, true)
	P(m,"LineV", Vector3.new(2.5,0.1,ARENA), Vector3.new(0,0,0),
		Color3.fromRGB(215,195,45), Enum.Material.SmoothPlastic, 0, true)
	for i = -3, 3 do
		P(m,"DashH"..i, Vector3.new(12,0.1,0.8), Vector3.new(i*26,0,0),
			Color3.fromRGB(215,195,45), Enum.Material.SmoothPlastic, 0, true)
		P(m,"DashV"..i, Vector3.new(0.8,0.1,12), Vector3.new(0,0,i*26),
			Color3.fromRGB(215,195,45), Enum.Material.SmoothPlastic, 0, true)
	end

	-- Outer walls: concrete building facades
	local wc = Color3.fromRGB(100,95,87)
	P(m,"WallN", Vector3.new(ARENA+4,WALLH,4), Vector3.new(0,WALLH/2,-H-2), wc, Enum.Material.Concrete)
	P(m,"WallS", Vector3.new(ARENA+4,WALLH,4), Vector3.new(0,WALLH/2, H+2), wc, Enum.Material.Concrete)
	P(m,"WallW", Vector3.new(4,WALLH,ARENA+4), Vector3.new(-H-2,WALLH/2,0), wc, Enum.Material.Concrete)
	P(m,"WallE", Vector3.new(4,WALLH,ARENA+4), Vector3.new( H+2,WALLH/2,0), wc, Enum.Material.Concrete)

	-- Dark window cutouts on walls (decorative)
	local wWin = Color3.fromRGB(18,22,32)
	for i = -3, 3 do
		P(m,"WinN"..i, Vector3.new(9,7,0.6), Vector3.new(i*26,13,-H-0.5), wWin, Enum.Material.SmoothPlastic, 0, true)
		P(m,"WinS"..i, Vector3.new(9,7,0.6), Vector3.new(i*26,13, H+0.5), wWin, Enum.Material.SmoothPlastic, 0, true)
		P(m,"WinW"..i, Vector3.new(0.6,7,9), Vector3.new(-H-0.5,13,i*26), wWin, Enum.Material.SmoothPlastic, 0, true)
		P(m,"WinE"..i, Vector3.new(0.6,7,9), Vector3.new( H+0.5,13,i*26), wWin, Enum.Material.SmoothPlastic, 0, true)
	end

	-- Overturned cars
	local carC = Color3.fromRGB(70,55,45)
	P(m,"Car1", Vector3.new(10,5,5),  Vector3.new(26,2.5,9),    carC, Enum.Material.Metal)
	P(m,"Car2", Vector3.new(10,5,5),  Vector3.new(-30,2.5,-5),  Color3.fromRGB(55,65,45), Enum.Material.Metal, 0, false, {0,42,0})
	P(m,"Car3", Vector3.new(10,5,5),  Vector3.new(5,2.5,42),    Color3.fromRGB(50,50,60), Enum.Material.Metal)
	P(m,"Car4", Vector3.new(10,5,5),  Vector3.new(-55,2.5,22),  carC, Enum.Material.Metal, 0, false, {0,-28,0})
	-- Windshields (dark blue glass look)
	P(m,"Wind1", Vector3.new(6,3,0.3), Vector3.new(26,4,6.6),  Color3.fromRGB(30,50,80), Enum.Material.Glass, 0.4, true)
	P(m,"Wind2", Vector3.new(6,3,0.3), Vector3.new(26,4,11.4), Color3.fromRGB(30,50,80), Enum.Material.Glass, 0.4, true)

	-- Concrete barriers (Jersey barriers — low and wide)
	local bc = Color3.fromRGB(158,153,143)
	P(m,"Bar1", Vector3.new(14,4,3),  Vector3.new(14,2,-28), bc, Enum.Material.Concrete)
	P(m,"Bar2", Vector3.new(14,4,3),  Vector3.new(-14,2,28), bc, Enum.Material.Concrete)
	P(m,"Bar3", Vector3.new(14,4,3),  Vector3.new(52,2,-46), bc, Enum.Material.Concrete, 0, false, {0,90,0})
	P(m,"Bar4", Vector3.new(14,4,3),  Vector3.new(-52,2,46), bc, Enum.Material.Concrete, 0, false, {0,90,0})
	-- Yellow safety paint on barriers
	P(m,"BarPaint1",Vector3.new(14,0.2,3.1),Vector3.new(14,4.1,-28), Color3.fromRGB(220,190,30), Enum.Material.SmoothPlastic, 0, true)
	P(m,"BarPaint2",Vector3.new(14,0.2,3.1),Vector3.new(-14,4.1,28), Color3.fromRGB(220,190,30), Enum.Material.SmoothPlastic, 0, true)

	-- Dumpsters
	P(m,"Dump1", Vector3.new(7,5,4),  Vector3.new(56,2.5,52),  Color3.fromRGB(38,88,48), Enum.Material.Metal)
	P(m,"Dump2", Vector3.new(7,5,4),  Vector3.new(-56,2.5,-52),Color3.fromRGB(38,88,48), Enum.Material.Metal)
	P(m,"DumpLid1",Vector3.new(7.2,1,4.2),Vector3.new(56,5.5,52),  Color3.fromRGB(30,70,38), Enum.Material.Metal)
	P(m,"DumpLid2",Vector3.new(7.2,1,4.2),Vector3.new(-56,5.5,-52),Color3.fromRGB(30,70,38), Enum.Material.Metal)

	-- Rubble piles
	local rc = Color3.fromRGB(108,99,88)
	P(m,"Rub1", Vector3.new(10,4,8),  Vector3.new(46,2,-18),  rc, Enum.Material.Concrete)
	P(m,"Rub2", Vector3.new(8,3,10),  Vector3.new(-46,1.5,18),rc, Enum.Material.Concrete)
	P(m,"Rub3", Vector3.new(7,3,6),   Vector3.new(0,1.5,-52), rc, Enum.Material.Concrete, 0, false, {0,20,0})
	P(m,"Rub4", Vector3.new(5,2,8),   Vector3.new(-10,1,-30), rc, Enum.Material.Concrete)

	-- Broken wall sections (partial building facades for cover)
	local wsc = Color3.fromRGB(118,108,94)
	P(m,"WSeg1", Vector3.new(4,14,22), Vector3.new(38,7,-56),  wsc, Enum.Material.Concrete)
	P(m,"WSeg2", Vector3.new(4,14,22), Vector3.new(-38,7,56),  wsc, Enum.Material.Concrete)
	P(m,"WSeg3", Vector3.new(22,14,4), Vector3.new(-66,7,-36), wsc, Enum.Material.Concrete)
	P(m,"WSeg4", Vector3.new(22,14,4), Vector3.new(66,7,36),   wsc, Enum.Material.Concrete)
	P(m,"WSeg5", Vector3.new(4,10,14), Vector3.new(60,5,60),   wsc, Enum.Material.Concrete, 0, false, {0,30,0})
	P(m,"WSeg6", Vector3.new(4,10,14), Vector3.new(-60,5,-60), wsc, Enum.Material.Concrete, 0, false, {0,30,0})

	-- Street lamps (pole + glowing head)
	local poleC = Color3.fromRGB(58,58,62)
	local lampC = Color3.fromRGB(255,215,120)
	for i, lp in ipairs({{40,0},{-40,0},{0,40},{0,-40},{62,62},{-62,-62},{62,-62},{-62,62}}) do
		Cyl(m,"Pole"..i, Vector3.new(16,1,1), Vector3.new(lp[1],8,lp[2]), poleC, Enum.Material.Metal, {0,0,90})
		P(m,"LampArm"..i, Vector3.new(4,1,1), Vector3.new(lp[1],16,lp[2]), poleC, Enum.Material.Metal)
		P(m,"LampHead"..i,Vector3.new(3,1.5,5), Vector3.new(lp[1],15.2,lp[2]+3), lampC, Enum.Material.Neon)
	end

	-- Fire hydrants
	P(m,"Hyd1",Vector3.new(2,3,2),Vector3.new(22,1.5,-17), Color3.fromRGB(200,45,35), Enum.Material.Metal)
	P(m,"Hyd2",Vector3.new(2,3,2),Vector3.new(-22,1.5,17), Color3.fromRGB(200,45,35), Enum.Material.Metal)

	setLighting({clock=22, bright=0.65, fogEnd=260,
		fogColor=Color3.fromRGB(72,52,42),
		ambient=Color3.fromRGB(52,38,32),
		outdoor=Color3.fromRGB(62,46,38)})

	makePlayerSpawn()
end

-- ════════════════════════════════════════════════════════════════
-- MAP 2 ── GRAVEYARD
-- Deep moonlit night. Tombstones, a mausoleum, dead trees with
-- branches, stone walls with iron fence tops, grave mounds.
-- ════════════════════════════════════════════════════════════════

local function buildGraveyard()
	local m = Instance.new("Folder")
	m.Name   = "Map"
	m.Parent = workspace

	local H    = ARENA/2
	local WALLH = 20

	-- Floor: dead dark grass
	P(m,"Floor", Vector3.new(ARENA,2,ARENA), Vector3.new(0,-1,0),
		Color3.fromRGB(33,44,28), Enum.Material.Grass)

	-- Dirt paths
	P(m,"PathH", Vector3.new(ARENA,0.2,10), Vector3.new(0,0,0),
		Color3.fromRGB(60,48,34), Enum.Material.Ground)
	P(m,"PathV", Vector3.new(10,0.2,ARENA), Vector3.new(0,0,0),
		Color3.fromRGB(60,48,34), Enum.Material.Ground)

	-- Cobblestone walls
	local wc = Color3.fromRGB(76,74,68)
	P(m,"WallN", Vector3.new(ARENA+4,WALLH,5), Vector3.new(0,WALLH/2,-H-2.5), wc, Enum.Material.Cobblestone)
	P(m,"WallS", Vector3.new(ARENA+4,WALLH,5), Vector3.new(0,WALLH/2, H+2.5), wc, Enum.Material.Cobblestone)
	P(m,"WallW", Vector3.new(5,WALLH,ARENA+4), Vector3.new(-H-2.5,WALLH/2,0), wc, Enum.Material.Cobblestone)
	P(m,"WallE", Vector3.new(5,WALLH,ARENA+4), Vector3.new( H+2.5,WALLH/2,0), wc, Enum.Material.Cobblestone)

	-- Iron fence tops
	local fc = Color3.fromRGB(22,22,22)
	P(m,"FenceN",Vector3.new(ARENA,3,1.2),Vector3.new(0,WALLH+1.5,-H),   fc, Enum.Material.Metal)
	P(m,"FenceS",Vector3.new(ARENA,3,1.2),Vector3.new(0,WALLH+1.5, H),   fc, Enum.Material.Metal)
	P(m,"FenceW",Vector3.new(1.2,3,ARENA),Vector3.new(-H,WALLH+1.5,0),   fc, Enum.Material.Metal)
	P(m,"FenceE",Vector3.new(1.2,3,ARENA),Vector3.new( H,WALLH+1.5,0),   fc, Enum.Material.Metal)

	-- Large tombstones (tall thin slabs at various angles)
	local sc = Color3.fromRGB(88,85,80)
	local tombPos = {
		{18,10},{-22,-12},{6,36},{-4,-36},
		{40,26},{-42,-26},{32,-32},{-30,30},
		{56,2},{-56,-2},{14,-58},{-14,58},
		{48,-46},{-50,48},{70,-20},{-70,20},
	}
	for i, tp in ipairs(tombPos) do
		local h = 7 + (i % 4) * 2
		P(m,"Tomb"..i, Vector3.new(1.5,h,5),
			Vector3.new(tp[1], h/2, tp[2]),
			sc:Lerp(Color3.fromRGB(60,58,54),(i%3)*0.15),
			Enum.Material.SmoothPlastic,
			0, false, {0,(i*37)%360,0})
		-- Cross on top of some tombstones
		if i % 3 == 0 then
			P(m,"Cross"..i, Vector3.new(0.6,3,0.6),
				Vector3.new(tp[1],h+1.5,tp[2]),
				Color3.fromRGB(70,66,60), Enum.Material.SmoothPlastic)
			P(m,"CrossBar"..i, Vector3.new(0.6,0.6,3),
				Vector3.new(tp[1],h+2.2,tp[2]),
				Color3.fromRGB(70,66,60), Enum.Material.SmoothPlastic)
		end
	end

	-- Mausoleum (large structure at back)
	local mc = Color3.fromRGB(92,88,80)
	P(m,"MausBase",  Vector3.new(18,12,15), Vector3.new(0,6,-62),   mc, Enum.Material.Cobblestone)
	P(m,"MausStep1", Vector3.new(20,2,17),  Vector3.new(0,12.5,-62),mc, Enum.Material.Cobblestone)
	P(m,"MausStep2", Vector3.new(14,2,13),  Vector3.new(0,15,-62),  Color3.fromRGB(82,78,70), Enum.Material.Cobblestone)
	P(m,"MausPeak",  Vector3.new(8,4,8),    Vector3.new(0,18,-62),  Color3.fromRGB(72,68,60), Enum.Material.Cobblestone)
	-- Door
	P(m,"MausDoor",  Vector3.new(5,8,0.8),  Vector3.new(0,4,-54.5), Color3.fromRGB(12,10,8),  Enum.Material.SmoothPlastic)
	-- Columns either side of door
	Cyl(m,"ColL", Vector3.new(12,1.5,1.5), Vector3.new(-4,6,-55), Color3.fromRGB(100,96,88), Enum.Material.Cobblestone, {0,0,90})
	Cyl(m,"ColR", Vector3.new(12,1.5,1.5), Vector3.new( 4,6,-55), Color3.fromRGB(100,96,88), Enum.Material.Cobblestone, {0,0,90})

	-- Dead trees with branches
	local treeC = Color3.fromRGB(38,28,20)
	local treePoses = {{24,-46},{-24,46},{52,58},{-52,-58},{-56,22},{56,-22},{-20,70},{20,-70}}
	for i, tp in ipairs(treePoses) do
		local h = 15 + (i % 4) * 4
		Cyl(m,"TreeTrunk"..i, Vector3.new(h,3,3), Vector3.new(tp[1],h/2,tp[2]),   treeC, Enum.Material.Wood, {0,0,90})
		Cyl(m,"BranchA"..i,   Vector3.new(7,1.5,1.5), Vector3.new(tp[1]+1,h-2,tp[2]), treeC, Enum.Material.Wood, {0,(i*50)%360,55})
		Cyl(m,"BranchB"..i,   Vector3.new(5,1.2,1.2), Vector3.new(tp[1]-1,h-4,tp[2]), treeC, Enum.Material.Wood, {0,(i*50+180)%360,65})
		Cyl(m,"BranchC"..i,   Vector3.new(6,1.2,1.2), Vector3.new(tp[1],h-3,tp[2]+1), treeC, Enum.Material.Wood, {(i*40)%360,0,58})
	end

	-- Grave mounds (low humps between tombstones)
	local moundC = Color3.fromRGB(42,54,32)
	local moundPos = {{8,14},{-8,-14},{36,4},{-36,-4},{12,-42},{-12,42},{55,-30},{-55,30}}
	for i, mp in ipairs(moundPos) do
		Ball(m,"Mound"..i, Vector3.new(7,2.5,4.5), Vector3.new(mp[1],0.5,mp[2]), moundC, Enum.Material.Grass)
	end

	-- Eerie glowing candles (neon flame effect near mausoleum)
	local candleC = Color3.fromRGB(255,180,60)
	for i, cp in ipairs({{-6,0,-54},{6,0,-54},{-8,0,-54},{8,0,-54}}) do
		P(m,"Candle"..i,  Vector3.new(0.4,1.5,0.4), Vector3.new(cp[1],0.75,cp[3]), Color3.fromRGB(200,190,170), Enum.Material.SmoothPlastic)
		P(m,"Flame"..i,   Vector3.new(0.4,0.8,0.4), Vector3.new(cp[1],1.8,cp[3]),  candleC, Enum.Material.Neon)
	end

	setLighting({clock=2, bright=0.22, fogEnd=155,
		fogColor=Color3.fromRGB(26,42,32),
		ambient=Color3.fromRGB(22,35,28),
		outdoor=Color3.fromRGB(28,42,34)})

	makePlayerSpawn()
end

-- ════════════════════════════════════════════════════════════════
-- MAP 3 ── MILITARY BASE
-- Overcast day. Shipping containers, sandbag walls, a bunker,
-- watchtower legs, floodlights, ammo crates.
-- ════════════════════════════════════════════════════════════════

local function buildMilitary()
	local m = Instance.new("Folder")
	m.Name   = "Map"
	m.Parent = workspace

	local H    = ARENA/2
	local WALLH = 24

	-- Floor: concrete with safety stripes
	P(m,"Floor", Vector3.new(ARENA,2,ARENA), Vector3.new(0,-1,0),
		Color3.fromRGB(128,122,112), Enum.Material.Concrete)

	local lc = Color3.fromRGB(215,195,28)
	for i = -3, 3 do
		P(m,"StripeH"..i, Vector3.new(2.5,0.1,ARENA*0.85), Vector3.new(i*27,0,0), lc, Enum.Material.SmoothPlastic, 0, true)
		P(m,"StripeV"..i, Vector3.new(ARENA*0.85,0.1,2.5), Vector3.new(0,0,i*27), lc, Enum.Material.SmoothPlastic, 0, true)
	end

	-- Corrugated metal walls
	local wc = Color3.fromRGB(72,70,65)
	P(m,"WallN", Vector3.new(ARENA+4,WALLH,4), Vector3.new(0,WALLH/2,-H-2), wc, Enum.Material.CorrodedMetal)
	P(m,"WallS", Vector3.new(ARENA+4,WALLH,4), Vector3.new(0,WALLH/2, H+2), wc, Enum.Material.CorrodedMetal)
	P(m,"WallW", Vector3.new(4,WALLH,ARENA+4), Vector3.new(-H-2,WALLH/2,0), wc, Enum.Material.CorrodedMetal)
	P(m,"WallE", Vector3.new(4,WALLH,ARENA+4), Vector3.new( H+2,WALLH/2,0), wc, Enum.Material.CorrodedMetal)

	-- Barbed wire along wall tops
	local wireC = Color3.fromRGB(58,52,46)
	P(m,"WireN",Vector3.new(ARENA,2.5,1.5),Vector3.new(0,WALLH+1.2,-H),    wireC, Enum.Material.Metal)
	P(m,"WireS",Vector3.new(ARENA,2.5,1.5),Vector3.new(0,WALLH+1.2, H),    wireC, Enum.Material.Metal)
	P(m,"WireW",Vector3.new(1.5,2.5,ARENA),Vector3.new(-H,WALLH+1.2,0),    wireC, Enum.Material.Metal)
	P(m,"WireE",Vector3.new(1.5,2.5,ARENA),Vector3.new( H,WALLH+1.2,0),    wireC, Enum.Material.Metal)

	-- Shipping containers (the main cover)
	local containerColors = {
		Color3.fromRGB(175,58,38),
		Color3.fromRGB(48,88,138),
		Color3.fromRGB(58,98,52),
		Color3.fromRGB(155,128,38),
		Color3.fromRGB(80,80,80),
		Color3.fromRGB(140,60,20),
	}
	local containers = {
		{pos={0,4,32},    rot=0},
		{pos={0,4,-32},   rot=0},
		{pos={38,4,0},    rot=90},
		{pos={-38,4,0},   rot=90},
		{pos={55,4,-55},  rot=42},
		{pos={-55,4,55},  rot=42},
		{pos={70,12,0},   rot=90},   -- stacked pair (second level)
		{pos={-70,12,0},  rot=90},
	}
	for i, cd in ipairs(containers) do
		local col = containerColors[((i-1)%#containerColors)+1]
		P(m,"Con"..i, Vector3.new(22,8,8), Vector3.new(cd.pos[1],cd.pos[2],cd.pos[3]),
			col, Enum.Material.Metal, 0, false, {0,cd.rot,0})
		-- Dark rust stripe along each container
		P(m,"ConStripe"..i, Vector3.new(22,1,8.1), Vector3.new(cd.pos[1],cd.pos[2]+3,cd.pos[3]),
			col:Lerp(Color3.new(0,0,0),0.35), Enum.Material.Metal, 0, true, {0,cd.rot,0})
		-- Container number label (thin coloured block)
		P(m,"ConLabel"..i, Vector3.new(3,2,8.1), Vector3.new(cd.pos[1]-8,cd.pos[2],cd.pos[3]),
			Color3.fromRGB(240,240,240), Enum.Material.SmoothPlastic, 0, true, {0,cd.rot,0})
	end

	-- Lower containers (ground floor under stacked pair)
	P(m,"ConBase1", Vector3.new(22,8,8), Vector3.new( 70,4,0),  Color3.fromRGB(65,65,68), Enum.Material.Metal, 0, false, {0,90,0})
	P(m,"ConBase2", Vector3.new(22,8,8), Vector3.new(-70,4,0),  Color3.fromRGB(65,65,68), Enum.Material.Metal, 0, false, {0,90,0})

	-- Sandbag barriers (2-layer stacked)
	local bagC = Color3.fromRGB(192,168,118)
	local bagPos = {
		{16,0,-56,0},{-16,0,56,0},{56,0,16,90},{-56,0,-16,90},
		{28,0,28,45},{-28,0,-28,45},{0,0,-20,0},{0,0,20,0},
	}
	for i, bp in ipairs(bagPos) do
		P(m,"Bags"..i,    Vector3.new(16,4,3),   Vector3.new(bp[1],2,bp[3]),   bagC, Enum.Material.Sand, 0, false, {0,bp[4],0})
		P(m,"BagsTop"..i, Vector3.new(12,3,2.5), Vector3.new(bp[1],5.5,bp[3]), bagC:Lerp(Color3.new(1,1,1),0.06), Enum.Material.Sand, 0, false, {0,bp[4],0})
	end

	-- Bunker
	P(m,"BunkBody",  Vector3.new(24,7,18),  Vector3.new(0,3.5,62),  Color3.fromRGB(118,112,106), Enum.Material.Concrete)
	P(m,"BunkRoof",  Vector3.new(26,2.5,20),Vector3.new(0,7.8,62),  Color3.fromRGB(108,102,96),  Enum.Material.Concrete)
	P(m,"BunkSlot1", Vector3.new(6,2.5,0.8),Vector3.new(-6,6.5,52.6),Color3.fromRGB(20,20,20),  Enum.Material.SmoothPlastic)
	P(m,"BunkSlot2", Vector3.new(6,2.5,0.8),Vector3.new( 6,6.5,52.6),Color3.fromRGB(20,20,20),  Enum.Material.SmoothPlastic)
	P(m,"BunkDoor",  Vector3.new(6,6,0.8),  Vector3.new(0,3,52.6),   Color3.fromRGB(45,38,30),   Enum.Material.Metal)

	-- Watchtower legs (corner towers)
	local twrC = Color3.fromRGB(82,78,70)
	for _, tp in ipairs({{78,78},{78,-78},{-78,78},{-78,-78}}) do
		for _, off in ipairs({{-3,-3},{3,-3},{-3,3},{3,3}}) do
			P(m,"TwrLeg"..tp[1]..off[1], Vector3.new(2,22,2), Vector3.new(tp[1]+off[1],11,tp[2]+off[2]), twrC, Enum.Material.Metal)
		end
		P(m,"TwrFloor"..tp[1], Vector3.new(14,1.5,14), Vector3.new(tp[1],22,tp[2]), twrC, Enum.Material.Metal)
		P(m,"TwrRail"..tp[1],  Vector3.new(14,2,1),    Vector3.new(tp[1],23.5,tp[2]), Color3.fromRGB(50,48,44), Enum.Material.Metal)
		-- Floodlight on each tower
		P(m,"Flood"..tp[1], Vector3.new(5,1.5,2.5), Vector3.new(tp[1],23.5,tp[2]), Color3.fromRGB(255,252,220), Enum.Material.Neon, 0, true)
	end

	-- Ammo crates scattered around
	local crateC = Color3.fromRGB(62,74,48)
	local cratePos = {{22,-22},{-22,22},{36,52},{-36,-52},{62,-12},{-62,12},{44,-70},{-44,70}}
	for i, cp in ipairs(cratePos) do
		P(m,"Crate"..i,    Vector3.new(5,5,5),     Vector3.new(cp[1],2.5,cp[2]), crateC, Enum.Material.Wood, 0, false, {0,(i*22)%360,0})
		P(m,"CrateLid"..i, Vector3.new(5.2,0.6,5.2),Vector3.new(cp[1],5.3,cp[2]), crateC:Lerp(Color3.new(1,1,1),0.08), Enum.Material.Wood, 0, false, {0,(i*22)%360,0})
		-- Hazard symbol (neon cross on lid)
		if i % 2 == 0 then
			P(m,"HazH"..i, Vector3.new(3,0.2,0.8), Vector3.new(cp[1],5.7,cp[2]), Color3.fromRGB(255,200,0), Enum.Material.Neon, 0, true, {0,(i*22)%360,0})
			P(m,"HazV"..i, Vector3.new(0.8,0.2,3), Vector3.new(cp[1],5.7,cp[2]), Color3.fromRGB(255,200,0), Enum.Material.Neon, 0, true, {0,(i*22)%360,0})
		end
	end

	setLighting({clock=10, bright=1.55, fogEnd=480,
		fogColor=Color3.fromRGB(152,152,162),
		ambient=Color3.fromRGB(118,118,128),
		outdoor=Color3.fromRGB(138,138,148)})

	makePlayerSpawn()
end

-- ════════════════════════════════════════════════════════════════
-- MAP 4 ── DARK FOREST
-- Pre-dawn, heavy fog. Massive boulders, fallen mossy logs, dead
-- tree stumps, ancient stone ruins, glowing mushrooms.
-- ════════════════════════════════════════════════════════════════

local function buildForest()
	local m = Instance.new("Folder")
	m.Name   = "Map"
	m.Parent = workspace

	local H    = ARENA/2
	local WALLH = 20

	-- Floor: dark grass
	P(m,"Floor", Vector3.new(ARENA,2,ARENA), Vector3.new(0,-1,0),
		Color3.fromRGB(30,40,23), Enum.Material.Grass)

	-- Muddy dirt paths
	P(m,"PathH", Vector3.new(ARENA,0.2,16), Vector3.new(0,0,0),
		Color3.fromRGB(68,52,36), Enum.Material.Ground)
	P(m,"PathV", Vector3.new(16,0.2,ARENA), Vector3.new(0,0,0),
		Color3.fromRGB(68,52,36), Enum.Material.Ground)

	-- Log/plank walls
	local wc = Color3.fromRGB(55,40,26)
	P(m,"WallN", Vector3.new(ARENA+4,WALLH,5), Vector3.new(0,WALLH/2,-H-2.5), wc, Enum.Material.Wood)
	P(m,"WallS", Vector3.new(ARENA+4,WALLH,5), Vector3.new(0,WALLH/2, H+2.5), wc, Enum.Material.Wood)
	P(m,"WallW", Vector3.new(5,WALLH,ARENA+4), Vector3.new(-H-2.5,WALLH/2,0), wc, Enum.Material.Wood)
	P(m,"WallE", Vector3.new(5,WALLH,ARENA+4), Vector3.new( H+2.5,WALLH/2,0), wc, Enum.Material.Wood)

	-- Moss patches on lower walls (no collision)
	local mossC = Color3.fromRGB(32,58,22)
	P(m,"MossN", Vector3.new(ARENA,5,0.6), Vector3.new(0,4,-H-0.5), mossC, Enum.Material.Grass, 0.2, true)
	P(m,"MossS", Vector3.new(ARENA,5,0.6), Vector3.new(0,4, H+0.5), mossC, Enum.Material.Grass, 0.2, true)
	P(m,"MossW", Vector3.new(0.6,5,ARENA), Vector3.new(-H-0.5,4,0), mossC, Enum.Material.Grass, 0.2, true)
	P(m,"MossE", Vector3.new(0.6,5,ARENA), Vector3.new( H+0.5,4,0), mossC, Enum.Material.Grass, 0.2, true)

	-- Large boulders (Ball shapes)
	local rockC = Color3.fromRGB(85,80,74)
	local boulders = {
		{22,3,16,8},  {-22,2,-16,7}, {0,3,-44,9},  {44,2,30,7},
		{-44,3,-30,8},{62,2,-6,6},   {-62,2,6,7},  {30,2,-62,8},
		{-30,3,62,7}, {55,2,55,6},   {-55,3,-55,7},{0,3,65,8},
	}
	for i, b in ipairs(boulders) do
		local s = b[4]
		Ball(m,"Boulder"..i, Vector3.new(s,s*0.72,s*0.9),
			Vector3.new(b[1],b[2],b[3]),
			rockC:Lerp(Color3.fromRGB(58,54,48),(i%4)*0.1), Enum.Material.SmoothPlastic)
		-- Smaller rock cluster
		Ball(m,"Pebble"..i, Vector3.new(s*0.38,s*0.28,s*0.38),
			Vector3.new(b[1]+s*0.4+1,b[2]*0.35,b[3]+1),
			Color3.fromRGB(72,68,62), Enum.Material.SmoothPlastic)
	end

	-- Fallen logs (horizontal cylinders, various angles)
	local logC = Color3.fromRGB(52,36,20)
	local logs = {
		{10,2,-26,28},  {-10,2,26,-35},
		{52,2,52,62},   {-52,2,-52,15},
		{-32,2,46,80},  {32,2,-46,-22},
		{72,2,-30,50},  {-72,2,30,50},
	}
	for i, l in ipairs(logs) do
		Cyl(m,"Log"..i, Vector3.new(24,3.5,3.5), Vector3.new(l[1],l[2],l[3]),
			logC, Enum.Material.Wood, {0,l[4],0})
		-- Moss strip on top of log (no collision)
		P(m,"LogMoss"..i, Vector3.new(22,1,3.4),
			Vector3.new(l[1],l[2]+2.8,l[3]),
			mossC, Enum.Material.Grass, 0.1, true, {0,l[4],0})
	end

	-- Tree stumps (short wide vertical cylinders)
	local stumpC = Color3.fromRGB(60,42,25)
	local stumps = {
		{38,0,-18},{-38,0,18},{0,0,40},{14,0,58},
		{-14,0,-58},{-66,0,-14},{66,0,14},{44,0,68},{-44,0,-68},
	}
	for i, s in ipairs(stumps) do
		local d = 5 + (i % 4)   -- diameter varies 5–8
		Cyl(m,"Stump"..i, Vector3.new(4.5,d,d), Vector3.new(s[1],2.25,s[3]),
			stumpC, Enum.Material.Wood, {0,0,90})
		-- Tree rings on cut surface (no collision)
		P(m,"StumpRing"..i, Vector3.new(0.1,d*0.85,d*0.85),
			Vector3.new(s[1]+2.3,2.25,s[3]),
			Color3.fromRGB(75,52,32), Enum.Material.Wood, 0, true, {0,0,90})
	end

	-- Ancient stone pillar ruins
	local ruinC = Color3.fromRGB(92,86,76)
	local ruins = {{-22,0,66},{22,0,-66},{-72,0,32},{72,0,-32},{50,0,80},{-50,0,-80}}
	for i, r in ipairs(ruins) do
		local h = 7 + (i%4)*3
		-- Leaning slightly for character
		P(m,"Pillar"..i, Vector3.new(4.5,h,4.5), Vector3.new(r[1],h/2,r[3]),
			ruinC, Enum.Material.Cobblestone, 0, false, {0,i*25,2})
		-- Scattered base rubble
		P(m,"PBase"..i, Vector3.new(7,2,7), Vector3.new(r[1],1,r[3]),
			ruinC:Lerp(Color3.new(0,0,0),0.15), Enum.Material.Cobblestone)
		-- Crumbled chunk nearby
		P(m,"PChunk"..i, Vector3.new(3,2,3), Vector3.new(r[1]+4,0.8,r[3]+3),
			ruinC, Enum.Material.Cobblestone, 0, false, {0,i*40,8})
	end

	-- Tall living trees (background, near walls — visual only, no collision)
	local livTreeC = Color3.fromRGB(35,26,16)
	local liveTrees = {{82,25},{82,-25},{-82,25},{-82,-25},{25,82},{-25,82},{25,-82},{-25,-82}}
	for i, t in ipairs(liveTrees) do
		local h = 28 + (i%3)*8
		Cyl(m,"BigTrunk"..i, Vector3.new(h,5,5), Vector3.new(t[1],h/2,t[2]),
			livTreeC, Enum.Material.Wood, 0, true, {0,0,90})
		-- Canopy blob
		Ball(m,"Canopy"..i, Vector3.new(14,10,14), Vector3.new(t[1],h+4,t[2]),
			Color3.fromRGB(20,30,14), Enum.Material.Grass, 0.15, true)
	end

	-- Glowing mushrooms (Neon, purely decorative — no collision)
	local mushC  = Color3.fromRGB(80,255,110)
	local mushC2 = Color3.fromRGB(55,200,80)
	local mushPos = {{5,2},{-5,-2},{18,-9},{-18,9},{28,22},{-28,-22},{8,35},{-8,-35}}
	for i, mp in ipairs(mushPos) do
		Cyl(m,"MushStem"..i, Vector3.new(2.5,1.8,1.8), Vector3.new(mp[1],1.25,mp[2]),
			Color3.fromRGB(200,230,200), Enum.Material.Neon, 0.3, true, {0,0,90})
		Ball(m,"MushCap"..i, Vector3.new(3.5,2,3.5), Vector3.new(mp[1],2.8,mp[2]),
			mushC:Lerp(mushC2,(i%3)*0.4), Enum.Material.Neon, 0.25, true)
	end

	setLighting({clock=4, bright=0.28, fogEnd=145,
		fogColor=Color3.fromRGB(16,30,18),
		ambient=Color3.fromRGB(16,26,18),
		outdoor=Color3.fromRGB(20,32,22)})

	makePlayerSpawn()
end

-- ════════════════════════════════════════════════════════════════
-- PUBLIC API
-- ════════════════════════════════════════════════════════════════

local BUILDERS = {
	City      = buildCity,
	Graveyard = buildGraveyard,
	Military  = buildMilitary,
	Forest    = buildForest,
}

Maps.ALL = {"City", "Graveyard", "Military", "Forest"}

-- Remove old map, spawns and player spawn from workspace
function Maps.clearAll()
	for _, name in ipairs({"Map","ZombieSpawns","SpawnLocation"}) do
		local obj = workspace:FindFirstChild(name)
		if obj then obj:Destroy() end
	end
	-- Remove Roblox default Baseplate if present
	local bp = workspace:FindFirstChild("Baseplate")
	if bp then bp:Destroy() end
end

-- Build a named map; also creates ZombieSpawns folder + returns mapName
function Maps.build(mapName)
	Maps.clearAll()

	local builder = BUILDERS[mapName]
	if not builder then
		warn("[Maps] Unknown map '"..tostring(mapName).."' — using City")
		mapName  = "City"
		builder  = buildCity
	end

	builder()

	-- Create zombie spawn ring (12 points around the arena edge)
	local sf = Instance.new("Folder")
	sf.Name   = "ZombieSpawns"
	sf.Parent = workspace
	local r = ARENA/2 - 6
	for i = 1, 12 do
		local a = (i-1) * (math.pi*2/12)
		local sp = Instance.new("Part")
		sp.Name        = "Spawn"..i
		sp.Anchored    = true
		sp.CanCollide  = false
		sp.Transparency= 1
		sp.Size        = Vector3.new(4,1,4)
		sp.CFrame      = CFrame.new(math.cos(a)*r, 2, math.sin(a)*r)
		sp.Parent      = sf
	end

	print("[Maps] Built: "..mapName)
	return mapName
end

-- Return a random map name, optionally excluding one (for variety between rounds)
function Maps.random(exclude)
	local pool = {}
	for _, name in ipairs(Maps.ALL) do
		if name ~= exclude then
			table.insert(pool, name)
		end
	end
	return pool[math.random(1, #pool)]
end

return Maps
