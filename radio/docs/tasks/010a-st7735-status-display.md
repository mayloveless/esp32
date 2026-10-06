# Task 010A — ST7735 实体电台状态界面

## 目标

在当前 009B 真机链路已经具备：

- EC11 物理调台；
- 本地 tuning/static；
- manifest prefetch；
- 网络音频播放；
- startOffsetMs seek；
- 自然 EOF completed；

的基础上，接入 1.8" ST7735 屏幕，先做一个稳定的实体电台状态界面。

本任务 **只显示状态、节目类型和标题**。

字幕 / 翻译留到 Task 010B，避免第一次就把 TFT、中文字体、字幕时序和音频刷新全部耦合在一起。

当前基线：

```text
8d70eba4257b83b2bc7a02d60bb1ff917d8fb6fe
feat: add local tuning feedback and dial travel control
```

---

## 一、硬件

当前已验证的 ST7735：

```text
1.8"
128×160
initR(INITR_BLACKTAB)
```

接线：

```text
ST7735 VCC   → 3.3V
ST7735 GND   → GND
ST7735 CS    → GPIO10
ST7735 RESET → GPIO8
ST7735 DC    → GPIO9
ST7735 MOSI  → GPIO11
ST7735 SCK   → GPIO12
ST7735 LED   → 3.3V
```

不使用 MISO。

必须加静态 pin conflict 检查，确保 TFT 不与：

- I2S GPIO4/5/6；
- Encoder GPIO7/15/16；

冲突。

---

## 二、显示方向

优先使用横屏：

```text
160 × 128
```

例如：

```cpp
tft.setRotation(1);
```

如果当前库/面板实际方向需要 3，则以真机文字朝向正确为准。

不要为了方向问题改硬件接线。

---

## 三、界面

目标不是做漂亮复杂 UI，而是让实体机第一次“像一台电台”。

建议布局：

```text
┌────────────────────┐
│ COSMIC RADIO       │
│                    │
│ [ NEWS ]           │
│ 来自奥尔特云的回声 │
│                    │
│  ● SIGNAL LOCKED   │
└────────────────────┘
```

状态根据当前 receiver 显示。

### Boot / Wi-Fi

```text
COSMIC RADIO

BOOTING...
CONNECTING
```

Wi-Fi 失败：

```text
COSMIC RADIO

NO NETWORK
TURN TO RETRY
```

### Tuning

用户转旋钮 / static：

```text
COSMIC RADIO

~ TUNING ~
SEARCHING SIGNAL...
```

不需要显示具体 encoder 数字、revision、offset。

### 正在连接 / 锁台

manifest 已选中、正在 HTTPS / seek：

```text
COSMIC RADIO

LOCKING SIGNAL...
```

如果已经有节目标题，可以提前显示标题。

### Playing

显示：

- signalKind；
- title；
- locked 状态。

例如：

```text
ALIEN

异星信号 · f610e5

● SIGNAL LOCKED
```

### No signal / Error

```text
NO SIGNAL
TURN THE DIAL
```

播放失败：

```text
SIGNAL LOST
TURN TO RETRY
```

不要在屏幕上显示 HTTP 状态码、IP、token、signed URL、programId 等调试信息。

---

## 四、中文标题

节目标题当前经常是中文，因此必须能显示中文。

优先沿用之前验证过的方案：

- Adafruit GFX；
- Adafruit ST7735；
- U8g2_for_Adafruit_GFX 适配器。

不要自己实现中文字库渲染器。

选择一个尺寸适合 160×128 的中文字库，优先约 12px。

注意当前应用已经约占 3MB APP 分区的 67%，因此：

1. 先确认所选中文字库对编译体积的影响；
2. 如果完整中文字体导致 APP 明显超预算，不要换分区或砍现有功能；
3. 优先选择 U8g2 中较小、覆盖常见中文的字体；
4. 在 README 记录最终字体和编译占用。

如果字体确实无法在当前 APP 分区安全容纳，停止并记录，不要临时改成乱码或只显示 programId。

---

## 五、标题排版

屏幕很小。

标题最多显示约 2–3 行。

要求：

- UTF-8 正常；
- 超出显示区域时截断；
- 可以尾部加 `…`，做不到时直接安全截断也可；
- 不要横向滚动；
- 不要 marquee；
- 不要为了测量中文宽度引入复杂布局系统。

节目类型可以使用 ASCII：

```text
NEWS
CHAT
ALIEN
MUSIC
```

