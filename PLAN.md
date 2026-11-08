# 《請問巧馨，今天要排擠誰?》實作計畫

## Context
為 11/28（迪西）與 11/29（巧馨）兩位壽星製作的慶生網頁遊戲。專案資料夾 `C:\Users\aa37a\Downloads\今天要排擠誰` 目前是空的，從零開始。
目標：一個**單一 `index.html`**、零依賴、純 Canvas 2D 繪圖 + Web Audio 合成音效的「荒野亂鬥式」對稱競技場射擊遊戲，上傳 GitHub Pages 點開即玩，支援手機（含 LINE 內嵌瀏覽器）與電腦。單局約 2.5 分鐘，結局是時鐘跨日、全場一起慶生。

### 已確認的決策
| 項目 | 決定 |
|---|---|
| Boss | **巧馨本人**（需求中「朋友B」為筆誤） |
| 檔案 | **單一 `index.html`**，JS/CSS 全內嵌 |
| 難度 | **可選難度**：🎂 壽星模式（簡單，死亡可從當前階段重來）/ 😈 排擠模式（困難，死亡從頭） |
| 客製文字 | 程式頂部預留 `CONFIG` 物件，先放通用文字，之後可自行修改 |

我自行決定的預設（如需更改請在確認時告知）：
- 無排行榜/無後端；最佳通關時間存 `localStorage`（try/catch 保護）。
- 中文字用系統字型（`"PingFang TC","Microsoft JhengHei",sans-serif`），不載入像素字型以維持零依賴。
- 有 8-bit 戰鬥 BGM（可靜音按鈕）。
- 實作後第一步：把本計畫存為專案內的 `PLAN.md`。
- **美術確定只用程式繪製**（使用者確認）：不載入任何圖檔。先前建立的空 `assets/` 資料夾（只有 `.gitkeep`）用不到，S0 時刪除，以免上傳後讓人誤以為缺素材。
- 使用者想先看像素風格效果 → 在寫遊戲邏輯之前，先做 **S1.5 像素素材預覽**（`index.html?gallery=1`），確認畫風後再繼續。

---

## 1. 檔案結構（單一 index.html 內的程式區段順序）
```
index.html
├─ <meta viewport: width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover>
├─ <style>  全螢幕 canvas、touch-action:none、user-select:none、安全區 env(safe-area-inset-*)
├─ <canvas id="game">
└─ <script> ('use strict'，以區段註解分隔)
   §0 CONFIG        可客製文字、難度倍率、平衡數值
   §1 Utils         數學、亂數、clamp、lerp、向量、物件池 Pool
   §2 Audio         AudioEngine + SFX 函數 + 音序器（BGM / 生日快樂歌）
   §3 Input         InputManager（鍵鼠 + Pointer Events 多指觸控）
   §4 Sprites       像素圖定義（字串陣列 + 調色盤）→ 預渲染至離屏 canvas 快取
   §5 Map           象限陣列 → 鏡像生成全圖、tile 查詢、預渲染地板層、流場尋路
   §6 Entities      實體工廠 + 元件 + 各系統（移動/AI/武器/碰撞/生命/掉落/特效）
   §7 Collision     圓 vs tile、圓 vs 圓、子彈步進、空間雜湊格
   §8 Director      關卡時間軸、波次生成、階段切換
   §9 Boss          巧馨 AI 狀態機與招式
   §10 Render       攝影機、圖層排序、HUD、虛擬按鈕、過場畫面
   §11 States       遊戲狀態機
   §12 Main         啟動、固定步長主迴圈、resize、visibilitychange
```

## 2. 遊戲狀態機
每個狀態是 `{enter(), update(dt), render(ctx), exit()}`，由 `Game.setState(name, params)` 切換。

