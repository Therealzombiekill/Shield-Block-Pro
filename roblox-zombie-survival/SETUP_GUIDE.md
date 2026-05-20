# Zombie Wave Survival — Complete Setup Guide

A wave-based zombie shooter. Players shoot zombies, earn coins, buy better guns between waves, and try to survive as long as possible.

---

## Step 1 — Download Roblox Studio

Go to **roblox.com/create** and download Roblox Studio for free. Sign in with your Roblox account.

---

## Step 2 — Create a new place

1. Open Roblox Studio
2. Click **New** at the top
3. Choose **Baseplate** template
4. Click **Create**

---

## Step 3 — Add the 4 game files

You need to add exactly **4 scripts** into specific locations. Here's where each one goes:

### File 1: `GameConfig.lua`
- In the **Explorer** panel (left side), find **ReplicatedStorage**
- Right-click it → **Insert Object** → choose **ModuleScript**
- Rename it to exactly: `GameConfig`
- Delete all the default code inside it
- Paste the entire contents of `GameConfig.lua` from this folder

### File 2: `Maps.lua`
- In Explorer, find **ReplicatedStorage** again
- Right-click it → **Insert Object** → choose **ModuleScript**
- Rename it to exactly: `Maps`
- Delete all the default code inside it
- Paste the entire contents of `Maps.lua` from this folder

### File 3: `Main.server.lua`
- In Explorer, find **ServerScriptService**
- Right-click it → **Insert Object** → choose **Script**
- Rename it to: `Main`
- Delete all default code inside it
- Paste the entire contents of `Main.server.lua`

### File 4: `Client.client.lua`
- In Explorer, expand **StarterPlayer** → click on **StarterPlayerScripts**
- Right-click **StarterPlayerScripts** → **Insert Object** → choose **LocalScript**
- Rename it to: `Client`
- Delete all default code inside it
- Paste the entire contents of `Client.client.lua`

---

## Step 4 — Press Play and test it

1. Click the big **▶ Play** button at the top of Studio
2. Wait 5 seconds — the game auto-starts
3. You'll see the arena build itself (walls, floor, cover boxes)
4. After 10 seconds, **Wave 1** starts — zombies spawn at the edges
5. **Left-click** to shoot
6. **R** to reload
7. Kill zombies → earn coins → buy better guns in the shop between waves

---

## What each script does

| Script | Location | What it does |
|---|---|---|
| `GameConfig` | ReplicatedStorage | All the numbers — zombie health, weapon damage, wave definitions. Easy to edit. |
| `Maps` | ReplicatedStorage | Builds all 4 maps (City, Graveyard, Military, Forest). Picks a new one each round. |
| `Main` | ServerScriptService | Runs the game loop, spawns zombies, handles purchases, manages coins. |
| `Client` | StarterPlayerScripts | The entire HUD (health bar, wave info, kill feed, shop panel) + shooting system. |

---

## How to customize the game

Open `GameConfig.lua` to change anything:

**Make zombies easier/harder:**
```lua
Walker = { health = 60, speed = 10, ... }  -- lower health or speed = easier
```

**Change weapon prices:**
```lua
Shotgun = { ..., cost = 150 }  -- change 150 to any price
```

**Add more waves:**
```lua
[11] = { {type="Boss", count=4}, {type="Tank", count=8} },
```

**Change how many coins players start with:**
```lua
GameConfig.START_COINS = 60  -- change this number
```

---

## How to make money from the game

### 1. Create Gamepasses in Roblox
Go to your game page → **Store** tab → Create Gamepass. Suggested ones:

| Gamepass name | Price | What to tell buyers |
|---|---|---|
| Double Coins | 99 Robux | Earn 2× coins from every zombie kill |
| Starter Rifle | 149 Robux | Spawn with a free Rifle every round |
| Extra Life | 75 Robux | Free revive once per round |

After creating them, Roblox gives you a **Gamepass ID number**. Put it in `GameConfig.lua`:
```lua
GameConfig.GAMEPASSES = {
    DoubleCoins  = 123456789,  -- replace with your real ID
    StarterRifle = 987654321,  -- replace with your real ID
    ExtraLife    = 111222333,  -- replace with your real ID
}
```

### 2. Publish the game
- File → **Publish to Roblox**
- Make it **Public**
- Add a thumbnail (huge for clicks — use Canva or screenshots from the game)

### 3. Get players
- Roblox's algorithm rewards games that keep players long (high average session time)
- Post 30-second TikToks / YouTube Shorts of yourself playing
- Spend $5–10 on **Roblox Sponsored Ads** to get your first 100 players
- Add a leaderboard showing the highest wave ever reached — gives players a reason to return

---

## Troubleshooting

**"The arena doesn't build / I just see a baseplate"**
→ Make sure `Main` is a **Script** (not LocalScript) inside **ServerScriptService**

**"I can't shoot / clicking does nothing"**
→ Make sure `Client` is a **LocalScript** (not Script) inside **StarterPlayerScripts**

**"Zombies don't move"**
→ This is a Humanoid pathfinding issue. Make sure the floor Part exists and is not set to Anchored with CanCollide = false.

**"Error: GameConfig is not a valid member of ReplicatedStorage"**
→ You named the ModuleScript wrong. It must be named exactly `GameConfig` (capital G and C, no spaces).

**"Coins don't update"**
→ Check the **Output** panel (View → Output) for any red error messages and share them.
