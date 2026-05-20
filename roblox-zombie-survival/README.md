# Zombie Wave Survival — Roblox Game

A wave-based zombie shooter where players buy weapons between rounds and try to survive as long as possible.

---

## How to set it up in Roblox Studio

### 1. Create the place
- Open **Roblox Studio** → New → Baseplate (or any map you like).

### 2. Add the scripts

| File | Where to put it in Studio |
|---|---|
| `GameConfig.lua` | `ReplicatedStorage` → new ModuleScript named `GameConfig` |
| `RemoteEvents.lua` | `ReplicatedStorage` → new ModuleScript named `RemoteEvents` |
| `GameManager.server.lua` | `ServerScriptService` → new Script named `GameManager` |
| `DamageHandler.server.lua` | `ServerScriptService` → new Script named `DamageHandler` |
| `ShootingController.client.lua` | `StarterPlayer → StarterPlayerScripts` → new LocalScript named `ShootingController` |
| `HUD.lua` | `StarterGui` → new ScreenGui named `HUD` → LocalScript inside it named `HUD` |

### 3. Add zombie spawn points
- In the **Workspace**, create a `Folder` named `ZombieSpawns`.
- Inside it, add a few `Part` objects (any size/color) placed around the edges of your map. Zombies will spawn at these.

### 4. Give players a starter weapon
- `StarterPack` → new **Tool** named `Pistol`.
- Inside the tool, add `NumberValue` parts matching these names from `GameConfig.WEAPONS.Pistol`:
  - `damage` = 25, `fireRate` = 2, `ammo` = 30, `reloadTime` = 1.5, `range` = 60, `cost` = 0

### 5. Test it
- Press **Play** in Studio. A 5-second grace period fires, then Wave 1 starts.
- Shoot zombies → earn coins → survive the wave → buy upgrades in the shop.

---

## How to make money from it

### Gamepasses (set IDs in `GameConfig.GAMEPASSES`)
| Gamepass | Suggested price | What it does |
|---|---|---|
| Double Coins | 99–199 Robux | 2× coin rewards all game |
| VIP Weapon | 149 Robux | Gives Rifle for free at start |
| Extra Life | 75 Robux | One free revive per round |

### Developer Products (one-time purchases mid-game)
- **50 Coins** for 25 Robux
- **Full Ammo Refill** for 25 Robux
- Implement via `MarketplaceService:PromptProductPurchase` on the client and `ProcessReceipt` on the server.

### Tips for more players (= more money)
1. Make a **good thumbnail** — it's the #1 factor for clicks.
2. Use `game.PlaceId` to submit to Roblox's **Sponsored Games** for initial traffic (even $5 goes far).
3. Add a **leaderboard** showing highest wave survived — players come back to beat each other.
4. Post short clips on **TikTok / YouTube Shorts** of yourself playing.

---

## Game structure overview

```
ReplicatedStorage/
  GameConfig      ← all balance numbers live here, easy to tune
  RemoteEvents    ← creates and exports all Remote events/functions

ServerScriptService/
  GameManager     ← round loop, zombie spawning, coin ledger, shop logic
  DamageHandler   ← server-authoritative damage from player shots

StarterPlayerScripts/
  ShootingController  ← raycast shooting, ammo tracking, bullet trail VFX

StarterGui/
  HUD/HUD         ← wave banner, health bar, coins, kill feed, shop panel
```

---

## Expanding the game (ideas)
- Add more zombie types in `GameConfig.ZOMBIES`
- Add more waves in `GameConfig.WAVES` (or make them procedural after wave 10)
- Add a **barricade** players can repair between waves
- Add **perks** (speed boost, regen) as purchasable upgrades
- Add a **prestige / rebirth** system for long-term players