```
BOOT ──(首次點擊：解鎖 AudioContext)──► TITLE
TITLE ──(選難度)──► INTRO（劇情：23:59:58→迪西偷鐘→定格 23:59:59→巧馨爆氣；可點擊跳過）
INTRO ──► PLAYING(phase=1) ──(50s)──► PLAYING(phase=2) ──(100s)──► BOSS_INTRO
BOSS_INTRO（「巧馨 已加入群組」橫幅、震螢幕、Boss 落地，玩家無敵、不可放大招）──► BOSS
BOSS ──(Boss HP=0)──► VICTORY（清場、指針 23:59:59→00:00:00、小怪戴派對帽、彩帶、生日歌）──► ENDING
ENDING（兩位壽星並排慶生 + CONFIG 祝福語 + 通關時間 + 「再玩一次」）──► TITLE
PLAYING / BOSS ──(玩家 HP=0)──► GAMEOVER
GAMEOVER ──壽星模式「從本階段重來」──► 該階段 checkpoint；「回主選單」──► TITLE
         ──排擠模式「重新開始」──► INTRO 後的 PLAYING(phase=1)
任何遊戲中狀態 ──(ESC/P、暫停鈕、visibilitychange hidden)──► PAUSED（疊加層，保留下層狀態）
```
- Checkpoint：進入 phase 2 / BOSS 時存快照（玩家滿血、大招能量保留、清空場上敵人與子彈）。
- `PAUSED` 時 `audioCtx.suspend()`，恢復時 `resume()`。

## 3. 主迴圈與座標系
- **固定步長** 1/60 s 累加器；`dt` 上限 0.1 s 防止切回分頁時爆衝；渲染每幀一次。
- **世界座標**：tile = 64 px，地圖 30×20 tiles = 1920×1280 世界單位。
- **攝影機**：跟隨玩家（lerp 平滑）並夾在地圖邊界內。縮放 `zoom = min(viewW/960, viewH/640)` 的變形：
  - 橫式：視野短邊約 640 世界單位。
  - 直式：視野寬約 600 世界單位（保證看得到周圍）。
- Canvas 實際尺寸 = `innerWidth × innerHeight × min(devicePixelRatio, 2)`；`imageSmoothingEnabled=false`。
- 使用 `window.innerHeight`（不用 100vh，LINE/iOS 工具列會誤差），監聽 `resize` + `orientationchange`（延遲 200 ms 再量一次）。

## 4. 實體架構（輕量 Entity-Component）
實體是純物件，以「是否具備某元件欄位」決定被哪些系統處理；子彈/粒子/浮字使用**物件池**。

| 元件 | 欄位 |
|---|---|
| `transform` | x, y, vx, vy, facing |
| `collider` | r（圓半徑）, solid, team(`player`/`enemy`/`neutral`) |
| `health` | hp, maxHp, invuln（受傷無敵秒數）, flash |
| `sprite` | key, scale, anim 幀計時, hat(派對帽) |
| `mover` | speed, 加速度, 是否受時停影響 `timeAffected` |
| `weapon` | ammo, maxAmmo, reloadT, pattern(扇形數/角度/射程/傷害) |
| `ai` | type, state, timers, target(上次已知玩家位置) |
| `lifetime` | t（到期移除，掉落物 12s，最後 3s 閃爍） |
| `bubble` | text, t（頭頂彈幕文字） |
| `drop` | kind(`heart`/`spring`), value |

系統執行順序（每 tick）：Input → PlayerControl → AI → Weapon → Movement(含 tile 碰撞) → Bullet 步進 → 實體碰撞/傷害 → Health/死亡/掉落 → Pickup → Lifetime → Director → Particles → Camera。

全域 `world.timeScaleEnemy`：時停時 = 0（Boss 為 0.25），套用在敵人移動、AI 計時器、敵方子彈、Boss 招式預警計時上；玩家與玩家子彈不受影響。