---

## 六、刷新策略

这是本任务最重要的性能约束。

**不能在每个 loop 全屏 redraw。**

建立轻量 display state / dirty flag。

只有以下情况重绘：

- boot；
- Wi-Fi 状态变化；
- receiver state 变化；
- 新节目 title/kind 变化；
- no_signal / playback error；
- 必要的少量状态变化。

不要：

- 在 ISR 画屏；
- 在 audio callback 画屏；
- 在 prefetch worker 画屏；
- 每个音频 loop 画屏；
- 每个 encoder edge 画屏。

旋钮持续转动时，进入 TUNING 后画一次即可，不需要每个边沿重画。

目标是屏幕刷新不能造成现有网络音频更卡。

---

## 七、显示层与业务状态解耦

不要让 TFT 代码反过来控制播放器。

推荐增加一个很薄的显示模块，例如：

```text
RadioDisplay.h / RadioDisplay.cpp
```

或当前 Arduino 工程更适合的同级文件。

播放器只提交简单状态：

```cpp
display.showBoot();
display.showConnecting();
display.showTuning();
display.showLocking(title, kind);
display.showPlaying(title, kind);
display.showNoSignal();
display.showError();
```

也可以使用一个 `DisplayModel` + `renderIfDirty()`。

不要做通用 UI framework。

---

## 八、与现有状态对应

需要读当前实际状态机后接入，不要另建一套重复业务状态。

建议映射：

```text
setup / boot
→ BOOT

Wi-Fi connect
→ CONNECTING

kTuning + encoder/static
→ TUNING

manifest 已准备 / network connect / seek pending
→ LOCKING

kPlaying + network audio 已实际产生样本
→ PLAYING

no_signal
→ NO SIGNAL

failPlayback
→ SIGNAL LOST
```

注意：

**PLAYING 最好在网络节目真正产生样本后再显示 locked**，不要仅因为 `connecttohost()` 返回成功就显示 SIGNAL LOCKED。

---

## 九、009B 行为必须完全保留

本任务不能改变：

- Audio owner handoff；
- local tuning WAV；
- 小幅旋钮 feedback；
- dial travel threshold；
- 4 秒保护；
- manifest prefetch；
- foreground worker；
- startOffsetMs；
- HTTP WAV seek patch；
- completed 生命周期；
- 最近两条节目排除；
- Wi-Fi gateway/BSSID 逻辑。

不要借显示任务重构这些代码。

---

## 十、依赖

README 中明确记录需要安装的显示库及版本范围。

优先使用：

- Adafruit GFX Library；
- Adafruit ST7735 and ST7789 Library；
- U8g2_for_Adafruit_GFX（如用于中文）。

若当前机器已有兼容版本，优先使用现有安装。

不要引入 LVGL。

160×128 这个界面没有必要使用 LVGL。

---

## 十一、测试

host regression 不需要模拟像素。

只抽出最小 display model/state 映射测试，至少覆盖：

1. boot → CONNECTING；
2. encoder retune → TUNING；
3. manifest ready / audio connecting → LOCKING；
4. network raw samples 实际产生 → PLAYING；
5. no_signal → NO SIGNAL；
6. playback error → SIGNAL LOST；
7. 新节目更新 title/kind；
8. 同一状态重复提交不会持续标 dirty / 重绘。

不要把 Adafruit display 驱动编进 host test。

---

## 十二、真机验收

烧录后至少验证：

1. 开机屏幕能正常初始化；
2. 中文标题可读，方向正确；
3. Wi-Fi 阶段能看到 CONNECTING；
4. 一转旋钮很快显示 TUNING；
5. 新节目连接期间显示 LOCKING；
6. 真正出声后才显示 SIGNAL LOCKED；
7. NEWS / CHAT / ALIEN / MUSIC 类型正确；
8. no_signal / 播放失败能显示明确状态；
9. 连续转动不会导致屏幕疯狂闪烁；
10. 屏幕刷新期间音频没有明显比 009B 更卡；
11. 原有 seek / static / completed / prefetch 回归均通过。

---

## 十三、本任务明确不做

- 字幕；
- alien 中文翻译；
- 播放进度条；
- 波形 / 频谱；
- 动画；
- 图标素材；
- 背景图片；
- station frequency；
- EC11 按键；
- 屏幕亮度控制；
- LVGL；
- 美术级 UI。

完成后暂停，不开始 Task 010B。