### 數值表（normal 基準，難度倍率見 §10）
| 對象 | 數值 |
|---|---|
| 迪西 | HP 100、速度 260、碰撞半徑 18、受傷無敵 0.5s |
| 拉炮普攻 | 5 發扇形 30°、射程 420、每發傷害 8、彈速 700、彈匣 3 格、每格填裝 0.7s、射擊間隔 0.25s |
| 大招 時鐘暫停 | 能量 100；小怪掉發條 +10、精英 +30；全場敵人+敵彈定格 3s（Boss 減速至 25%） |
| 排擠兵（P1） | HP 20、速度 95、接觸傷害 10（每 0.8s）、掉發條 40%、掉愛心 5% |
| 酸民射手（P1後段） | HP 16、保持距離 300、每 2s 射 1 發慢彈（彈速 220、傷害 8） |
| 暴走群主（P2 衝撞） | HP 80、預警紅線 0.6s → 衝刺 650 速 0.5s、撞牆暈 0.8s、傷害 20 |
| 已讀不回（P2 追擊） | HP 40、速度 175、蛇行追擊、傷害 12 |
| 巧馨 Boss | HP 1500、半徑 48、見 §9 |
| 派對木箱 | HP 24（3 發），碎裂掉落：愛心 45%（+25 HP）/ 發條 25% |

## 5. 對稱競技場地圖
### 5.1 象限定義 + 鏡像
只手寫左上象限 15×10，程式鏡像出 30×20：
```js
full[r][c] = Q[ r < 10 ? r : 19 - r ][ c < 15 ? c : 29 - c ]
```
→ 自動保證上下、左右完全對稱。

```
符號: # 牆(不可破)  . 地板  C 派對木箱(可破)  B 灌木草叢  S 敵人出生點(地板)
      c=0         c=14
r0   "###############"
r1   "#S...........S."   ← r1c14 鏡像後成頂部中央 2 格出生口
r2   "#..BB....C....."
r3   "#..BB..###....."
r4   "#......#....C.."
r5   "#..C......BBB.."
r6   "#..C......BBB.."
r7   "#....##........"
r8   "#....##....C..."
r9   "#S............."   ← 左側中央出生口；r9-10 c14-15 為中央空地＝玩家出生點
```
設計原則（實作時以 `validateMap()` 驗證）：
1. 外圈全牆；出生點 `S` 位於四角、四邊中點（共 8 組），敵人只從這些點進場。
2. 中央 4×4 保持空地給玩家出生；出生點與玩家初始距離 ≥ 500。
3. 灌木群放在中段兩側（L 形與 3×2 塊），木箱散佈在通道轉角做掩體。
4. 從中央對每個 `S` 做 BFS，必須全部可達（木箱視為可通行，因可被打破；但阻擋移動）。
5. 任何兩道牆之間的通道寬 ≥ 2 tiles，避免卡怪。

### 5.2 Tile 資料
- `tiles: Uint8Array(30*20)`；`crateHp: Map<index,hp>`。
- 地板層 + 牆預渲染到一張離屏 canvas（格紋地毯 + 派對彩點）；木箱與灌木每幀單獨畫（木箱會被打碎，灌木需要半透明）。
- 木箱被打破：tile 改成地板、噴木屑粒子、依機率掉落、標記流場需重算。
- Boss 蛋糕砸到木箱：木箱直接破壞。

### 5.3 流場尋路（敵人追蹤）
- 以「玩家所在 tile」（若隱身則為上次已知位置）為源做 BFS，得到每格距離；每 0.25s 或玩家換格/木箱破壞時重算（600 格，極便宜）。
- 敵人：若與目標有直線視線（tile 射線檢查）→ 直接朝目標；否則沿流場往距離更小的鄰格移動。
- 分離力（separation）避免敵人疊成一團，用空間雜湊格查鄰居。

## 6. 碰撞判定
| 情境 | 算法 |
|---|---|
| 圓 vs 牆/木箱 tile | 取圓的 AABB 覆蓋的 tile，對每個實心 tile 求最近點；若距離 < r，沿法線推出。**X 軸、Y 軸分開移動分開解算**，避免卡角，達成平滑貼牆滑行 |
| 圓 vs 圓（實體互撞、子彈命中、接觸傷害、拾取） | `dx²+dy² < (r1+r2)²` |
| 子彈 vs tile | 每 tick 依速度分成 `ceil(speed*dt/16)` 子步檢查，防止穿牆；打到木箱扣 HP，打到牆生成小火花 |
| 寬相位 | 空間雜湊格（cell 128）：敵人每 tick 重建；子彈只查附近格 |
| 灌木隱身 | 玩家中心所在 tile 為 `B` → `player.hidden = true`；在草叢中開槍或受傷後顯形 1.2s。敵人距玩家 < 110 仍能看見。隱身時敵人追「上次已知位置」，到達後隨機遊走 |
| Boss 蛋糕 AoE | 圓形範圍判定（落地瞬間一次） |

## 7. 輸入系統
`InputManager` 每 tick 輸出統一結構：`{ move:{x,y}, aim:{x,y}|null, fireHeld, firePressed, ultPressed, pausePressed, aimMode:'auto'|'manual' }`。

- **電腦**：WASD / 方向鍵移動（對角正規化）；滑鼠位置＝瞄準（換算為世界座標）；左鍵按住連射；空白鍵大招；ESC/P 暫停。
- **觸控**（Pointer Events，以 `pointerId` 追蹤多指）：
  - 左半螢幕：**浮動搖桿**，手指落點即搖桿中心，半徑 60 CSS px，死區 0.15。
  - 右下「🎉 拉炮」鈕：**點一下＝自動瞄準最近可見敵人**；**按住拖曳＝手動瞄準**（顯示瞄準扇形），放開發射。
  - 「⏱ 時停」鈕位於拉炮鈕左上方，能量滿時發光。
  - 右上「⏸」暫停、「🔊」靜音。
- 偵測方式：收到 `pointerType==='touch'` 後顯示虛擬按鈕；收到滑鼠移動則隱藏。
- 邊界：`pointercancel` / `blur` 時重置所有按鍵與搖桿；`preventDefault` 防止捲動、雙擊縮放、長按選單（`contextmenu`）。
- 按鈕位置依 `safe-area-inset` 與直/橫式重新計算。

## 8. 關卡導演（Director）時間軸
資料驅動的波次表 `TIMELINE`（秒數、出生點組、怪種、數量、間隔），場上敵人上限 40（困難 55）。

| 時間 | 內容 |
|---|---|
| 0–8s | 教學提示浮字（移動/射擊/草叢/大招），少量排擠兵 |
| 8–50s | **Phase 1**：排擠兵成群湧入，強度逐漸上升；30s 後加入酸民射手。頭頂彈幕從 `CONFIG.taunts.p1` 隨機抽（「還我11/29」「退群」「已讀」「+1」「排擠他」…） |
| 50s | 橫幅「精英群友上線」，存 checkpoint |
| 50–100s | **Phase 2**：暴走群主（衝撞）、已讀不回（追擊）+ 排擠兵混合 |
| 100s | 清場（剩餘小怪自動「退出群組」消散），存 checkpoint → BOSS_INTRO |
| 100s~ | **Phase 3**：巧馨，約 45–60s 擊敗 |

右上 HUD 的時鐘始終顯示「23:59:59」並閃爍（劇情：時間停止），旁邊顯示階段名稱。

## 9. Boss：巧馨
外觀：大型像素角色（32×32 放大 3 倍）、頭頂「差一秒!!」怒氣符號，獨立畫面頂部血條「巧馨（11/29 壽星・爆氣中）」。

Boss AI 為招式狀態機：`IDLE(移動) → 選招 → TELEGRAPH(預警) → EXECUTE → RECOVER`，所有計時器乘上 `timeScaleEnemy`。

| 血量階段 | 招式 |
|---|---|
| 100–66% | **群組廣播**：環形 16 發彈幕；**@所有人**：朝玩家 3 連發扇形；緩慢追蹤 |
| 66–33% | 追加 **巨型蛋糕砸地**：玩家位置出現陰影圈 1.2s → 落地半徑 110、傷害 25、震螢幕、摧毀木箱，留下 4s 蛋糕殘骸（障礙）；**召喚排擠兵** 4 隻 |
| 33–0% | 爆氣（變紅、台詞「我只差一秒啊!!!」）：**螺旋彈幕**（雙臂旋轉 4s）、**蛋糕雨** 同時 3 顆、移速 +30% |

- 進入新血量階段時：短暫無敵 1s + 台詞泡泡 + 清掉自身彈幕避免不公平。
- 敵方彈幕上限 300，超過則不再生成。
- 死亡：慢動作 0.5s、白閃 → VICTORY。

## 10. 難度與 CONFIG
```js
const CONFIG = {
  names: { hero:'迪西', boss:'巧馨', heroBday:'11/28', bossBday:'11/29' },
  taunts: { p1:[...], p2:[...], boss:[...] },
  endingMessage: '迪西 & 巧馨 生日快樂！🎂',
  difficulty: {
    easy: { label:'🎂 壽星模式', playerHp:150, enemyHp:0.8, enemyDmg:0.6, spawn:0.75, bossHp:1100, checkpoint:true },
    hard: { label:'😈 排擠模式', playerHp:100, enemyHp:1.2, enemyDmg:1.0, spawn:1.2,  bossHp:1800, checkpoint:false },
  },
  debug: false   // 或網址 ?debug=1
};
```
Debug 參數（開發驗證用）：`?debug=1` 顯示碰撞框/FPS/流場；`?phase=2|3` 直接跳階段；`?god=1` 無敵。

## 11. 渲染
- **像素圖（畫風 v2，使用者確認方向）**：32px 精緻像素、溫暖戶外競技場配色（沙土地、暖色石牆、綠草叢、木箱）。以程式化 `Painter`（橢圓／多邊形／線條＋自動外框）在低解析格子上繪製，所有物件 2 倍顯示（32px = 64 世界單位 = 1 格）。受傷白閃／時停灰階以像素後處理產生。
  - **畫質 v3（依使用者附圖）**：角色改為高解析 Q 版比例，`Painter` 新增 5 階光影（`ellipseS/capsuleS/rrectS/polyS`，光源左上）、同色系加深外框（`outlineAuto`）與內部輪廓線。角色在遊戲中約 1.5 倍顯示（迪西寬約 1 格、高約 1.6 格）。
  - 迪西（44×74）：綠色天線小寶寶造型（彎天線、耳朵、膚色臉、肚子螢幕、棕色靴子），背包裡探出偷來的金色時鐘。
  - 巧馨（64×88）：兜帽斗篷＋端正王冠，閉眼吸收天地日月精華、雙手捧太陽光球；光環＝暖光、往內吸的光點、繞行的日與月。爆氣版睜眼發光、斗篷烈焰紅。
  - 排擠兵（24px）：手機臉群友，多種配色；酸民射手（墨鏡）、暴走群主（紅＋皇冠，體型較大）、已讀不回（眼睛是已讀勾勾）。
  - 派對帽版本：VICTORY 時在頭頂疊畫三角帽。
- **繪製順序**：地板離屏圖 → 掉落物 → 陰影/預警圈 → 木箱 + 實體（依 y 排序）→ 灌木（玩家在內時 alpha 0.55，玩家本身也半透明）→ 子彈 → 粒子 → 頭頂彈幕文字 → 螢幕座標 HUD → 虛擬按鈕 → 過場疊加層。
- **特效**：拉炮彩帶子彈（彩色小矩形旋轉 + 拖尾）、命中彩紙粒子、受傷數字、震螢幕、時停時全畫面灰階藍色濾鏡（以半透明覆蓋 + 敵人改畫灰色版）+ 畫面中央巨大時鐘指針停住動畫。
- **HUD**：左上 HP 條與數值、彈匣 3 格、大招能量環（時鐘圖示）；上方中央凍結時鐘 23:59:59 + 階段；Boss 血條；擊殺數。
- 文字泡泡使用快取（同字串只量測一次寬度）。

## 12. Web Audio 音效設計
`AudioEngine`：單一 `AudioContext`、`master → {sfxGain, musicGain}`；首次使用者手勢時 `resume()`（LINE/iOS 必要）。

基礎函數：
```js
tone({freq, freqEnd, type, dur, vol, attack, decay, delay})   // OscillatorNode + GainNode 包絡，可滑音
noise({dur, vol, filterType, filterFreq, filterEnd, delay})    // 共用預生成 1 秒白噪音 AudioBuffer
arp(notes[], step, type, vol)                                  // 連續短音
```
| SFX | 合成方式 |
|---|---|
| `shoot` 拉炮 | 噪音 0.08s 高通爆音 + 方波 1200→600Hz 0.06s |
| `hit` | 方波 300→150Hz 0.05s |
| `enemyDie` | 方波下滑 600→80Hz 0.15s + 小噪音 |
| `crateBreak` | 低通噪音 0.2s + 三角波 120Hz |
| `pickupHeart` | arp C5-E5-G5 方波 |
| `pickupSpring` | 兩聲短促 sine「滴答」2000/1500Hz |
| `ultCast` | 鐘聲：sine 880 + 1760 + 2640 泛音、長衰減 1.2s + 低頻下滑 |
| `ultEnd` | 反向上滑音 |
| `playerHurt` | 鋸齒波 200→60Hz 0.2s |
| `dash警告` | 方波快速顫音 |
| `cakeWarn` / `cakeSlam` | 上升哨音 / sine 90→30Hz + 低通噪音重擊 |
| `bossRoar` | 鋸齒波 + LFO 顫音 0.8s |
| `phaseChange` | 號角 arp |
| `gameOver` | 下行小調 arp |
| `midnight` | 12 響鐘聲（縮短間隔 0.25s） |

- **音序器**：lookahead 排程（`setInterval` 25ms，預排 0.12s），支援 BGM 循環（方波主旋律 + 三角波 bass + 噪音鼓，每階段加快 BPM / Boss 戰換曲）與一次性曲目。
- **生日快樂歌**（公有領域旋律）以音符表 `[音名, 拍數]` 播放，方波主旋律 + 三角波和弦。
- 同一 SFX 每 40ms 最多觸發一次，同時發聲上限 24，避免大量命中爆音；全域壓縮器 `DynamicsCompressorNode` 防破音。
- 靜音狀態存 `localStorage`。

## 13. 手機 / LINE 內嵌瀏覽器相容
- 不依賴 Fullscreen API（LINE iOS 不支援），有的話 try/catch 嘗試。
- 不用 `100vh`；`html,body{overflow:hidden; position:fixed; inset:0}` 防止橡皮筋捲動。
- 所有觸控事件 `{passive:false}` + `preventDefault`。
- 直式提示「橫放體驗更佳」但仍可玩（直式 UI 版面另算）。
- `visibilitychange`（LINE 切出去）→ 自動暫停並暫停音訊。
- 效能預算：敵人 ≤ 55、子彈 ≤ 400、粒子 ≤ 500；低 FPS（連續 2s < 40）時自動降粒子數量。

## 14. 分步實作 Checklist（每步完成後在瀏覽器驗證才進下一步）
- [x] **S0** 將本計畫寫入專案 `PLAN.md`；刪除空的 `assets/` 資料夾
- [x] **S1 骨架**：`index.html`、全螢幕 canvas、DPR、resize、固定步長迴圈、狀態機 stub（BOOT/TITLE/PLAYING 可切換）、CONFIG、debug 參數解析
  - 驗收：桌機與手機尺寸皆滿版無捲軸、轉向後正常
- [x] **S1.5 像素素材預覽（先給使用者看畫風）**：完成 §4 Sprites 區段（字串陣列 + 調色盤 → 離屏 canvas 快取），以 `?gallery=1` 開啟展示頁，每個素材放大 4 倍並附中文名稱：
  - 角色：迪西（待機、走路 2 幀、受傷白閃、戴派對帽）、巧馨（一般、爆氣）
  - 小怪：排擠兵（3 種配色）、酸民射手、暴走群主、已讀不回
  - 地圖：地板、牆、派對木箱（完整/破損）、灌木草叢（含半透明狀態）
  - 道具/特效：愛心、時鐘發條、彩帶子彈、敵方彈、蛋糕與陰影預警圈、彩紙粒子
  - UI：HP 條、彈匣格、大招能量環、凍結時鐘 23:59:59、虛擬搖桿與按鈕
  - 驗收：使用者確認畫風（配色、大小、角色辨識度）後才進 S2；有修改意見就在此步驟反覆調整
- [x] **S2 地圖**：象限陣列、鏡像、`validateMap()`（對稱、可達性、出生點）、地板離屏預渲染、攝影機跟隨與邊界夾取
- [x] **S3 玩家與碰撞**：迪西 sprite、WASD 移動、圓 vs tile 分軸解算貼牆滑行
  - 驗收：沿牆斜走不卡、角落不穿牆、高 dt 不穿牆
- [x] **S4 輸入**：InputManager 鍵鼠 + 觸控浮動搖桿、拉炮鈕（點擊自動瞄/拖曳手動瞄）、時停鈕、pointercancel 重置
- [x] **S5 射擊**：扇形拉炮、彈匣/填裝、射程、子步碰撞、木箱 HP 與破壞、掉落物與拾取、物件池
- [x] **S6 敵人**：排擠兵、流場尋路、分離力、接觸傷害、頭頂彈幕文字、死亡掉落、空間雜湊
- [x] **S7 導演**：TIMELINE 波次、Phase 1/2 切換橫幅、酸民射手、暴走群主（預警線 + 衝撞 + 撞牆暈）、已讀不回
- [x] **S8 草叢隱身**：hidden 判定、半透明繪製、開火顯形、敵人追上次已知位置
- [x] **S9 大招**：發條充能、`timeScaleEnemy` 定格 3s、灰階濾鏡與時鐘動畫、所有敵方計時器都受影響
- [x] **S10 音效**：AudioEngine、全部 SFX、音序器、BGM、靜音、首觸解鎖、分頁切換暫停
- [x] **S11 Boss**：BOSS_INTRO 演出、三血量階段招式、蛋糕預警/砸地/殘骸、召喚、Boss 血條、時停對 Boss 25%
- [x] **S12 UI 流程**：TITLE（難度選擇）、INTRO 劇情（可跳過）、HUD、PAUSED、GAMEOVER（checkpoint 重來 / 從頭）
- [x] **S13 結局**：VICTORY 清場 → 時鐘跨日 00:00:00 + 12 響鐘 → 小怪戴派對帽、彩帶粒子 → 生日快樂歌 → ENDING 兩壽星畫面 + 祝福語 + 通關時間 + 再玩一次
- [ ] **S14 打磨**（自動化測試已跑完全流程；待真人實機遊玩調整數值、LINE 實測）：數值平衡（兩種難度各實際通關一次）、效能降級、LINE/iOS 細節、`?debug` 預設關閉

### 邊界條件檢查表
- [ ] 敵人生成點不可在牆內，且距玩家 ≥ 300；被擋住則換出生點
- [ ] 玩家在時停中死亡 → 時停立即結束，進 GAMEOVER
- [ ] Boss 死亡瞬間場上子彈全部清除、玩家無敵
- [ ] BOSS_INTRO / VICTORY 期間禁止輸入射擊與大招
- [ ] 回血不超過 maxHp；能量不超過 100；能量滿後發條仍可撿但不溢出
- [ ] 掉落物 12s 消失、最後 3s 閃爍；掉在牆內時推到最近地板
- [ ] 蛋糕殘骸不會把玩家或敵人困在裡面（落地時將重疊實體推出）
- [ ] 子彈離開地圖邊界即回收
- [ ] 視窗 resize / 轉向發生在遊戲中：攝影機、按鈕位置即時重算，不重置遊戲
- [ ] 分頁隱藏 → 暫停；回來時 dt 夾取，不會瞬間生成大量怪
- [ ] AudioContext 未解鎖時所有 SFX 呼叫安全無錯
- [ ] localStorage 不可用（無痕模式）時不報錯
- [ ] 多指同時操作（左搖桿 + 右拉炮 + 時停鈕）互不干擾
- [ ] 重新開始時所有物件池、計時器、音序器確實重置

## 15. 驗證方式
1. 直接以 `file://` 開啟 `index.html`，以及用本機伺服器（`python -m http.server`）在內建瀏覽器開啟，確認 Console 無錯誤。
2. 內建瀏覽器 `resize_window` 切換 mobile（375×812 直式）、橫式 812×375、desktop，檢查版面與虛擬按鈕。
3. 使用 `?phase=2`、`?phase=3`、`?god=1`、`?debug=1` 快速驗證各階段、Boss 招式、碰撞框與流場。
4. 兩種難度各完整通關一次，計時單局約 2.5 分鐘，並確認結局動畫與生日歌播放。
5. 部署 GitHub Pages 後，用手機 LINE 傳送網址並從 LINE 內開啟實測（需使用者協助）。

## 實作備註（v1 完成）
- 狀態機實作：`BOOT → TITLE → INTRO → PLAY → ENDING`；`PLAY` 內部子階段 `p1 → p2 → bossIntro → boss → bossDeath → victory`，暫停與遊戲結束為 `PLAY` 的疊加層（`W.overlay`）。
- Boss 與小怪在沒有視線時走流場尋路；Boss 與小怪共用 `steer()`。
- 測試方式：`?debug=1`（碰撞框、數量）、`?phase=2|3`（跳階段，會略過劇情）、`?god=1`（無敵）。

## v2 更新（手機直式・武器・叫囂・天線寶寶）
- **手機模擬器** `phone.html`：iPhone 15／iPhone SE／Android，直式／橫式，可切 LINE 瀏覽器列；以 `index.html?touch=1&safe=上,右,下,左` 嵌入，滑鼠當手指用。
- **武器系統**（`WEAPONS`）：拉炮手槍無限；步槍 18、機關槍 100、散彈槍 10、火焰槍 140、火箭炮 6、雷射槍 10（次數）。用完自動換回手槍；手槍＋一把特殊武器兩格，Q／滾輪／切換鈕切換。
  - 來源：木箱 22%、精英怪、天線寶寶 60%、定時空投（每 15～18 秒，畫面邊緣箭頭指示）。
  - 強度控管：每把武器「用完」的總傷害約為巧馨血量 30～45%；火焰槍、火箭炮第二階段才掉，雷射槍只在 Boss 戰掉。
- **射程顯示**：漸層扇形＋流動白色虛線邊＋射程終點弧線；觸控按住時加畫射程圓圈、自動瞄準鎖定框。各武器有專屬子彈特效、槍口火光、爆炸環、雷射光束。
- **觸控射擊**：按住拉炮鈕持續開火（不拖曳＝自動瞄準，拖曳＝手動瞄準），輕點＝單發。
- **巧馨叫囂**（`CONFIG.cutins`）：時間點、低血量、撿到強力武器、放大招、擊退數、Boss 戰定時，從右側滑入對話框。
- **Boss 第二階段**召喚丁丁（跺地彈幕圈）、拉拉（反彈大球）、小波（預警衝撞），有名牌與血條。
- 攝影機在觸控模式下多留邊界，主角不會被手指按鈕擋住；直式 HUD 把時鐘移到右上。
